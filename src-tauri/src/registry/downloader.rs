//! Hugging Face Hub downloader. Resumable, sha-verified, emits progress events.
//!
//! v0.1: anonymous downloads only (no token). v0.2 will add token support for
//! gated models.

use std::path::{Path, PathBuf};

use futures::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::fs::{self, File};
use tokio::io::{AsyncSeekExt, AsyncWriteExt};

use crate::core::RuntimeBinding;
use crate::error::{AppError, AppResult};
use crate::runtimes::RuntimeId;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DownloadState {
    Queued,
    Downloading,
    Verifying,
    Done,
    Error,
}

#[derive(Clone, Debug, Serialize)]
pub struct DownloadProgress {
    pub model_id: String,
    pub runtime: RuntimeId,
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub state: DownloadState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub async fn download(
    app: &AppHandle,
    model_id: &str,
    binding: &RuntimeBinding,
    dest: &Path,
) -> AppResult<()> {
    if !binding.available {
        return Err(AppError::RuntimeUnavailable(format!(
            "no public build available for {}",
            model_id
        )));
    }

    // Directory-mode (e.g. MLX repos): list every file in the repo and pull
    // it sequentially into `dest/<filename>`.
    if binding.hf_file == "*" {
        return download_repo_tree(app, model_id, binding, dest).await;
    }

    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).await?;
    }

    emit(
        app,
        DownloadProgress {
            model_id: model_id.into(),
            runtime: binding.runtime,
            bytes_done: 0,
            bytes_total: 0,
            state: DownloadState::Queued,
            error: None,
        },
    );

    let url = format!(
        "https://huggingface.co/{}/resolve/main/{}",
        binding.hf_repo, binding.hf_file
    );

    // Resume support: pass `Range: bytes=offset-` if a partial file exists.
    let already = match fs::metadata(dest).await {
        Ok(m) => m.len(),
        Err(_) => 0,
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60 * 60 * 4))
        .build()?;

    let mut req = client.get(&url);
    if already > 0 {
        req = req.header("Range", format!("bytes={}-", already));
    }
    let resp = req.send().await?;
    if !resp.status().is_success() && resp.status().as_u16() != 206 {
        return Err(AppError::Invalid(format!(
            "HF returned {} for {}",
            resp.status(),
            url
        )));
    }

    let total: u64 = resp
        .content_length()
        .map(|c| c + already)
        .unwrap_or(((binding.size_gb * 1024.0 * 1024.0 * 1024.0) as u64).max(1));

    let mut file = File::options()
        .create(true)
        .truncate(false) // keep existing bytes; resume writes from `already`
        .write(true)
        .read(true)
        .open(dest)
        .await?;
    file.seek(std::io::SeekFrom::Start(already)).await?;

    // Authoritative total = bytes already on disk + Content-Length of this response.
    // If Content-Length is missing (rare for HF), we accept any stream length but
    // can't verify completion.
    let response_len = resp.content_length();
    let authoritative_total = response_len.map(|c| c + already);

    let mut stream = resp.bytes_stream();
    let mut done: u64 = already;
    let mut last_emit = std::time::Instant::now();

    while let Some(item) = stream.next().await {
        let chunk = item?;
        file.write_all(&chunk).await?;
        done += chunk.len() as u64;
        if last_emit.elapsed() > std::time::Duration::from_millis(250) {
            last_emit = std::time::Instant::now();
            emit(
                app,
                DownloadProgress {
                    model_id: model_id.into(),
                    runtime: binding.runtime,
                    bytes_done: done,
                    bytes_total: total,
                    state: DownloadState::Downloading,
                    error: None,
                },
            );
        }
    }
    file.flush().await?;
    drop(file);

    // Refuse silent truncation: if the server told us how many bytes to expect
    // and we got fewer, fail and leave the partial on disk for the next call to
    // resume against.
    if let Some(want) = authoritative_total {
        if done < want {
            return Err(AppError::Invalid(format!(
                "download truncated: got {} of {} bytes for {} (will resume on next download)",
                done, want, binding.hf_file
            )));
        }
    }

    if let Some(expected) = &binding.sha256 {
        emit(
            app,
            DownloadProgress {
                model_id: model_id.into(),
                runtime: binding.runtime,
                bytes_done: done,
                bytes_total: total,
                state: DownloadState::Verifying,
                error: None,
            },
        );
        let actual = sha256_file(dest).await?;
        if &actual != expected {
            return Err(AppError::Checksum {
                expected: expected.clone(),
                actual,
            });
        }
    }

    emit(
        app,
        DownloadProgress {
            model_id: model_id.into(),
            runtime: binding.runtime,
            bytes_done: total,
            bytes_total: total,
            state: DownloadState::Done,
            error: None,
        },
    );
    Ok(())
}

async fn sha256_file(path: &Path) -> AppResult<String> {
    use sha2::{Digest, Sha256};
    use tokio::io::AsyncReadExt;
    let mut f = File::open(path).await?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        let n = f.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn emit(app: &AppHandle, p: DownloadProgress) {
    if let Err(e) = app.emit("model:download", &p) {
        tracing::warn!(error = %e, "failed to emit download progress");
    }
}

#[allow(dead_code)]
pub fn dest_for(app_dir: &Path, b: &RuntimeBinding) -> PathBuf {
    app_dir
        .join("models")
        .join(b.runtime.folder_name())
        .join(&b.hf_repo)
        .join(&b.hf_file)
}

/// Directory-mode download: fetch every file in an HF repo into `dest/`.
/// Used for MLX repos (and potentially other multi-file model formats).
async fn download_repo_tree(
    app: &AppHandle,
    model_id: &str,
    binding: &RuntimeBinding,
    dest: &Path,
) -> AppResult<()> {
    fs::create_dir_all(dest).await?;

    let api_url = format!("https://huggingface.co/api/models/{}", binding.hf_repo);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()?;
    let resp = client.get(&api_url).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::Invalid(format!(
            "HF API returned {} for {}",
            resp.status(),
            api_url
        )));
    }
    let info: HfRepoInfo = resp.json().await?;

    // Filter out files that aren't part of the model itself (.gitattributes, README.md).
    // Keep weights, tokenizer, config, and any *.json metadata.
    let files: Vec<_> = info
        .siblings
        .into_iter()
        .filter(|s| !is_repo_metadata(&s.rfilename))
        .collect();

    if files.is_empty() {
        return Err(AppError::Invalid(format!(
            "no model files found in {}",
            binding.hf_repo
        )));
    }

    for (idx, f) in files.iter().enumerate() {
        let file_dest = dest.join(&f.rfilename);
        if let Some(parent) = file_dest.parent() {
            fs::create_dir_all(parent).await?;
        }
        // Build a per-file binding so we can reuse single-file download path.
        let single = RuntimeBinding {
            runtime: binding.runtime,
            hf_repo: binding.hf_repo.clone(),
            hf_file: f.rfilename.clone(),
            size_gb: 0.0, // unknown; UI will show indeterminate progress
            available: true,
            sha256: None,
        };
        tracing::info!("[{}/{}] fetching {}", idx + 1, files.len(), f.rfilename);
        Box::pin(download(app, model_id, &single, &file_dest)).await?;
    }

    emit(
        app,
        DownloadProgress {
            model_id: model_id.into(),
            runtime: binding.runtime,
            bytes_done: 1,
            bytes_total: 1,
            state: DownloadState::Done,
            error: None,
        },
    );
    Ok(())
}

fn is_repo_metadata(filename: &str) -> bool {
    matches!(
        filename,
        ".gitattributes" | ".gitignore" | "LICENSE" | "LICENSE.md" | "NOTICE"
    ) || filename.starts_with("README")
}

#[derive(serde::Deserialize)]
struct HfRepoInfo {
    #[serde(default)]
    siblings: Vec<HfSibling>,
}

#[derive(serde::Deserialize)]
struct HfSibling {
    rfilename: String,
}
