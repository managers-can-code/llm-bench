-- llm-bench SQLite schema.
-- Bumped via migrations later; v0.1 just creates tables if missing.

CREATE TABLE IF NOT EXISTS conversations (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    model_id      TEXT NOT NULL,
    runtime       TEXT NOT NULL,
    messages_json TEXT NOT NULL DEFAULT '[]',
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_updated
    ON conversations (updated_at DESC);

-- Eval / bench result tables — schemas defined now so migrations stay simple.

CREATE TABLE IF NOT EXISTS eval_runs (
    id          TEXT PRIMARY KEY,
    eval_id     TEXT NOT NULL,           -- mmlu | bfcl | taubench | swebench
    model_id    TEXT NOT NULL,
    runtime     TEXT NOT NULL,
    score       REAL,                     -- normalized 0..1
    detail_json TEXT NOT NULL DEFAULT '{}',
    started_at  INTEGER NOT NULL,
    ended_at    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_eval_runs_started
    ON eval_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS bench_runs (
    id                TEXT PRIMARY KEY,
    model_id          TEXT NOT NULL,
    runtime           TEXT NOT NULL,
    device            TEXT NOT NULL,         -- cpu | gpu:0 | gpu:1 ...
    prompt_tokens     INTEGER NOT NULL,
    decode_tokens     INTEGER NOT NULL,
    ttft_ms           REAL,
    prefill_tok_per_s REAL,
    decode_tok_per_s  REAL,
    total_ms          INTEGER DEFAULT 0,
    peak_ram_mb       INTEGER,
    peak_vram_mb      INTEGER,
    energy_j          REAL,
    started_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bench_runs_started
    ON bench_runs (started_at DESC);
