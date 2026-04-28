use serde::Serialize;
use thiserror::Error;

/// Error type used across the crate. Serializes to a string for IPC.
#[derive(Debug, Error)]
pub enum AppError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("invalid argument: {0}")]
    Invalid(String),

    #[error("runtime not available: {0}")]
    RuntimeUnavailable(String),

    #[error("checksum mismatch: expected {expected}, got {actual}")]
    Checksum { expected: String, actual: String },

    #[error("not implemented: {0}")]
    NotImplemented(&'static str),

    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

pub type AppResult<T> = Result<T, AppError>;

/// Tauri serializes errors as strings. Implement Serialize manually.
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
