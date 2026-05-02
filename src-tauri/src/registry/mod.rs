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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_json_parses_into_models() {
        let models: Vec<Model> =
            serde_json::from_str(SEED_JSON).expect("seed.json must deserialize");
        assert!(!models.is_empty(), "seed should have at least one model");
        // Every binding must have non-empty repo and file fields.
        for m in &models {
            for b in &m.bindings {
                assert!(!b.hf_repo.is_empty(), "{} binding missing hf_repo", m.id);
                assert!(!b.hf_file.is_empty(), "{} binding missing hf_file", m.id);
            }
        }
    }

    #[test]
    fn file_path_for_single_file() {
        let app_dir = PathBuf::from("/tmp/llm-bench");
        let b = RuntimeBinding {
            runtime: RuntimeId::LlamaCpp,
            hf_repo: "unsloth/test-GGUF".into(),
            hf_file: "test.gguf".into(),
            size_gb: 1.0,
            available: true,
            sha256: None,
        };
        let p = file_path_for(&app_dir, &b);
        assert_eq!(
            p,
            PathBuf::from("/tmp/llm-bench/models/llama_cpp/unsloth/test-GGUF/test.gguf")
        );
    }

    #[test]
    fn file_path_for_directory_mode() {
        let app_dir = PathBuf::from("/tmp/llm-bench");
        let b = RuntimeBinding {
            runtime: RuntimeId::Mlx,
            hf_repo: "mlx-community/test-4bit".into(),
            hf_file: "*".into(),
            size_gb: 1.0,
            available: true,
            sha256: None,
        };
        let p = file_path_for(&app_dir, &b);
        // For dir-mode, the path is the repo dir itself, no file suffix.
        assert_eq!(
            p,
            PathBuf::from("/tmp/llm-bench/models/mlx/mlx-community/test-4bit")
        );
    }

    #[test]
    fn refresh_local_state_marks_all_bindings_absent_for_empty_dir() {
        let tmp = tempfile_dir();
        let mut reg = Registry::with_seed(tmp.clone());
        reg.refresh_local_state();
        for m in &reg.models {
            for b in &m.bindings {
                assert_eq!(
                    m.local.get(&b.runtime).copied().unwrap_or(false),
                    false,
                    "{} ({}) should be marked absent",
                    m.id,
                    b.hf_repo
                );
            }
        }
    }

    fn tempfile_dir() -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!(
            "llm-bench-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&p).expect("create tempdir");
        p
    }
}
