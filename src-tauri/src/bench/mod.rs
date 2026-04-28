//! Benchmark harness — stubbed in v0.1.
//!
//! See PLAN.md §9. Will measure TTFT, prefill / decode tok/s, peak RAM/VRAM,
//! and energy where available, across (model × runtime × device).

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BenchCfg {
    pub prompt_tokens: u32,
    pub decode_tokens: u32,
    pub repeats: u32,
}

impl Default for BenchCfg {
    fn default() -> Self {
        Self {
            prompt_tokens: 128,
            decode_tokens: 256,
            repeats: 3,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct BenchReport {
    pub ttft_ms: f32,
    pub prefill_tok_per_s: f32,
    pub decode_tok_per_s: f32,
    pub peak_ram_mb: u64,
    pub peak_vram_mb: u64,
    pub energy_j: Option<f32>,
}
