//! Runtime abstraction. Each backend (llama.cpp, LiteRT-LM) implements this trait.

pub mod llamacpp;
pub mod litertlm;

use async_trait::async_trait;
use futures::stream::BoxStream;
use serde::{Deserialize, Serialize};

use crate::core::{GenOpts, Message, Modality, Model, TokenChunk};
use crate::error::AppResult;

#[derive(
    Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Hash,
)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeId {
    LlamaCpp,
    LiteRtLm,
}

impl RuntimeId {
    pub fn folder_name(self) -> &'static str {
        match self {
            RuntimeId::LlamaCpp => "llama_cpp",
            RuntimeId::LiteRtLm => "litert_lm",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Capabilities {
    pub modalities: Vec<Modality>,
    pub tool_calling: bool,
    pub max_ctx: u32,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct LoadOpts {
    pub device: Device,
    pub ctx: Option<u32>,
    pub batch: Option<u32>,
    pub gpu_layers: Option<i32>,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Device {
    #[default]
    Auto,
    Cpu,
    Gpu {
        idx: u32,
    },
}

/// Opaque session handle returned by `load`.
#[derive(Clone, Debug)]
pub struct SessionHandle {
    pub id: String,
}

#[async_trait]
pub trait Runtime: Send + Sync {
    fn id(&self) -> RuntimeId;
    fn capabilities(&self, model: &Model) -> Capabilities;

    /// Idempotent: if a session for this model is already loaded, returns it.
    async fn load(&self, model: &Model, opts: LoadOpts) -> AppResult<SessionHandle>;
    async fn unload(&self, h: &SessionHandle) -> AppResult<()>;

    /// Stream a chat completion. Returns a boxed stream of token chunks; the
    /// final chunk has `done = true` and (optionally) `metrics` populated.
    async fn chat<'a>(
        &'a self,
        h: &'a SessionHandle,
        msgs: &'a [Message],
        opts: GenOpts,
    ) -> AppResult<BoxStream<'a, AppResult<TokenChunk>>>;

    /// Whether the binary is installed and runnable.
    async fn installed(&self) -> bool;

    /// Reported version, if installed.
    async fn version(&self) -> Option<String>;
}
