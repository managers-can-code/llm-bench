//! Benchmark harness.
//!
//! Drives any registered runtime through a fixed prompt and captures
//! TTFT, prefill / decode tok/s, total ms, and peak memory. Results are
//! persisted to the `bench_runs` SQLite table for the Benchmarks page to
//! display.

use std::time::Instant;

use futures::StreamExt;
use serde::{Deserialize, Serialize};
use sysinfo::System;
use uuid::Uuid;

use crate::core::{GenOpts, Message, Model, Part, Role};
use crate::error::AppResult;
use crate::runtimes::{LoadOpts, Runtime};

/// Knobs controlling a single benchmark turn.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BenchCfg {
    /// Approximate prompt length to construct (filler text). Targets a token
    /// count but is approximate since tokenization differs per model.
    pub prompt_chars: u32,
    /// Cap on completion tokens generated. Lower = faster bench, less
    /// statistical signal on long-context decode.
    pub max_decode_tokens: u32,
}

impl Default for BenchCfg {
    fn default() -> Self {
        Self {
            prompt_chars: 512, // ~128 tokens at 4 chars/token
            max_decode_tokens: 256,
        }
    }
}

/// One row in the bench_runs table. Returned to the frontend on completion
/// and persisted to SQLite for history.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BenchRun {
    pub id: String,
    pub model_id: String,
    pub runtime: crate::runtimes::RuntimeId,
    pub device: String,
    pub prompt_tokens: u32,
    pub decode_tokens: u32,
    pub ttft_ms: f32,
    pub prefill_tok_per_s: f32,
    pub decode_tok_per_s: f32,
    pub total_ms: u32,
    pub peak_ram_mb: u64,
    pub peak_vram_mb: u64,
    pub energy_j: Option<f32>,
    /// Free-form hardware label from the runtime's RuntimeMetrics, if reported.
    pub hardware: Option<String>,
    pub started_at: i64,
}

/// Run one benchmark turn against the given runtime + model, return the
/// captured BenchRun row. Caller persists.
pub async fn run_benchmark<R: Runtime + ?Sized>(
    runtime: &R,
    model: &Model,
    cfg: &BenchCfg,
) -> AppResult<BenchRun> {
    let started_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    // Sample baseline RAM before load to compute peak delta.
    let mut sys = System::new();
    sys.refresh_memory();
    let baseline_ram_kb = sys.used_memory();

    let handle = runtime.load(model, LoadOpts::default()).await?;

    // Build a deterministic-ish filler prompt. Repeating a short phrase keeps
    // tokenization stable and makes the bench reproducible across runs.
    let prompt = filler_text(cfg.prompt_chars as usize);
    let messages = vec![Message {
        role: Role::User,
        parts: vec![Part::Text { text: prompt }],
        ts: None,
    }];
    let opts = GenOpts {
        temperature: Some(0.7),
        top_p: Some(0.95),
        top_k: Some(40),
        max_tokens: Some(cfg.max_decode_tokens),
        seed: Some(42), // fixed seed for reproducibility
    };

    let started = Instant::now();
    let mut stream = runtime.chat(&handle, &messages, opts).await?;

    let mut peak_ram_kb = baseline_ram_kb;
    let mut last_metrics = None;
    // Track wall-clock TTFT and total streamed text length so we can derive
    // metrics ourselves when the runtime's adapter doesn't surface them
    // (e.g. llama-server builds without stream_options.include_usage support).
    let mut first_chunk_at: Option<Instant> = None;
    let mut total_chars: usize = 0;
    while let Some(chunk_res) = stream.next().await {
        let chunk = chunk_res?;
        sys.refresh_memory();
        peak_ram_kb = peak_ram_kb.max(sys.used_memory());
        if !chunk.text.is_empty() && first_chunk_at.is_none() {
            first_chunk_at = Some(Instant::now());
        }
        total_chars += chunk.text.len();
        if let Some(m) = chunk.metrics {
            last_metrics = Some(m);
        }
        if chunk.done {
            break;
        }
    }
    let total_ms = (Instant::now() - started).as_millis() as u32;

    let metrics = last_metrics.unwrap_or_default();
    let peak_ram_mb = peak_ram_kb.saturating_sub(baseline_ram_kb) / 1024;

    // Fallback derivations from our own wall-clock when the runtime didn't
    // surface metrics. ~4 chars per token is a rough estimate but stable
    // enough for bench comparison. If the runtime DID give us numbers, we
    // prefer those.
    let measured_ttft_ms = first_chunk_at
        .map(|t| (t - started).as_millis() as u32)
        .unwrap_or(0);
    let est_tokens = (total_chars / 4) as u32;
    let measured_decode_tps = if total_ms > measured_ttft_ms && est_tokens > 0 {
        let secs = (total_ms - measured_ttft_ms) as f32 / 1000.0;
        if secs > 0.0 {
            est_tokens as f32 / secs
        } else {
            0.0
        }
    } else {
        0.0
    };

    let ttft_ms = if metrics.ttft_ms > 0 {
        metrics.ttft_ms as f32
    } else {
        measured_ttft_ms as f32
    };
    let decode_tps = if metrics.tokens_per_sec_decode > 0.0 {
        metrics.tokens_per_sec_decode
    } else {
        measured_decode_tps
    };
    let prompt_tokens = if metrics.prompt_tokens > 0 {
        metrics.prompt_tokens
    } else {
        // Rough estimate from prompt length.
        (cfg.prompt_chars / 4).max(1)
    };
    let completion_tokens = if metrics.completion_tokens > 0 {
        metrics.completion_tokens
    } else {
        est_tokens
    };
    let device = metrics
        .hardware
        .clone()
        .unwrap_or_else(|| match runtime.id() {
            crate::runtimes::RuntimeId::LlamaCpp => "llama.cpp · est".into(),
            crate::runtimes::RuntimeId::LiteRtLm => "LiteRT-LM · est".into(),
            crate::runtimes::RuntimeId::Mlx => "MLX · est".into(),
        });

    Ok(BenchRun {
        id: Uuid::new_v4().to_string(),
        model_id: model.id.clone(),
        runtime: runtime.id(),
        device: device.clone(),
        prompt_tokens,
        decode_tokens: completion_tokens,
        ttft_ms,
        prefill_tok_per_s: metrics.tokens_per_sec_prefill,
        decode_tok_per_s: decode_tps,
        total_ms,
        peak_ram_mb,
        peak_vram_mb: 0, // TODO: NVML on NVIDIA, IOReg on Apple Silicon
        energy_j: None,
        hardware: Some(device),
        started_at,
    })
}

/// Build approximately `n_chars` of filler text for a benchmark prompt.
/// Repeats a sentence to hit the target length without depending on a
/// tokenizer.
fn filler_text(n_chars: usize) -> String {
    const SEED: &str = "Explain how local LLM inference engines schedule and \
        batch token generation across CPU and GPU memory. ";
    let mut out = String::with_capacity(n_chars);
    while out.len() < n_chars {
        out.push_str(SEED);
    }
    out.truncate(n_chars);
    out
}
