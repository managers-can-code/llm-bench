use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::runtimes::RuntimeId;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum ModelFamily {
    #[serde(rename = "gemma_4")]
    Gemma4,
    #[serde(rename = "qwen_3_6")]
    Qwen36,
    #[serde(rename = "other")]
    Other,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Arch {
    Dense,
    Moe { active_b: f32, total_b: f32 },
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Modality {
    Text,
    Vision,
    Audio,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum Quant {
    #[serde(rename = "q4_k_m")]
    Q4KM,
    #[serde(rename = "ud_q4_k_xl")]
    UdQ4KXl,
    #[serde(rename = "iq4_xs")]
    Iq4Xs,
    #[serde(rename = "iq4_nl")]
    Iq4Nl,
    #[serde(rename = "mxfp4")]
    Mxfp4,
    #[serde(rename = "other")]
    Other,
}

/// One way to obtain this model: which runtime, which HF repo, which file.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RuntimeBinding {
    pub runtime: RuntimeId,
    pub hf_repo: String,
    pub hf_file: String,
    pub size_gb: f32,
    /// false when no public build exists yet.
    pub available: bool,
    /// Optional SHA-256 of the file. If missing, downloader does not verify.
    #[serde(default)]
    pub sha256: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Model {
    pub id: String,
    pub display_name: String,
    pub family: ModelFamily,
    pub arch: Arch,
    pub modalities: Vec<Modality>,
    pub quant: Quant,
    pub ctx_max: u32,
    pub bindings: Vec<RuntimeBinding>,

    /// Per-runtime locality flag, populated at list time.
    #[serde(default)]
    pub local: HashMap<RuntimeId, bool>,
}
