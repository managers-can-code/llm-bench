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
        .write(true)
        .read(true)
        .open(dest)
        .await?;
    file.seek(std::io::SeekFrom::Start(already)).await?;

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
