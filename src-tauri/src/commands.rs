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

    downloader::download(&app, &model_id, &binding, &dest).await?;

    // Refresh local state so the UI sees the new file.
    let mut reg = state.registry.lock().await;
    reg.refresh_local_state();
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
    for id in [RuntimeId::LlamaCpp, RuntimeId::LiteRtLm] {
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
