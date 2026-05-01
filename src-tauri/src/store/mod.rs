//! SQLite-backed conversation + run store. Synchronous (rusqlite) wrapped in
//! a Mutex; for v0.1 throughput is fine. v0.2 may move to an async pool.

use std::path::Path;

use rusqlite::{params, Connection};

use crate::core::{Conversation, Message};
use crate::error::AppResult;
use crate::runtimes::RuntimeId;

pub struct Store {
    pub conn: Connection,
}

const SCHEMA: &str = include_str!("schema.sql");

impl Store {
    pub fn open(path: impl AsRef<Path>) -> AppResult<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn })
    }

    pub fn list_conversations(&self) -> AppResult<Vec<Conversation>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, model_id, runtime, messages_json, created_at, updated_at
             FROM conversations ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, i64>(5)?,
                r.get::<_, i64>(6)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (id, title, model_id, runtime_s, messages_json, created_at, updated_at) = row?;
            let runtime: RuntimeId = serde_json::from_str(&format!("\"{}\"", runtime_s))
                .map_err(crate::error::AppError::Json)?;
            let messages: Vec<Message> = serde_json::from_str(&messages_json)?;
            out.push(Conversation {
                id,
                title,
                model_id,
                runtime,
                messages,
                created_at,
                updated_at,
            });
        }
        Ok(out)
    }

    pub fn get_conversation(&self, id: &str) -> AppResult<Conversation> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, model_id, runtime, messages_json, created_at, updated_at
             FROM conversations WHERE id = ?1",
        )?;
        let (id, title, model_id, runtime_s, messages_json, created_at, updated_at) = stmt
            .query_row(params![id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, i64>(5)?,
                    r.get::<_, i64>(6)?,
                ))
            })?;
        let runtime: RuntimeId = serde_json::from_str(&format!("\"{}\"", runtime_s))?;
        let messages: Vec<Message> = serde_json::from_str(&messages_json)?;
        Ok(Conversation {
            id,
            title,
            model_id,
            runtime,
            messages,
            created_at,
            updated_at,
        })
    }

    pub fn upsert_conversation(&self, c: &Conversation) -> AppResult<()> {
        let runtime_s = serde_json::to_value(c.runtime)?
            .as_str()
            .unwrap_or("llama_cpp")
            .to_string();
        let messages_json = serde_json::to_string(&c.messages)?;
        self.conn.execute(
            "INSERT INTO conversations(id, title, model_id, runtime, messages_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
               title=excluded.title,
               model_id=excluded.model_id,
               runtime=excluded.runtime,
               messages_json=excluded.messages_json,
               updated_at=excluded.updated_at",
            params![
                c.id,
                c.title,
                c.model_id,
                runtime_s,
                messages_json,
                c.created_at,
                c.updated_at
            ],
        )?;
        Ok(())
    }

    pub fn delete_conversation(&self, id: &str) -> AppResult<()> {
        self.conn
            .execute("DELETE FROM conversations WHERE id = ?1", params![id])?;
        Ok(())
    }
}
