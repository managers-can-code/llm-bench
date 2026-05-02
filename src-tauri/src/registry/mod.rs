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
        let mut models: Vec<Model> =
            serde_json::from_str(SEED_JSON).expect("seed.json is malformed — fix it");
        let imported_path = app_dir.join("imported.json");
        if imported_path.exists() {
            if let Ok(s) = std::fs::read_to_string(&imported_path) {
                if !s.trim().is_empty() {
                    match serde_json::from_str::<Vec<Model>>(&s) {
                        Ok(extra) => models.extend(extra),
                        Err(e) => {
                            tracing::warn!(error=%e, "imported.json malformed; ignoring")
                        }
                    }
                }
            }
        }
        Self { app_dir, models }
    }

    pub fn add_imported(&mut self, model: Model) -> std::io::Result<()> {
        self.models.push(model);
        self.save_imported()
    }

    /// Persist all imported (non-seed) models to disk for restart survival.
    /// Identifies imported models by their `imported/...` hf_repo prefix.
    pub fn save_imported(&self) -> std::io::Result<()> {
        let imported: Vec<&Model> = self
            .models
            .iter()
            .filter(|m| {
                m.bindings
                    .iter()
                    .any(|b| b.hf_repo.starts_with("imported/"))
            })
            .collect();
        let path = self.app_dir.join("imported.json");
        let json = serde_json::to_string_pretty(&imported)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        std::fs::write(path, json)
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
    let base = app_dir
        .join("models")
        .join(b.runtime.folder_name())
        .join(&b.hf_repo);
    if b.hf_file == "*" {
        // Directory-mode binding (e.g. MLX repos): the whole repo is the model.
        base
    } else {
        base.join(&b.hf_file)
    }
}
