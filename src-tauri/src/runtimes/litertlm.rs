//! LiteRT-LM adapter — stub for v0.1.
//!
//! In v0.1 we shell out to the `litert-lm` CLI for `chat` only. v0.2 will
//! switch to the C++ API via FFI for lower latency and proper streaming.
//!
//! Note: as of plan-time, LiteRT-LM does not yet have public `.litertlm`
//! desktop builds for our 26B+ models. The `available` flag on each
//! `RuntimeBinding` reflects this; `load` returns `RuntimeUnavailable` when
//! invoked on an unsupported model.

use std::path::PathBuf;

use async_trait::async_trait;
use futures::stream::{self, BoxStream, StreamExt};

use crate::core::{GenOpts, Message, Model, TokenChunk};
use crate::error::{AppError, AppResult};
use crate::runtimes::{
    Capabilities, LoadOpts, Runtime, RuntimeId, SessionHandle,
};

pub struct LiteRtLmRuntime {
    app_dir: PathBuf,
}

impl LiteRtLmRuntime {
    pub fn new(app_dir: PathBuf) -> Self {
        Self { app_dir }
    }

    fn cli_binary(&self) -> PathBuf {
        let exe = if cfg!(windows) {
            "litert-lm.exe"
        } else {
            "litert-lm"
        };
        self.app_dir.join("runtimes").join("litert_lm").join(exe)
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
            return Err(AppError::RuntimeUnavailable(
                "litert-lm CLI not installed".into(),
            ));
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
        _h: &'a SessionHandle,
        _msgs: &'a [Message],
        _opts: GenOpts,
    ) -> AppResult<BoxStream<'a, AppResult<TokenChunk>>> {
        // v0.1 stub. Returns a single chunk explaining the state of the world.
        let chunk = TokenChunk {
            text: "[LiteRT-LM adapter is stubbed in v0.1 — see PLAN.md §12]"
                .to_string(),
            done: true,
            metrics: None,
        };
        Ok(stream::iter(vec![Ok(chunk)]).boxed())
    }

    async fn installed(&self) -> bool {
        self.cli_binary().exists()
    }

    async fn version(&self) -> Option<String> {
        // Once the CLI is installed: invoke `litert-lm --version` like in llamacpp.rs.
        None
    }
}
