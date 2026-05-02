//! LiteRT-LM adapter — drives the `litert-lm` CLI as a per-turn subprocess.
//!
//! LiteRT-LM doesn't expose an HTTP server today, so unlike llama.cpp/MLX we
//! spawn a fresh process for every assistant turn. Each turn:
//!
//!   1. Format the full message history into a single prompt string.
//!   2. Spawn `litert-lm run --model <path> --prompt <prompt>` with stdout piped.
//!   3. Stream stdout line-by-line as `TokenChunk`s.
//!
//! v0.3 should switch to the LiteRT-LM C++ API (via `cc` or `bindgen`) for
//! true token-level streaming and persistent KV cache across turns.

use std::path::PathBuf;
use std::process::Stdio;

use async_trait::async_trait;
use futures::stream::{self, BoxStream, StreamExt};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::core::{GenOpts, Message, Model, Part, Role, TokenChunk};
use crate::error::{AppError, AppResult};
use crate::runtimes::{Capabilities, LoadOpts, Runtime, RuntimeId, SessionHandle};

pub struct LiteRtLmRuntime {
    app_dir: PathBuf,
}

impl LiteRtLmRuntime {
    pub fn new(app_dir: PathBuf) -> Self {
        Self { app_dir }
    }

    fn cli_binary(&self) -> PathBuf {
        if let Ok(p) = std::env::var("LLM_BENCH_LITERTLM_BIN") {
            return PathBuf::from(p);
        }
        let exe = if cfg!(windows) {
            "litert-lm.exe"
        } else {
            "litert-lm"
        };
        self.app_dir.join("runtimes").join("litert_lm").join(exe)
    }

    fn local_model_path(&self, model: &Model) -> Option<PathBuf> {
        let binding = model
            .bindings
            .iter()
            .find(|b| b.runtime == RuntimeId::LiteRtLm && b.available)?;
        Some(
            self.app_dir
                .join("models")
                .join("litert_lm")
                .join(&binding.hf_repo)
                .join(&binding.hf_file),
        )
    }
}

#[async_trait]
impl Runtime for LiteRtLmRuntime {
    fn id(&self) -> RuntimeId {
        RuntimeId::LiteRtLm
    }

    fn capabilities(&self, model: &Model) -> Capabilities {
        Capabilities {
            modalities: model.modalities.clone(),
            tool_calling: true,
            max_ctx: model.ctx_max,
        }
    }

    async fn load(&self, model: &Model, _opts: LoadOpts) -> AppResult<SessionHandle> {
        let supported = model
            .bindings
            .iter()
            .any(|b| b.runtime == RuntimeId::LiteRtLm && b.available);
        if !supported {
            return Err(AppError::RuntimeUnavailable(format!(
                "no public LiteRT-LM build for {}; tracking in PLAN.md §14",
                model.id
            )));
        }
        if !self.cli_binary().exists() {
            return Err(AppError::RuntimeUnavailable(format!(
                "litert-lm CLI not installed at {} (set $LLM_BENCH_LITERTLM_BIN to override)",
                self.cli_binary().display()
            )));
        }
        // Verify the model file exists. `load` is otherwise a no-op for
        // LiteRT-LM since we re-spawn per turn.
        let model_path = self
            .local_model_path(model)
            .ok_or_else(|| AppError::NotFound(format!("local litertlm file for {}", model.id)))?;
        if !model_path.exists() {
            return Err(AppError::NotFound(format!(
                "model file not on disk: {}",
                model_path.display()
            )));
        }
        Ok(SessionHandle {
            id: model.id.clone(),
        })
    }

    async fn unload(&self, _h: &SessionHandle) -> AppResult<()> {
        Ok(())
    }

    async fn chat<'a>(
        &'a self,
        h: &'a SessionHandle,
        msgs: &'a [Message],
        opts: GenOpts,
    ) -> AppResult<BoxStream<'a, AppResult<TokenChunk>>> {
        let bin = self.cli_binary();
        // We need the model path again to invoke the CLI. We don't have a
        // reference to the Model here, so reconstruct from the session id
        // (which equals model.id) by walking the models dir.
        let model_dir = self.app_dir.join("models").join("litert_lm");
        let model_path = find_model_file(&model_dir, &h.id).await.ok_or_else(|| {
            AppError::NotFound(format!("could not locate .litertlm file for {}", h.id))
        })?;

        let prompt = format_prompt(msgs);

        let mut cmd = Command::new(&bin);
        cmd.arg("run").arg("--model").arg(&model_path);
        if let Some(t) = opts.temperature {
            cmd.arg("--temperature").arg(t.to_string());
        }
        if let Some(p) = opts.top_p {
            cmd.arg("--top-p").arg(p.to_string());
        }
        if let Some(m) = opts.max_tokens {
            cmd.arg("--max-tokens").arg(m.to_string());
        }
        // The CLI accepts the prompt either via --prompt or stdin. We use
        // --prompt for a single-shot exchange and avoid stdin coordination.
        cmd.arg("--prompt").arg(&prompt);
        cmd.stdout(Stdio::piped()).stderr(Stdio::inherit());

        tracing::info!(
            "spawning litert-lm: {} {}",
            cmd.as_std().get_program().to_string_lossy(),
            cmd.as_std()
                .get_args()
                .map(|a| a.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join(" ")
        );

        let mut child = cmd.spawn().map_err(|e| {
            AppError::RuntimeUnavailable(format!(
                "failed to spawn litert-lm at {}: {e}",
                bin.display()
            ))
        })?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AppError::Other(anyhow::anyhow!("no stdout from litert-lm")))?;
        let reader = BufReader::new(stdout);
        let lines = reader.lines();

        // Stream stdout line-by-line. Each line becomes a chunk; the final
        // chunk is emitted with done=true after the process exits.
        let s = stream::unfold(
            (lines, child, false),
            |(mut lines, mut child, finished)| async move {
                if finished {
                    return None;
                }
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        let chunk = TokenChunk {
                            text: format!("{line}\n"),
                            done: false,
                            metrics: None,
                        };
                        Some((Ok(chunk), (lines, child, false)))
                    }
                    Ok(None) => {
                        // Wait on the child; surface non-zero exits as errors.
                        let status = child.wait().await.ok();
                        let chunk = match status {
                            Some(s) if s.success() => TokenChunk {
                                text: String::new(),
                                done: true,
                                metrics: None,
                            },
                            Some(s) => TokenChunk {
                                text: format!("\n[litert-lm exited with status {s}]\n"),
                                done: true,
                                metrics: None,
                            },
                            None => TokenChunk {
                                text: "\n[litert-lm: failed to wait]\n".to_string(),
                                done: true,
                                metrics: None,
                            },
                        };
                        Some((Ok(chunk), (lines, child, true)))
                    }
                    Err(e) => Some((Err(AppError::Io(e)), (lines, child, true))),
                }
            },
        );
        Ok(s.boxed())
    }

    async fn installed(&self) -> bool {
        self.cli_binary().exists()
    }

    async fn version(&self) -> Option<String> {
        let bin = self.cli_binary();
        if !bin.exists() {
            return None;
        }
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

/// Walk `models/litert_lm/` looking for the `.litertlm` file whose path
/// matches the registry's expected location for `model_id`. We don't have
/// a registry reference inside the runtime, so this is an inexact filename
/// scan — good enough since model ids are unique slugs.
async fn find_model_file(root: &std::path::Path, model_id: &str) -> Option<PathBuf> {
    use tokio::fs;
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let mut rd = fs::read_dir(&dir).await.ok()?;
        while let Ok(Some(e)) = rd.next_entry().await {
            let p = e.path();
            let ft = e.file_type().await.ok()?;
            if ft.is_dir() {
                stack.push(p);
                continue;
            }
            if p.extension().and_then(|s| s.to_str()) == Some("litertlm") {
                // Match by the slug appearing somewhere in the path
                // (folder names usually contain it).
                let s = p.to_string_lossy();
                if s.contains(model_id) || s.contains(&model_id.replace('-', "_")) {
                    return Some(p);
                }
            }
        }
    }
    None
}

/// Render the message history as a plain-text prompt. Each runtime applies
/// its own chat template internally; here we pass a simple role-prefixed
/// transcript and let LiteRT-LM's loaded model handle templating.
fn format_prompt(msgs: &[Message]) -> String {
    let mut out = String::new();
    for m in msgs {
        let role = match m.role {
            Role::System => "system",
            Role::User => "user",
            Role::Assistant => "assistant",
        };
        let body: String = m
            .parts
            .iter()
            .filter_map(|p| match p {
                Part::Text { text } => Some(text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("");
        out.push_str(role);
        out.push_str(": ");
        out.push_str(&body);
        out.push('\n');
    }
    out.push_str("assistant:");
    out
}
