//! Model registry: catalog of known models + per-runtime download/install state.

pub mod downloader;

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::core::{Model, RuntimeBinding};
use crate::runtimes::RuntimeId;

const SEED_JSON: &str = include_str!("seed.json");

pub struct Registry {
    pub app_dir: PathBuf,
    pub models: Vec<Model>,
}

impl Registry {
    pub fn with_seed(app_dir: PathBuf) -> Self {
        let models: Vec<Model> = serde_json::from_str(SEED_JSON)
            .expect("seed.json is malformed — fix it");
        Self { app_dir, models }
    }

    /// Refresh the per-runtime `local` map for every model based on what's on disk.
    pub fn refresh_local_state(&mut self) {
        for model in &mut self.models {
            let mut local: HashMap<RuntimeId, bool> = HashMap::new();
            for b in &model.bindings {
                local.insert(b.runtime, file_path_for(&self.app_dir, b).exists());
            }
            model.local = local;
        }
    }

    pub fn find(&self, model_id: &str) -> Option<&Model> {
        self.models.iter().find(|m| m.id == model_id)
    }

    pub fn binding_for<'a>(
        &'a self,
        model_id: &str,
        runtime: RuntimeId,
    ) -> Option<&'a RuntimeBinding> {
        self.find(model_id)?
            .bindings
            .iter()
            .find(|b| b.runtime == runtime)
    }
}

pub fn file_path_for(app_dir: &Path, b: &RuntimeBinding) -> PathBuf {
    app_dir
        .join("models")
        .join(b.runtime.folder_name())
        .join(&b.hf_repo)
        .join(&b.hf_file)
}
