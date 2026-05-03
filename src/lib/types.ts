// Mirror of the Rust core domain types in src-tauri/src/core/.
// Keep this file in sync with the #[derive(Serialize)] structs there.
// (A future task is to autogenerate this with `ts-rs`.)

export type RuntimeId = "llama_cpp" | "litert_lm" | "mlx";

export const ALL_RUNTIMES: RuntimeId[] = ["llama_cpp", "litert_lm", "mlx"];

export const RUNTIME_LABELS: Record<RuntimeId, string> = {
  llama_cpp: "llama.cpp",
  litert_lm: "LiteRT-LM",
  mlx: "MLX",
};

export type Arch =
  | { kind: "dense" }
  | { kind: "moe"; active_b: number; total_b: number };

export type Modality = "text" | "vision" | "audio";

export type Quant =
  | "q4_k_m"
  | "ud_q4_k_xl"
  | "iq4_xs"
  | "iq4_nl"
  | "mxfp4"
  | "other";

export interface RuntimeBinding {
  runtime: RuntimeId;
  /** HF repo id, e.g. "unsloth/gemma-4-31B-it-GGUF" */
  hf_repo: string;
  /** filename within the repo, e.g. "gemma-4-31B-it-UD-Q4_K_XL.gguf" */
  hf_file: string;
  size_gb: number;
  /** false when no public build exists yet (e.g. LiteRT-LM 26B/31B) */
  available: boolean;
}

export interface Model {
  id: string; // stable slug, e.g. "gemma-4-31b-dense-q4kxl"
  display_name: string;
  family: "gemma_4" | "qwen_3_6";
  arch: Arch;
  modalities: Modality[];
  quant: Quant;
  ctx_max: number;
  bindings: RuntimeBinding[];
  /** present locally? per-runtime */
  local: Partial<Record<RuntimeId, boolean>>;
}

export type Role = "system" | "user" | "assistant";

export type Part =
  | { kind: "text"; text: string }
  | { kind: "image"; sha256: string; mime: string }
  | { kind: "audio"; sha256: string; mime: string };

export interface Message {
  role: Role;
  parts: Part[];
  ts?: number; // unix ms
}

export interface Conversation {
  id: string;
  title: string;
  model_id: string;
  runtime: RuntimeId;
  messages: Message[];
  created_at: number;
  updated_at: number;
}

export interface GenOpts {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  max_tokens?: number;
  seed?: number;
}

export interface TokenChunk {
  /** delta text */
  text: string;
  done: boolean;
  /** present on the final chunk */
  metrics?: RuntimeMetrics;
}

export interface RuntimeMetrics {
  tokens_per_sec_decode: number;
  tokens_per_sec_prefill: number;
  ttft_ms: number;
  total_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  hardware?: string;
}

export interface BenchCfg {
  prompt_chars?: number;
  max_decode_tokens?: number;
}

export interface BenchRun {
  id: string;
  model_id: string;
  runtime: RuntimeId;
  device: string;
  prompt_tokens: number;
  decode_tokens: number;
  ttft_ms: number;
  prefill_tok_per_s: number;
  decode_tok_per_s: number;
  total_ms: number;
  peak_ram_mb: number;
  peak_vram_mb: number;
  energy_j?: number;
  hardware?: string;
  started_at: number;
}

export interface DownloadProgress {
  model_id: string;
  runtime: RuntimeId;
  bytes_done: number;
  bytes_total: number;
  state:
    | "queued"
    | "downloading"
    | "paused"
    | "verifying"
    | "done"
    | "error";
  error?: string;
}
