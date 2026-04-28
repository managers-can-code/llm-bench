//! Filesystem layout for the app's runtime data.
//!
//! Everything user-visible lives under `~/.llm-bench/`:
//!
//! ```text
//! ~/.llm-bench/
//!   store.sqlite          -- conversations, eval/bench runs
//!   models/
//!     llama_cpp/<repo>/<file>.gguf
//!     litert_lm/<repo>/<file>.litertlm
//!   runtimes/
//!     llama_cpp/llama-server[.exe]
//!     litert_lm/litert-lm[.exe]
//!   assets/<sha256>        -- chat attachments (images, audio)
//!   logs/
//! ```

use std::path::PathBuf;

pub fn app_data_dir() -> PathBuf {
    if let Ok(p) = std::env::var("LLM_BENCH_HOME") {
        return PathBuf::from(p);
    }
    let home = dirs::home_dir().expect("could not determine home directory");
    home.join(".llm-bench")
}

pub fn models_dir() -> PathBuf {
    app_data_dir().join("models")
}

pub fn runtimes_dir() -> PathBuf {
    app_data_dir().join("runtimes")
}

pub fn assets_dir() -> PathBuf {
    app_data_dir().join("assets")
}
