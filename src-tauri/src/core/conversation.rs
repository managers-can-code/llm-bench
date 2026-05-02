use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::runtimes::RuntimeId;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    System,
    User,
    Assistant,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Part {
    Text { text: String },
    Image { sha256: String, mime: String },
    Audio { sha256: String, mime: String },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Message {
    pub role: Role,
    pub parts: Vec<Part>,
    /// Unix milliseconds.
    #[serde(default)]
    pub ts: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub model_id: String,
    pub runtime: RuntimeId,
    pub messages: Vec<Message>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Conversation {
    pub fn new(model_id: String, runtime: RuntimeId, title: Option<String>) -> Self {
        let now = chrono_now_ms();
        Self {
            id: Uuid::new_v4().to_string(),
            title: title.unwrap_or_else(|| "New chat".to_string()),
            model_id,
            runtime,
            messages: Vec::new(),
            created_at: now,
            updated_at: now,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
pub struct GenOpts {
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub top_k: Option<u32>,
    pub max_tokens: Option<u32>,
    pub seed: Option<u64>,
}

/// One token (or token group) streamed from the runtime.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TokenChunk {
    pub text: String,
    pub done: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metrics: Option<RuntimeMetrics>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct RuntimeMetrics {
    pub tokens_per_sec_decode: f32,
    pub tokens_per_sec_prefill: f32,
    pub ttft_ms: u32,
    pub total_ms: u32,
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    /// Free-form hardware label, e.g. "Metal", "CUDA", "CPU", "MLX/Metal".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hardware: Option<String>,
}

/// Lightweight wall-clock helper. We avoid pulling chrono in just for this.
fn chrono_now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
