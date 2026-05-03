//! Tauri command handlers — the IPC surface exposed to the React frontend.
//! See `src/lib/ipc.ts` for the matching TypeScript wrappers.

use std::sync::Arc;

use futures::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::core::{Conversation, GenOpts, Message, Model, Role, TokenChunk};
use crate::error::{AppError, AppResult};
use crate::registry::{self, downloader};
use crate::runtimes::{LoadOpts, RuntimeId};
use crate::AppState;

/* ---------- models / registry ---------- */

#[tauri::command]
pub async fn list_models(state: State<'_, AppState>) -> AppResult<Vec<Model>> {
    let mut reg = state.registry.lock().await;
    reg.refresh_local_state();
    Ok(reg.models.clone())
}

#[tauri::command]
pub async fn download_model(
    app: AppHandle,
    state: State<'_, AppState>,
    model_id: String,
    runtime: RuntimeId,
) -> AppResult<()> {
    let (binding, dest) = {
        let reg = state.registry.lock().await;
        let binding = reg
            .binding_for(&model_id, runtime)
            .ok_or_else(|| AppError::NotFound(format!("binding {}::{:?}", model_id, runtime)))?
            .clone();
        let dest = registry::file_path_for(&reg.app_dir, &binding);
        (binding, dest)
    };

    // Cancel any prior in-flight download for this (model, runtime).
    {
        let mut downloads = state.downloads.lock().await;
        if let Some(prev) = downloads.remove(&(model_id.clone(), runtime)) {
            prev.abort();
        }
    }

    // Spawn the download as a tracked task so pause_download can abort it.
    // The function returns immediately; progress is delivered via events.
    let app_clone = app.clone();
    let model_id_clone = model_id.clone();
    let downloads = state.downloads.clone();
    let registry = state.registry.clone();
    let key = (model_id.clone(), runtime);

    let handle = tauri::async_runtime::spawn(async move {
        let result = downloader::download(&app_clone, &model_id_clone, &binding, &dest).await;
        if let Err(e) = &result {
            tracing::warn!(error=%e, model_id=%model_id_clone, "download failed");
        }
        // Refresh local state regardless of success — partial files still
        // affect what the UI shows.
        let mut reg = registry.lock().await;
        reg.refresh_local_state();
        // Drop our handle so a future download_model invocation isn't blocked.
        let mut downloads = downloads.lock().await;
        downloads.remove(&(model_id_clone, runtime));
    });

    state.downloads.lock().await.insert(key, handle);
    Ok(())
}

/// Abort an in-flight download. Partial bytes remain on disk so re-invoking
/// `download_model` resumes via the Range header. Emits a final progress
/// event with state=paused so the UI can swap the button to "Resume".
#[tauri::command]
pub async fn pause_download(
    app: AppHandle,
    state: State<'_, AppState>,
    model_id: String,
    runtime: RuntimeId,
) -> AppResult<()> {
    let mut downloads = state.downloads.lock().await;
    if let Some(handle) = downloads.remove(&(model_id.clone(), runtime)) {
        handle.abort();
    }
    drop(downloads);

    // Probe partial size on disk so the UI shows where it left off.
    let bytes_done = {
        let reg = state.registry.lock().await;
        if let Some(b) = reg.binding_for(&model_id, runtime) {
            let path = registry::file_path_for(&reg.app_dir, b);
            tokio::fs::metadata(&path)
                .await
                .ok()
                .map(|m| m.len())
                .unwrap_or(0)
        } else {
            0
        }
    };

    let _ = app.emit(
        "model:download",
        &serde_json::json!({
            "model_id": model_id,
            "runtime": runtime,
            "bytes_done": bytes_done,
            "bytes_total": 0,
            "state": "paused",
        }),
    );
    Ok(())
}

#[tauri::command]
pub async fn delete_local_model(
    state: State<'_, AppState>,
    model_id: String,
    runtime: RuntimeId,
) -> AppResult<()> {
    let path = {
        let reg = state.registry.lock().await;
        let b = reg
            .binding_for(&model_id, runtime)
            .ok_or_else(|| AppError::NotFound(model_id.clone()))?;
        registry::file_path_for(&reg.app_dir, b)
    };
    if path.exists() {
        tokio::fs::remove_file(&path).await?;
    }
    let mut reg = state.registry.lock().await;
    reg.refresh_local_state();
    Ok(())
}

#[tauri::command]
pub async fn import_model(
    state: State<'_, AppState>,
    runtime: RuntimeId,
    source_path: String,
    display_name: String,
) -> AppResult<Model> {
    use std::path::Path;

    let src = Path::new(&source_path);
    if !src.exists() {
        return Err(AppError::NotFound(format!(
            "source path does not exist: {}",
            source_path
        )));
    }

    // Validate format per runtime.
    let is_dir = src.is_dir();
    let ext = src
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    match runtime {
        RuntimeId::LlamaCpp => {
            if is_dir || ext != "gguf" {
                return Err(AppError::Invalid(
                    "llama.cpp expects a single .gguf file".into(),
                ));
            }
        }
        RuntimeId::LiteRtLm => {
            if is_dir || ext != "litertlm" {
                return Err(AppError::Invalid(
                    "LiteRT-LM expects a single .litertlm file".into(),
                ));
            }
        }
        RuntimeId::Mlx => {
            if !is_dir {
                return Err(AppError::Invalid(
                    "MLX expects a directory containing config.json + safetensors + tokenizer"
                        .into(),
                ));
            }
            // Sanity: directory should have a config.json.
            if !src.join("config.json").exists() {
                return Err(AppError::Invalid(
                    "MLX directory is missing config.json".into(),
                ));
            }
        }
    }

    let slug = slugify(&display_name);
    if slug.is_empty() {
        return Err(AppError::Invalid("display_name produced empty slug".into()));
    }

    let app_dir = {
        let reg = state.registry.lock().await;
        reg.app_dir.clone()
    };

    let dest_dir = app_dir
        .join("models")
        .join(runtime.folder_name())
        .join("imported")
        .join(&slug);
    tokio::fs::create_dir_all(&dest_dir).await?;

    let (hf_file_value, dest_path) = if is_dir {
        copy_dir(src, &dest_dir).await?;
        ("*".to_string(), dest_dir.clone())
    } else {
        let filename = src
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| AppError::Invalid("source filename not utf8".into()))?
            .to_string();
        let dest = dest_dir.join(&filename);
        tokio::fs::copy(src, &dest).await?;
        (filename, dest)
    };

    let size_gb = dir_size_bytes(&dest_path).await as f32 / 1_073_741_824.0;

    let model = Model {
        id: format!("imported-{slug}-{}", runtime.folder_name()),
        display_name,
        family: crate::core::ModelFamily::Other,
        arch: crate::core::Arch::Dense,
        modalities: vec![crate::core::Modality::Text],
        quant: crate::core::Quant::Other,
        ctx_max: 4096,
        bindings: vec![crate::core::RuntimeBinding {
            runtime,
            hf_repo: format!("imported/{slug}"),
            hf_file: hf_file_value,
            size_gb,
            available: true,
            sha256: None,
        }],
        local: Default::default(),
    };

    let mut reg = state.registry.lock().await;
    reg.add_imported(model.clone()).map_err(AppError::Io)?;
    reg.refresh_local_state();
    Ok(model)
}

fn slugify(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

async fn copy_dir(src: &std::path::Path, dst: &std::path::Path) -> AppResult<()> {
    use tokio::fs;
    let mut stack = vec![(src.to_path_buf(), dst.to_path_buf())];
    while let Some((cur_src, cur_dst)) = stack.pop() {
        fs::create_dir_all(&cur_dst).await?;
        let mut rd = fs::read_dir(&cur_src).await?;
        while let Some(entry) = rd.next_entry().await? {
            let p = entry.path();
            let target = cur_dst.join(entry.file_name());
            if entry.file_type().await?.is_dir() {
                stack.push((p, target));
            } else {
                fs::copy(&p, &target).await?;
            }
        }
    }
    Ok(())
}

async fn dir_size_bytes(p: &std::path::Path) -> u64 {
    use tokio::fs;
    if let Ok(md) = fs::metadata(p).await {
        if md.is_file() {
            return md.len();
        }
    }
    let mut total: u64 = 0;
    let mut stack = vec![p.to_path_buf()];
    while let Some(d) = stack.pop() {
        let mut rd = match fs::read_dir(&d).await {
            Ok(r) => r,
            Err(_) => continue,
        };
        while let Ok(Some(e)) = rd.next_entry().await {
            let p = e.path();
            match e.file_type().await {
                Ok(t) if t.is_dir() => stack.push(p),
                Ok(_) => {
                    if let Ok(md) = e.metadata().await {
                        total += md.len();
                    }
                }
                Err(_) => {}
            }
        }
    }
    total
}

/* ---------- conversations ---------- */

#[tauri::command]
pub async fn list_conversations(state: State<'_, AppState>) -> AppResult<Vec<Conversation>> {
    let store = state.store.lock().await;
    store.list_conversations()
}

#[tauri::command]
pub async fn create_conversation(
    state: State<'_, AppState>,
    model_id: String,
    runtime: RuntimeId,
    title: Option<String>,
) -> AppResult<Conversation> {
    let conv = Conversation::new(model_id, runtime, title);
    let store = state.store.lock().await;
    store.upsert_conversation(&conv)?;
    Ok(conv)
}

#[tauri::command]
pub async fn get_conversation(state: State<'_, AppState>, id: String) -> AppResult<Conversation> {
    let store = state.store.lock().await;
    store.get_conversation(&id)
}

#[tauri::command]
pub async fn delete_conversation(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let store = state.store.lock().await;
    store.delete_conversation(&id)
}

/* ---------- chat ---------- */

#[tauri::command]
pub async fn start_chat_turn(
    app: AppHandle,
    state: State<'_, AppState>,
    conversation_id: String,
    user_message: Message,
    opts: GenOpts,
) -> AppResult<String> {
    // Chat-friendly defaults applied across all runtimes. mlx_lm.server in
    // particular defaults to temperature=0 (greedy), which causes severe
    // repetition on small instruct models. Caller-specified values still win.
    let opts = GenOpts {
        temperature: opts.temperature.or(Some(0.7)),
        top_p: opts.top_p.or(Some(0.95)),
        top_k: opts.top_k.or(Some(40)),
        max_tokens: opts.max_tokens.or(Some(512)),
        seed: opts.seed,
    };

    // 1. Append user message + assistant placeholder, persist.
    let mut conv = {
        let store = state.store.lock().await;
        store.get_conversation(&conversation_id)?
    };
    conv.messages.push(user_message.clone());
    conv.updated_at = now_ms();
    {
        let store = state.store.lock().await;
        store.upsert_conversation(&conv)?;
    }

    // 2. Resolve model + runtime, load if needed.
    let model: Model = {
        let reg = state.registry.lock().await;
        reg.find(&conv.model_id)
            .ok_or_else(|| AppError::NotFound(conv.model_id.clone()))?
            .clone()
    };
    let runtime = state.runtime(conv.runtime);
    let handle = runtime.load(&model, LoadOpts::default()).await?;

    // 3. Spawn streaming task. Each chunk goes out as a `chat:chunk:<id>` event.
    let turn_id = Uuid::new_v4().to_string();
    let event_name = format!("chat:chunk:{}", conv.id);
    let store = Arc::clone(&state.store);
    let conv_id = conv.id.clone();
    let messages = conv.messages.clone();

    let _join = tauri::async_runtime::spawn(async move {
        let result = run_turn(
            &app,
            &event_name,
            runtime.as_ref(),
            &handle,
            &messages,
            opts,
        )
        .await;

        // If run_turn errored, surface that to the UI now — otherwise the
        // bubble hangs on "..." forever. run_turn only emits a done chunk on
        // its own success path.
        if let Err(e) = &result {
            let _ = app.emit(
                &event_name,
                &TokenChunk {
                    text: format!("[error] {e}"),
                    done: true,
                    metrics: None,
                },
            );
        }

        // 4. Persist the assistant turn (full text) regardless of success.
        let mut conv = match store.lock().await.get_conversation(&conv_id) {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!(error=%e, "could not reload conversation after turn");
                return;
            }
        };
        let text = match &result {
            Ok(t) => t.clone(),
            Err(e) => format!("[error] {}", e),
        };
        conv.messages.push(Message {
            role: Role::Assistant,
            parts: vec![crate::core::Part::Text { text }],
            ts: Some(now_ms()),
        });
        conv.updated_at = now_ms();
        if let Err(e) = store.lock().await.upsert_conversation(&conv) {
            tracing::warn!(error=%e, "failed to persist assistant turn");
        }
    });

    Ok(turn_id)
}

#[tauri::command]
pub async fn cancel_chat(_state: State<'_, AppState>, _turn_id: String) -> AppResult<()> {
    // TODO: maintain a turn_id -> abort-handle map and signal it here.
    Err(AppError::NotImplemented("cancel_chat"))
}

/* ---------- benchmarks ---------- */

#[tauri::command]
pub async fn list_bench_runs(state: State<'_, AppState>) -> AppResult<Vec<crate::bench::BenchRun>> {
    let store = state.store.lock().await;
    store.list_bench_runs()
}

#[tauri::command]
pub async fn delete_bench_run(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let store = state.store.lock().await;
    store.delete_bench_run(&id)
}

#[tauri::command]
pub async fn run_benchmark(
    state: State<'_, AppState>,
    model_id: String,
    runtime: RuntimeId,
    cfg: Option<crate::bench::BenchCfg>,
) -> AppResult<crate::bench::BenchRun> {
    let model = {
        let reg = state.registry.lock().await;
        reg.find(&model_id)
            .ok_or_else(|| AppError::NotFound(model_id.clone()))?
            .clone()
    };
    let cfg = cfg.unwrap_or_default();
    let rt = state.runtime(runtime);
    let run = crate::bench::run_benchmark(rt.as_ref(), &model, &cfg).await?;
    let store = state.store.lock().await;
    store.insert_bench_run(&run)?;
    Ok(run)
}

/* ---------- runtime status ---------- */

#[derive(Clone, Debug, Serialize)]
pub struct RuntimeStatus {
    pub runtime: RuntimeId,
    pub installed: bool,
    pub version: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn runtime_status(state: State<'_, AppState>) -> AppResult<Vec<RuntimeStatus>> {
    let mut out = Vec::new();
    for id in RuntimeId::all() {
        let r = state.runtime(id);
        out.push(RuntimeStatus {
            runtime: id,
            installed: r.installed().await,
            version: r.version().await,
            error: None,
        });
    }
    Ok(out)
}

/* ---------- helpers ---------- */

async fn run_turn<R: crate::runtimes::Runtime + ?Sized>(
    app: &AppHandle,
    event_name: &str,
    runtime: &R,
    handle: &crate::runtimes::SessionHandle,
    messages: &[Message],
    opts: GenOpts,
) -> AppResult<String> {
    let mut stream = runtime.chat(handle, messages, opts).await?;
    let mut full = String::new();
    while let Some(chunk_res) = stream.next().await {
        let chunk: TokenChunk = chunk_res?;
        full.push_str(&chunk.text);
        if let Err(e) = app.emit(event_name, &chunk) {
            tracing::warn!(error=%e, "failed to emit chunk");
        }
        if chunk.done {
            break;
        }
    }
    // Emit a final done frame if the underlying stream forgot.
    let _ = app.emit(
        event_name,
        &TokenChunk {
            text: String::new(),
            done: true,
            metrics: None,
        },
    );
    Ok(full)
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
