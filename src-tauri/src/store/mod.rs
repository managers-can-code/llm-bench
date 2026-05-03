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
        // Defensive migrations for existing DBs that predate column adds.
        // SQLite errors with 'duplicate column' if the column already exists;
        // we discard that since CREATE IF NOT EXISTS leaves old schema intact.
        let _ = conn.execute(
            "ALTER TABLE bench_runs ADD COLUMN total_ms INTEGER DEFAULT 0",
            [],
        );
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

    /* ---------- bench runs ---------- */

    pub fn insert_bench_run(&self, b: &crate::bench::BenchRun) -> AppResult<()> {
        let runtime_s = serde_json::to_value(b.runtime)?
            .as_str()
            .unwrap_or("llama_cpp")
            .to_string();
        self.conn.execute(
            "INSERT INTO bench_runs(
                id, model_id, runtime, device, prompt_tokens, decode_tokens,
                ttft_ms, prefill_tok_per_s, decode_tok_per_s,
                total_ms, peak_ram_mb, peak_vram_mb, energy_j, started_at
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
            params![
                b.id,
                b.model_id,
                runtime_s,
                b.device,
                b.prompt_tokens,
                b.decode_tokens,
                b.ttft_ms as f64,
                b.prefill_tok_per_s as f64,
                b.decode_tok_per_s as f64,
                b.total_ms as i64,
                b.peak_ram_mb as i64,
                b.peak_vram_mb as i64,
                b.energy_j.map(|f| f as f64),
                b.started_at,
            ],
        )?;
        Ok(())
    }

    pub fn list_bench_runs(&self) -> AppResult<Vec<crate::bench::BenchRun>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, model_id, runtime, device, prompt_tokens, decode_tokens,
                    ttft_ms, prefill_tok_per_s, decode_tok_per_s, total_ms,
                    peak_ram_mb, peak_vram_mb, energy_j, started_at
             FROM bench_runs ORDER BY started_at DESC LIMIT 200",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)? as u32,
                r.get::<_, i64>(5)? as u32,
                r.get::<_, f64>(6)? as f32,
                r.get::<_, f64>(7)? as f32,
                r.get::<_, f64>(8)? as f32,
                r.get::<_, i64>(9)? as u32,
                r.get::<_, i64>(10)? as u64,
                r.get::<_, i64>(11)? as u64,
                r.get::<_, Option<f64>>(12)?.map(|v| v as f32),
                r.get::<_, i64>(13)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (
                id,
                model_id,
                runtime_s,
                device,
                prompt_tokens,
                decode_tokens,
                ttft_ms,
                prefill_tok_per_s,
                decode_tok_per_s,
                total_ms,
                peak_ram_mb,
                peak_vram_mb,
                energy_j,
                started_at,
            ) = row?;
            let runtime: RuntimeId = serde_json::from_str(&format!("\"{}\"", runtime_s))?;
            out.push(crate::bench::BenchRun {
                id,
                model_id,
                runtime,
                device: device.clone(),
                prompt_tokens,
                decode_tokens,
                ttft_ms,
                prefill_tok_per_s,
                decode_tok_per_s,
                total_ms,
                peak_ram_mb,
                peak_vram_mb,
                energy_j,
                hardware: Some(device),
                started_at,
            });
        }
        Ok(out)
    }

    pub fn delete_bench_run(&self, id: &str) -> AppResult<()> {
        self.conn
            .execute("DELETE FROM bench_runs WHERE id = ?1", params![id])?;
        Ok(())
    }
}
