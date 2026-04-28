//! llm-bench — desktop app library entrypoint.
//!
//! See [PLAN.md](../../PLAN.md) for the full architecture. The walking skeleton
//! wires up:
//!   - Runtime trait + LlamaCppRuntime adapter (subprocess + HTTP)
//!   - LiteRtLmRuntime stub
//!   - Model registry seeded with 4 models (Gemma 4 26B-A4B, Gemma 4 31B,
//!     Qwen3.6-27B, Qwen3.6-35B-A3B) at int4
//!   - HF Hub downloader for GGUF
//!   - SQLite-backed conversation store
//!   - Tauri commands callable from the React frontend

pub mod bench;
pub mod commands;
pub mod core;
pub mod error;
pub mod evals;
pub mod registry;
pub mod runtimes;
pub mod store;

use std::sync::Arc;

use tokio::sync::Mutex;

use crate::registry::Registry;
use crate::runtimes::{llamacpp::LlamaCppRuntime, litertlm::LiteRtLmRuntime, RuntimeId};
use crate::store::Store;

/// App state held inside Tauri. Cheap to clone (Arc).
pub struct AppState {
    pub registry: Arc<Mutex<Registry>>,
    pub store: Arc<Mutex<Store>>,
    pub llama_cpp: Arc<LlamaCppRuntime>,
    pub litert_lm: Arc<LiteRtLmRuntime>,
}

impl AppState {
    pub fn runtime(
        &self,
        id: RuntimeId,
    ) -> Arc<dyn crate::runtimes::Runtime + Send + Sync> {
        match id {
            RuntimeId::LlamaCpp => self.llama_cpp.clone(),
            RuntimeId::LiteRtLm => self.litert_lm.clone(),
        }
    }
}

/// Run the Tauri app. Called from `main.rs`.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "llm_bench=info,warn".into()),
        )
        .with_target(false)
        .init();

    let app_dir = crate::core::paths::app_data_dir();
    std::fs::create_dir_all(&app_dir).expect("create app data dir");

    let store = Store::open(app_dir.join("store.sqlite"))
        .expect("open SQLite store");
    let registry = Registry::with_seed(app_dir.clone());

    let state = AppState {
        registry: Arc::new(Mutex::new(registry)),
        store: Arc::new(Mutex::new(store)),
        llama_cpp: Arc::new(LlamaCppRuntime::new(app_dir.clone())),
        litert_lm: Arc::new(LiteRtLmRuntime::new(app_dir.clone())),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::list_models,
            commands::download_model,
            commands::delete_local_model,
            commands::list_conversations,
            commands::create_conversation,
            commands::get_conversation,
            commands::delete_conversation,
            commands::start_chat_turn,
            commands::cancel_chat,
            commands::runtime_status,
        ])
        .setup(|_app| {
            tracing::info!("llm-bench starting");
            // Future: prefetch runtime versions, warm caches, etc.
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
