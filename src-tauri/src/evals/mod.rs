//! Eval harness — stubbed in v0.1.
//!
//! Each eval will implement the [`Eval`] trait and run against a (model, runtime)
//! pair, streaming progress and storing the final report. See PLAN.md §8.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::core::Model;
use crate::error::{AppError, AppResult};
use crate::runtimes::Runtime;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EvalCfg {
    pub subsample: Option<u32>,
    pub seed: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EvalReport {
    pub eval_id: String,
    pub score: f32,
    pub detail: serde_json::Value,
}

#[async_trait]
#[allow(dead_code)]
pub trait Eval: Send + Sync {
    fn id(&self) -> &str;
    fn dataset_size(&self) -> usize;
    async fn run(
        &self,
        model: &Model,
        runtime: &(dyn Runtime),
        cfg: EvalCfg,
    ) -> AppResult<EvalReport>;
}

/// v0.1 placeholder. Each real eval lands as a sibling module:
/// `mmlu.rs`, `bfcl.rs`, `taubench.rs`, `swebench.rs`.
pub struct NotImplementedEval(pub &'static str);

#[async_trait]
impl Eval for NotImplementedEval {
    fn id(&self) -> &str {
        self.0
    }
    fn dataset_size(&self) -> usize {
        0
    }
    async fn run(
        &self,
        _model: &Model,
        _runtime: &(dyn Runtime),
        _cfg: EvalCfg,
    ) -> AppResult<EvalReport> {
        Err(AppError::NotImplemented("eval"))
    }
}
