//! MLX adapter — manages an `mlx_lm.server` subprocess and talks to its
//! OpenAI-compatible HTTP endpoint.
//!
//! Structurally identical to the llama.cpp adapter; the only differences are
//! the binary name, the default port, and the model-path semantics (MLX models
//! are *directories* of safetensors + tokenizer + config, not single files).
//!
//! v0.2 should consider switching to in-process MLX via PyO3 to avoid the
//! Python runtime dependency.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use futures::stream::{self, BoxStream, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use crate::core::{GenOpts, Message, Model, Part, Role, RuntimeMetrics, TokenChunk};
use crate::error::{AppError, AppResult};
use crate::runtimes::{Capabilities, LoadOpts, Runtime, RuntimeId, SessionHandle};

const PORT: u16 = 18081;

pub struct MlxRuntime {
    app_dir: PathBuf,
    inner: Arc<Mutex<Inner>>,
}

struct Inner {
    server: Option<ServerProcess>,
    base_url: String,
    http: reqwest::Client,
}

struct ServerProcess {
    child: Child,
    model_id: String,
    /// Stable identifier we send in the OpenAI-compat `model` field. For
    /// mlx_lm.server this is the magic string "default_model"; for
    /// mlx_vlm.server it must be the actual on-disk path because that
    /// server treats any other string as an HF repo to fetch.
    request_model_id: String,
}

impl Drop for ServerProcess {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
    }
}

impl MlxRuntime {
    pub fn new(app_dir: PathBuf) -> Self {
        Self {
            app_dir,
            inner: Arc::new(Mutex::new(Inner {
                server: None,
                base_url: format!("http://127.0.0.1:{PORT}"),
                http: reqwest::Client::builder()
                    .timeout(Duration::from_secs(60 * 30))
                    .build()
                    .expect("build http client"),
            })),
        }
    }

    /// Resolve a server binary by name, walking the same lookup chain we use
    /// for `mlx_lm.server`:
    ///   1. `$LLM_BENCH_MLX_SERVER` (only honored when looking up mlx-lm).
    ///   2. Vendored at `~/.llm-bench/runtimes/mlx/<name>`.
    ///   3. On `$PATH`.
    ///   4. Common user-base bin dirs (Python 3.13..3.9 + ~/.local/bin).
    ///   5. Module form: `python3 -m <module>`.
    fn resolve_server(&self, bin_name: &str, module_name: &str) -> (PathBuf, Vec<String>) {
        if bin_name == "mlx_lm.server" {
            if let Ok(p) = std::env::var("LLM_BENCH_MLX_SERVER") {
                return (PathBuf::from(p), vec![]);
            }
        }
        let vendored = self.app_dir.join("runtimes").join("mlx").join(bin_name);
        if vendored.exists() {
            return (vendored, vec![]);
        }
        if let Some(p) = which(bin_name) {
            return (p, vec![]);
        }
        if let Some(home) = dirs::home_dir() {
            let candidates = [
                home.join(format!("Library/Python/3.13/bin/{bin_name}")),
                home.join(format!("Library/Python/3.12/bin/{bin_name}")),
                home.join(format!("Library/Python/3.11/bin/{bin_name}")),
                home.join(format!("Library/Python/3.10/bin/{bin_name}")),
                home.join(format!("Library/Python/3.9/bin/{bin_name}")),
                home.join(format!(".local/bin/{bin_name}")),
            ];
            for c in candidates {
                if c.exists() {
                    return (c, vec![]);
                }
            }
        }
        let py = which("python3").unwrap_or_else(|| PathBuf::from("python3"));
        (py, vec!["-m".into(), module_name.into()])
    }

    /// For text-only models we use `mlx_lm.server`; for multimodal (vision /
    /// audio) we route to `mlx_vlm.server` since mlx-lm cannot load the
    /// nested `language_model.*` tensor layout that VLMs use.
    fn server_command_for(&self, model: &Model) -> (PathBuf, Vec<String>) {
        let is_multimodal = model
            .modalities
            .iter()
            .any(|m| !matches!(m, crate::core::Modality::Text));
        if is_multimodal {
            self.resolve_server("mlx_vlm.server", "mlx_vlm.server")
        } else {
            self.resolve_server("mlx_lm.server", "mlx_lm.server")
        }
    }

    /// Convenience for `installed`/`version`: probe mlx-lm only.
    fn server_binary(&self) -> PathBuf {
        self.resolve_server("mlx_lm.server", "mlx_lm.server").0
    }

    fn local_model_path(&self, model: &Model) -> Option<PathBuf> {
        let binding = model
            .bindings
            .iter()
            .find(|b| b.runtime == RuntimeId::Mlx && b.available)?;
        // MLX model directories live at models/mlx/<repo>/
        Some(
            self.app_dir
                .join("models")
                .join("mlx")
                .join(&binding.hf_repo),
        )
    }
}

#[async_trait]
impl Runtime for MlxRuntime {
    fn id(&self) -> RuntimeId {
        RuntimeId::Mlx
    }

    fn capabilities(&self, model: &Model) -> Capabilities {
        Capabilities {
            modalities: model.modalities.clone(),
            tool_calling: true,
            max_ctx: model.ctx_max,
        }
    }

    async fn load(&self, model: &Model, opts: LoadOpts) -> AppResult<SessionHandle> {
        let mut g = self.inner.lock().await;

        if let Some(srv) = &g.server {
            if srv.model_id == model.id {
                return Ok(SessionHandle {
                    id: model.id.clone(),
                });
            }
        }

        if g.server.take().is_some() {
            tokio::time::sleep(Duration::from_millis(750)).await;
        }

        let model_path = self
            .local_model_path(model)
            .ok_or_else(|| AppError::NotFound(format!("local mlx dir for {}", model.id)))?;

        if !model_path.exists() {
            return Err(AppError::NotFound(format!(
                "model dir not on disk: {}",
                model_path.display()
            )));
        }

        let (bin, leading_args) = self.server_command_for(model);
        let mut cmd = Command::new(&bin);
        for a in &leading_args {
            cmd.arg(a);
        }
        cmd.arg("--model")
            .arg(&model_path)
            .arg("--port")
            .arg(PORT.to_string())
            .arg("--host")
            .arg("127.0.0.1");

        if let Some(c) = opts.ctx {
            // MLX server uses `--max-tokens` for generation length, not ctx; ctx
            // is bounded by the model's training. We expose ctx as a hint for
            // clients but do not pass it here.
            let _ = c;
        }

        cmd.stdout(Stdio::inherit()).stderr(Stdio::inherit());

        tracing::info!(
            "spawning mlx_lm.server: {} {}",
            cmd.as_std().get_program().to_string_lossy(),
            cmd.as_std()
                .get_args()
                .map(|a| a.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join(" ")
        );

        let child = cmd.spawn().map_err(|e| {
            AppError::RuntimeUnavailable(format!(
                "failed to spawn {} ({}). Install with `pip install mlx-lm` or set $LLM_BENCH_MLX_SERVER.",
                bin.display(),
                e
            ))
        })?;
        // mlx_lm.server uses the literal "default_model" magic string; mlx_vlm.server
        // does NOT, and treats any string we send as an HF repo to fetch. Pin the
        // request id to the actual on-disk path for VLM and to "default_model" for LM.
        let is_multimodal = model
            .modalities
            .iter()
            .any(|m| !matches!(m, crate::core::Modality::Text));
        let request_model_id = if is_multimodal {
            model_path.to_string_lossy().into_owned()
        } else {
            "default_model".to_string()
        };
        g.server = Some(ServerProcess {
            child,
            model_id: model.id.clone(),
            request_model_id,
        });

        let url = format!("{}/v1/models", g.base_url);
        let http = g.http.clone();
        drop(g);
        let deadline = Instant::now() + Duration::from_secs(300);
        let mut last_err: Option<String> = None;
        while Instant::now() < deadline {
            match http.get(&url).send().await {
                Ok(r) if r.status().is_success() => {
                    tracing::info!("mlx_lm.server ready");
                    return Ok(SessionHandle {
                        id: model.id.clone(),
                    });
                }
                Ok(r) => last_err = Some(format!("ready-check {}", r.status())),
                Err(e) => last_err = Some(format!("connect: {e}")),
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        Err(AppError::RuntimeUnavailable(format!(
            "mlx_lm.server did not become ready in 5 min (last: {})",
            last_err.unwrap_or_else(|| "no attempt".into())
        )))
    }

    async fn unload(&self, _h: &SessionHandle) -> AppResult<()> {
        let mut g = self.inner.lock().await;
        g.server = None;
        Ok(())
    }

    async fn chat<'a>(
        &'a self,
        _h: &'a SessionHandle,
        msgs: &'a [Message],
        opts: GenOpts,
    ) -> AppResult<BoxStream<'a, AppResult<TokenChunk>>> {
        let g = self.inner.lock().await;
        let url = format!("{}/v1/chat/completions", g.base_url);
        let http = g.http.clone();
        let request_model = g
            .server
            .as_ref()
            .map(|s| s.request_model_id.clone())
            .unwrap_or_else(|| "default_model".to_string());
        drop(g);

        let body = ChatRequest {
            model: request_model,
            messages: msgs.iter().map(to_oai_message).collect(),
            stream: true,
            stream_options: Some(StreamOptions {
                include_usage: true,
            }),
            temperature: opts.temperature,
            top_p: opts.top_p,
            max_tokens: opts.max_tokens,
        };

        let started = Instant::now();
        let resp = http.post(url).json(&body).send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let txt = resp.text().await.unwrap_or_default();
            return Err(AppError::RuntimeUnavailable(format!(
                "mlx_lm.server returned {status}: {txt}"
            )));
        }

        let byte_stream = resp.bytes_stream();
        let s = stream::unfold(
            (
                byte_stream,
                String::new(),
                started,
                None::<Instant>,
                None::<OaiUsage>,
                false,
            ),
            |(mut bs, mut buf, started, mut first_token, mut pending_usage, mut final_emitted)| async move {
                if final_emitted {
                    return None;
                }
                loop {
                    if let Some((event, rest)) = take_event(&buf) {
                        buf = rest;
                        match event {
                            SseEvent::Done => {
                                let metrics = pending_usage
                                    .as_ref()
                                    .map(|u| build_metrics(u, started, first_token));
                                final_emitted = true;
                                return Some((
                                    Ok(TokenChunk {
                                        text: String::new(),
                                        done: true,
                                        metrics,
                                    }),
                                    (bs, buf, started, first_token, pending_usage, final_emitted),
                                ));
                            }
                            SseEvent::Chunk(mut chunk) => {
                                if !chunk.text.is_empty() && first_token.is_none() {
                                    first_token = Some(Instant::now());
                                }
                                if chunk.done {
                                    chunk.metrics = pending_usage
                                        .as_ref()
                                        .map(|u| build_metrics(u, started, first_token));
                                    final_emitted = true;
                                }
                                return Some((
                                    Ok(chunk),
                                    (bs, buf, started, first_token, pending_usage, final_emitted),
                                ));
                            }
                            SseEvent::Usage(u) => {
                                pending_usage = Some(u);
                                continue;
                            }
                        }
                    }
                    match bs.next().await {
                        Some(Ok(b)) => {
                            buf.push_str(&String::from_utf8_lossy(&b));
                        }
                        Some(Err(e)) => {
                            return Some((
                                Err(AppError::Http(e)),
                                (bs, buf, started, first_token, pending_usage, final_emitted),
                            ));
                        }
                        None => return None,
                    }
                }
            },
        );
        Ok(s.boxed())
    }

    async fn installed(&self) -> bool {
        // mlx_lm.server is the baseline — if it's runnable, we consider MLX
        // installed. mlx_vlm is checked lazily at load time for multimodal models.
        let (bin, leading_args) = self.resolve_server("mlx_lm.server", "mlx_lm.server");
        let mut cmd = Command::new(&bin);
        for a in &leading_args {
            cmd.arg(a);
        }
        cmd.arg("--help")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
            .map(|s| s.success())
            .unwrap_or(false)
    }

    async fn version(&self) -> Option<String> {
        let out = Command::new(self.server_binary())
            .arg("--version")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .ok()?;
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if s.is_empty() {
            None
        } else {
            Some(s)
        }
    }
}

/// Walk $PATH for `name`, returning the first match. Avoids pulling in the
/// `which` crate just for this.
fn which(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/* ---------- shared OpenAI-compat wire types (parallel to llamacpp.rs) ---------- */

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<OaiMessage>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream_options: Option<StreamOptions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    top_p: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
}

#[derive(Serialize)]
struct StreamOptions {
    include_usage: bool,
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
struct OaiUsage {
    #[serde(default)]
    prompt_tokens: u32,
    #[serde(default)]
    completion_tokens: u32,
}

#[derive(Serialize)]
struct OaiMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct StreamFrame {
    #[serde(default)]
    choices: Vec<StreamChoice>,
    #[serde(default)]
    usage: Option<OaiUsage>,
}

#[derive(Deserialize)]
struct StreamChoice {
    #[serde(default)]
    delta: Delta,
    /// mlx-vlm sometimes returns the full assistant turn under `message`
    /// (non-streaming format) even when stream=true. Fall back to it when
    /// delta.content is empty.
    #[serde(default)]
    message: Option<NonStreamMessage>,
    #[serde(default)]
    finish_reason: Option<String>,
}

#[derive(Default, Deserialize)]
struct Delta {
    #[serde(default)]
    content: Option<String>,
}

#[derive(Deserialize)]
struct NonStreamMessage {
    #[serde(default)]
    content: Option<String>,
}

fn to_oai_message(m: &Message) -> OaiMessage {
    let role = match m.role {
        Role::System => "system",
        Role::User => "user",
        Role::Assistant => "assistant",
    }
    .to_string();
    let content: String = m
        .parts
        .iter()
        .filter_map(|p| match p {
            Part::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("");
    OaiMessage { role, content }
}

enum SseEvent {
    Chunk(TokenChunk),
    Usage(OaiUsage),
    Done,
}

fn take_event(buf: &str) -> Option<(SseEvent, String)> {
    let end = buf.find("\n\n").or_else(|| buf.find("\r\n\r\n"))?;
    let raw = &buf[..end];
    let rest = if buf[end..].starts_with("\r\n\r\n") {
        buf[end + 4..].to_string()
    } else {
        buf[end + 2..].to_string()
    };

    let mut data = String::new();
    for line in raw.lines() {
        let line = line.trim_end_matches('\r');
        if let Some(rest) = line.strip_prefix("data:") {
            data.push_str(rest.trim_start());
            data.push('\n');
        }
    }
    let data = data.trim();

    if data == "[DONE]" {
        return Some((SseEvent::Done, rest));
    }

    let frame: StreamFrame = match serde_json::from_str(data) {
        Ok(f) => f,
        Err(_) => {
            return Some((
                SseEvent::Chunk(TokenChunk {
                    text: String::new(),
                    done: false,
                    metrics: None,
                }),
                rest,
            ));
        }
    };

    if let Some(u) = frame.usage {
        return Some((SseEvent::Usage(u), rest));
    }

    // OpenAI-compat streaming sends one choice per frame. mlx_lm.server has
    // been observed sending two choices both carrying the same delta — treating
    // each emits every token twice. Take only choice[0].
    let mut text = String::new();
    let mut done = false;
    if let Some(c) = frame.choices.into_iter().next() {
        if let Some(t) = c.delta.content {
            text.push_str(&t);
        } else if let Some(msg) = c.message {
            // mlx-vlm fallback path (see NonStreamMessage doc).
            if let Some(t) = msg.content {
                text.push_str(&t);
            }
        }
        if c.finish_reason.is_some() {
            done = true;
        }
    }
    if !text.is_empty() {
        tracing::debug!(text = %text.chars().take(40).collect::<String>(), "mlx chunk");
    }
    Some((
        SseEvent::Chunk(TokenChunk {
            text,
            done,
            metrics: None,
        }),
        rest,
    ))
}

fn build_metrics(u: &OaiUsage, started: Instant, first_token: Option<Instant>) -> RuntimeMetrics {
    let now = Instant::now();
    let total_ms = (now - started).as_millis() as u32;
    let ttft_ms = first_token
        .map(|t| (t - started).as_millis() as u32)
        .unwrap_or(0);

    let decode_secs = if total_ms > ttft_ms {
        (total_ms - ttft_ms) as f32 / 1000.0
    } else {
        0.0
    };
    let decode = if decode_secs > 0.0 && u.completion_tokens > 0 {
        u.completion_tokens as f32 / decode_secs
    } else {
        0.0
    };
    let prefill = if ttft_ms > 0 && u.prompt_tokens > 0 {
        u.prompt_tokens as f32 / (ttft_ms as f32 / 1000.0)
    } else {
        0.0
    };

    RuntimeMetrics {
        tokens_per_sec_decode: decode,
        tokens_per_sec_prefill: prefill,
        ttft_ms,
        total_ms,
        prompt_tokens: u.prompt_tokens,
        completion_tokens: u.completion_tokens,
        hardware: Some("MLX · Metal".into()),
    }
}
