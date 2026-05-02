//! llama.cpp adapter — manages a `llama-server` subprocess and talks to its
//! OpenAI-compatible HTTP endpoint.
//!
//! v0.1 spawns a single server per app; loading a different model unloads the
//! previous. v0.2 will support a small pool.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use futures::stream::{self, BoxStream, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use crate::core::{Arch, GenOpts, Message, Model, Part, Role, RuntimeMetrics, TokenChunk};
use crate::error::{AppError, AppResult};
use crate::runtimes::{Capabilities, LoadOpts, Runtime, RuntimeId, SessionHandle};

pub struct LlamaCppRuntime {
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
    /// id of the model currently loaded
    model_id: String,
}

impl Drop for ServerProcess {
    fn drop(&mut self) {
        // best-effort kill — Tauri may have already terminated us
        let _ = self.child.start_kill();
    }
}

impl LlamaCppRuntime {
    pub fn new(app_dir: PathBuf) -> Self {
        Self {
            app_dir,
            inner: Arc::new(Mutex::new(Inner {
                server: None,
                base_url: "http://127.0.0.1:18080".to_string(),
                http: reqwest::Client::builder()
                    .timeout(Duration::from_secs(60 * 30)) // 30 min for long generations
                    .build()
                    .expect("build http client"),
            })),
        }
    }

    fn server_binary(&self) -> PathBuf {
        let exe = if cfg!(windows) {
            "llama-server.exe"
        } else {
            "llama-server"
        };
        self.app_dir.join("runtimes").join("llama_cpp").join(exe)
    }

    fn local_model_path(&self, model: &Model) -> Option<PathBuf> {
        let binding = model
            .bindings
            .iter()
            .find(|b| b.runtime == RuntimeId::LlamaCpp && b.available)?;
        Some(
            self.app_dir
                .join("models")
                .join("llama_cpp")
                .join(&binding.hf_repo)
                .join(&binding.hf_file),
        )
    }
}

#[async_trait]
impl Runtime for LlamaCppRuntime {
    fn id(&self) -> RuntimeId {
        RuntimeId::LlamaCpp
    }

    fn capabilities(&self, model: &Model) -> Capabilities {
        Capabilities {
            modalities: model.modalities.clone(),
            // Both Gemma 4 and Qwen 3.6 support tool calling per their model cards.
            tool_calling: true,
            max_ctx: model.ctx_max,
        }
    }

    async fn load(&self, model: &Model, opts: LoadOpts) -> AppResult<SessionHandle> {
        let mut g = self.inner.lock().await;

        // If the right model is already loaded, return its handle.
        if let Some(srv) = &g.server {
            if srv.model_id == model.id {
                return Ok(SessionHandle {
                    id: model.id.clone(),
                });
            }
        }

        // Drop existing server (Drop kills the child) and give the OS time
        // to release port 18080 before we try to bind again.
        if g.server.take().is_some() {
            tokio::time::sleep(Duration::from_millis(750)).await;
        }

        let model_path = self
            .local_model_path(model)
            .ok_or_else(|| AppError::NotFound(format!("local file for {}", model.id)))?;

        if !model_path.exists() {
            return Err(AppError::NotFound(format!(
                "model file not on disk: {}",
                model_path.display()
            )));
        }

        let bin = self.server_binary();
        if !bin.exists() {
            return Err(AppError::RuntimeUnavailable(format!(
                "llama-server not installed at {}",
                bin.display()
            )));
        }

        // Default ctx of 4096 keeps total VRAM (model + KV + compute) inside
        // the M-series working-set limit on consumer Macs. Users with more VRAM
        // can override via LoadOpts. Default batch of 512 keeps the compute
        // buffer modest; raising it speeds up prefill at the cost of more VRAM.
        let mut cmd = Command::new(bin);
        cmd.arg("--model")
            .arg(&model_path)
            .arg("--port")
            .arg("18080")
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--ctx-size")
            .arg(opts.ctx.unwrap_or(4096).to_string())
            .arg("--batch-size")
            .arg(opts.batch.unwrap_or(512).to_string());

        if let Some(layers) = opts.gpu_layers {
            cmd.arg("--n-gpu-layers").arg(layers.to_string());
        }

        // For MoE models on memory-constrained GPUs (e.g. Apple Silicon's
        // ~19 GB working set), offload expert tensors to CPU. Active params
        // (attention, embeddings, the few "active" expert columns per token)
        // stay on GPU. On unified-memory Macs the CPU side still reads from
        // shared RAM at ~400 GB/s, so the perf hit is modest while VRAM
        // pressure drops dramatically. v0.2: make this configurable per-model.
        if matches!(model.arch, Arch::Moe { .. }) {
            // Pattern matches blk.N.ffn_{up,down,gate}_exps.weight tensors
            // (the canonical Mixtral / Gemma-MoE / Qwen-MoE expert names).
            cmd.arg("--override-tensor")
                .arg("\\.ffn_(up|down|gate)_exps\\.weight=CPU");
            // mmap + override-tensor is a known footgun: with mmap enabled,
            // pages "routed" to CPU still get demand-paged into Metal's
            // working set on Apple Silicon, defeating the offload. Disable
            // mmap so each device gets explicit, separate buffer allocation.
            // Cost: ~30s slower model load on cold cache; worth it.
            cmd.arg("--no-mmap");
        }

        tracing::info!(
            "spawning llama-server: {} {}",
            cmd.as_std().get_program().to_string_lossy(),
            cmd.as_std()
                .get_args()
                .map(|a| a.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join(" ")
        );

        // Inherit stdio so llama-server's startup logs appear in the dev console.
        // (v0.2: capture into ring buffer, surface in UI.)
        cmd.stdout(Stdio::inherit()).stderr(Stdio::inherit());

        let child = cmd.spawn()?;
        g.server = Some(ServerProcess {
            child,
            model_id: model.id.clone(),
        });

        // Wait until /health responds. A 22 GB int4 model on cold-cache mmap
        // can take well over 30s to load on first run; allow up to 5 min.
        let url = format!("{}/health", g.base_url);
        let http = g.http.clone();
        drop(g);
        let deadline = Instant::now() + Duration::from_secs(300);
        let mut last_err: Option<String> = None;
        while Instant::now() < deadline {
            match http.get(&url).send().await {
                Ok(r) if r.status().is_success() => {
                    tracing::info!("llama-server ready");
                    return Ok(SessionHandle {
                        id: model.id.clone(),
                    });
                }
                Ok(r) => {
                    last_err = Some(format!("health responded {}", r.status()));
                }
                Err(e) => {
                    last_err = Some(format!("connect: {e}"));
                }
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        Err(AppError::RuntimeUnavailable(format!(
            "llama-server did not become healthy in 5 min (last: {})",
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
        drop(g);

        let body = ChatRequest {
            model: "local".into(),
            messages: msgs.iter().map(to_oai_message).collect(),
            stream: true,
            stream_options: Some(StreamOptions {
                include_usage: true,
            }),
            temperature: opts.temperature,
            top_p: opts.top_p,
            max_tokens: opts.max_tokens,
            seed: opts.seed,
        };

        let started = Instant::now();
        let resp = http.post(url).json(&body).send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let txt = resp.text().await.unwrap_or_default();
            return Err(AppError::RuntimeUnavailable(format!(
                "llama-server returned {status}: {txt}"
            )));
        }

        let byte_stream = resp.bytes_stream();
        // unfold state: (byte stream, parse buffer, started_at, ttft snapshot,
        // pending usage frame, has-emitted-final flag).
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
                                    let metrics = pending_usage
                                        .as_ref()
                                        .map(|u| build_metrics(u, started, first_token));
                                    chunk.metrics = metrics;
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
        self.server_binary().exists()
    }

    async fn version(&self) -> Option<String> {
        let bin = self.server_binary();
        if !bin.exists() {
            return None;
        }
        // Best effort: `llama-server --version`. Some builds don't support it.
        let out = Command::new(bin)
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

/* ---------- OpenAI-compat wire types ---------- */

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
    #[serde(skip_serializing_if = "Option::is_none")]
    seed: Option<u64>,
}

#[derive(Serialize)]
struct StreamOptions {
    include_usage: bool,
}

#[derive(Clone, Copy, Debug, Deserialize)]
struct OaiUsage {
    #[serde(default)]
    prompt_tokens: u32,
    #[serde(default)]
    completion_tokens: u32,
    /// llama.cpp's extension: prompt processing + decode tok/s.
    #[serde(default)]
    prompt_per_second: Option<f32>,
    #[serde(default)]
    predicted_per_second: Option<f32>,
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
    /// llama.cpp emits a top-level `timings` object with prefill/decode tok/s.
    #[serde(default)]
    timings: Option<LlamaCppTimings>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
struct LlamaCppTimings {
    #[serde(default)]
    prompt_per_second: Option<f32>,
    #[serde(default)]
    predicted_per_second: Option<f32>,
}

#[derive(Deserialize)]
struct StreamChoice {
    #[serde(default)]
    delta: Delta,
    #[serde(default)]
    finish_reason: Option<String>,
}

#[derive(Default, Deserialize)]
struct Delta {
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
    // v0.1: only text parts. Vision/audio handling lands in v0.2.
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

/// Parse one SSE event from `buf`, returning `(event, remaining_buf)`.
/// Returns None if the buffer doesn't yet contain a full event.
fn take_event(buf: &str) -> Option<(SseEvent, String)> {
    // SSE events end with a blank line.
    let end = buf.find("\n\n").or_else(|| buf.find("\r\n\r\n"))?;
    let raw = &buf[..end];
    let rest = if buf[end..].starts_with("\r\n\r\n") {
        buf[end + 4..].to_string()
    } else {
        buf[end + 2..].to_string()
    };

    // Concatenate `data:` lines.
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
            // Tolerate unparseable lines (e.g. server error pings).
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

    // A frame with usage but no choices (or empty choices) is the final
    // metrics frame emitted when stream_options.include_usage = true.
    if let Some(u) = frame.usage {
        // Merge any timings llama.cpp tucked next to the usage.
        let merged = OaiUsage {
            prompt_tokens: u.prompt_tokens,
            completion_tokens: u.completion_tokens,
            prompt_per_second: u
                .prompt_per_second
                .or(frame.timings.and_then(|t| t.prompt_per_second)),
            predicted_per_second: u
                .predicted_per_second
                .or(frame.timings.and_then(|t| t.predicted_per_second)),
        };
        return Some((SseEvent::Usage(merged), rest));
    }

    let mut text = String::new();
    let mut done = false;
    if let Some(c) = frame.choices.into_iter().next() {
        if let Some(t) = c.delta.content {
            text.push_str(&t);
        }
        if c.finish_reason.is_some() {
            done = true;
        }
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

/// Combine timed-on-our-side TTFT/total with server-provided usage into a
/// `RuntimeMetrics`.
fn build_metrics(u: &OaiUsage, started: Instant, first_token: Option<Instant>) -> RuntimeMetrics {
    let now = Instant::now();
    let total_ms = (now - started).as_millis() as u32;
    let ttft_ms = first_token
        .map(|t| (t - started).as_millis() as u32)
        .unwrap_or(0);

    // Prefer server-reported tok/s; fall back to deriving decode tok/s
    // from completion_tokens and (total - ttft) ms.
    let decode_secs = if total_ms > ttft_ms {
        (total_ms - ttft_ms) as f32 / 1000.0
    } else {
        0.0
    };
    let decode = u.predicted_per_second.unwrap_or_else(|| {
        if decode_secs > 0.0 && u.completion_tokens > 0 {
            u.completion_tokens as f32 / decode_secs
        } else {
            0.0
        }
    });
    let prefill = u.prompt_per_second.unwrap_or_else(|| {
        if ttft_ms > 0 && u.prompt_tokens > 0 {
            u.prompt_tokens as f32 / (ttft_ms as f32 / 1000.0)
        } else {
            0.0
        }
    });

    RuntimeMetrics {
        tokens_per_sec_decode: decode,
        tokens_per_sec_prefill: prefill,
        ttft_ms,
        total_ms,
        prompt_tokens: u.prompt_tokens,
        completion_tokens: u.completion_tokens,
        hardware: hardware_label(),
    }
}

/// Best-effort hardware label for the bubble footer. Refined later by
/// reading actual device info from llama.cpp's startup logs.
fn hardware_label() -> Option<String> {
    if cfg!(target_os = "macos") {
        Some("llama.cpp · Metal".to_string())
    } else if cfg!(target_os = "windows") {
        Some("llama.cpp · CUDA/Vulkan".to_string())
    } else {
        Some("llama.cpp · CPU".to_string())
    }
}
