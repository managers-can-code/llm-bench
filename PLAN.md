# LLM Bench — Implementation Plan

A desktop app for running local LLMs across **llama.cpp** and **LiteRT-LM**, with chat, multimodality, evals, benchmarks, and side-by-side comparison. Modeled on Ollama's spirit but scoped to these two runtimes.

**Project facts (locked):**
- Local path: `~/Developer/llm-bench-app/`
- GitHub remote: `git@github.com:managers-can-code/llm-bench.git` (public)
- License: Apache-2.0
- Working name: `llm-bench`

---

## 1. Product summary

A single desktop binary that lets a user:

1. Pull and run open-weight LLMs from Hugging Face (int4 by default) on **llama.cpp** or **LiteRT-LM**.
2. Chat with the running model — text, and images/audio when the model supports it.
3. Switch model and runtime with one click; keep prior conversations.
4. Run academic evals (**MMLU**, **τ-Bench**, **BFCL**, **SWE-bench**) and publish results to a local leaderboard.
5. Benchmark each (model × runtime × device) tuple on CPU and GPU — tokens/sec, TTFT, peak RAM/VRAM, energy where available.
6. Put two configurations head-to-head: same prompt, two streams, side-by-side output, latency comparison.

**Non-goals (for now):** training or fine-tuning, cloud inference, model marketplace, multi-user/server mode, mobile.

---

## 2. Initial model lineup (int4)

| Model | Architecture | llama.cpp (GGUF) | LiteRT-LM (.litertlm) | Modalities |
|---|---|---|---|---|
| Gemma 4 26B-A4B | MoE (4B active) | `unsloth/gemma-4-26B-A4B-it-GGUF` (UD-Q4_K_XL) | **not yet packaged for desktop** — risk | text + vision |
| Gemma 4 31B | Dense | `unsloth/gemma-4-31B-it-GGUF` (UD-Q4_K_XL) | **not yet packaged for desktop** — risk | text + vision |
| Qwen 3.6 27B | Dense | `unsloth/Qwen3.6-27B-GGUF` (UD-Q4_K_XL or IQ4_XS) | unknown — need to verify | text |
| Qwen 3.6 35B-A3B | MoE (3B active) | `unsloth/Qwen3.6-35B-A3B-GGUF` (UD-Q4_K_XL) | unknown — need to verify | text |

**Open question:** Only the smaller Gemma 4 sizes (E2B, E4B) have official `.litertlm` builds on Hugging Face today. For the LiteRT-LM side of the runtime matrix on these 4 models we may need to:
(a) self-convert via the LiteRT-LM conversion pipeline,
(b) wait for `litert-community` to ship 26B/31B builds,
(c) ship llama.cpp-only support for those specific cells of the matrix at launch and grey out LiteRT-LM until builds appear.

I'll plan for (c) at v0.1 and revisit.

**Build caveat:** llama.cpp + CUDA 13.2 produces gibberish on Blackwell GPUs. Pin CUDA toolchain to ≤ 13.1 or ≥ 13.3 in build docs.

---

## 3. Architecture

```
┌────────────────────────────────────────────────────────────┐
│  Tauri shell (Rust) — single binary, single process tree   │
│                                                            │
│  ┌──────────────────────────┐   ┌────────────────────────┐ │
│  │  React + TS frontend     │◄─►│  Rust core (lib)       │ │
│  │  - Chat                  │   │  - Runtime trait       │ │
│  │  - Models                │IPC│  - Model registry      │ │
│  │  - Evals                 │◄─►│  - Eval engine         │ │
│  │  - Benchmarks            │   │  - Bench engine        │ │
│  │  - Compare (split view)  │   │  - HF downloader       │ │
│  └──────────────────────────┘   │  - SQLite store        │ │
│                                 └────────┬───────────────┘ │
│                                          │ spawn / ffi     │
│                              ┌───────────┴────────────┐    │
│                              ▼                        ▼    │
│                     ┌─────────────────┐   ┌─────────────────┐
│                     │ llama.cpp adptr │   │ LiteRT-LM adptr │
│                     │ (subprocess:    │   │ (subprocess:    │
│                     │  llama-server   │   │  litert-lm      │
│                     │  HTTP)          │   │  CLI / C++ API) │
│                     └─────────────────┘   └─────────────────┘
└────────────────────────────────────────────────────────────┘
```

Why subprocess (not in-process linking) for v0.1: faster to ship, easier crash isolation, lets us upgrade either runtime independently. A future v0.2 can replace the llama.cpp adapter with a `llama_cpp` crate FFI link for lower latency.

---

## 4. Module breakdown (Rust crates / TS packages)

**Rust workspace** (`src-tauri/`):
- `core/` — domain types (Model, Runtime, Conversation, EvalRun, BenchRun)
- `runtimes/` — `Runtime` trait + adapters
  - `runtimes/llamacpp/` — manages `llama-server` subprocess, OpenAI-compatible HTTP client
  - `runtimes/litertlm/` — manages `litert-lm` CLI subprocess; later switch to C++ API binding
- `registry/` — model catalog, HF Hub downloader (`hf-hub` crate), local cache
- `evals/` — eval harness; one module per dataset (`mmlu`, `taubench`, `bfcl`, `swebench`)
- `bench/` — perf harness (warmup, decode-rate sampler, RAM/VRAM probes via `nvml-wrapper` + `sysinfo`)
- `store/` — SQLite via `sqlx` for conversations, eval/bench results
- `app/` — Tauri commands; thin wrapper exposing core to frontend

**Frontend** (`src/`):
- `pages/Chat.tsx`, `pages/Models.tsx`, `pages/Evals.tsx`, `pages/Benchmarks.tsx`, `pages/Compare.tsx`
- `lib/ipc.ts` — typed wrapper around `invoke()` with codegen from Rust types (via `ts-rs`)
- `components/` — message list, model picker, runtime toggle, attachment dropzone, leaderboard tables, chart.js panels

---

## 5. Runtime abstraction

```rust
#[async_trait]
pub trait Runtime: Send + Sync {
    fn id(&self) -> RuntimeId; // LlamaCpp | LiteRtLm
    fn capabilities(&self, model: &Model) -> Capabilities;
    async fn load(&self, model: &Model, opts: LoadOpts) -> Result<SessionHandle>;
    async fn unload(&self, h: SessionHandle) -> Result<()>;
    async fn chat(
        &self, h: SessionHandle, msgs: &[Message], opts: GenOpts,
    ) -> impl Stream<Item = Result<TokenChunk>>;
    async fn embed(&self, h: SessionHandle, text: &str) -> Result<Vec<f32>>; // optional
    async fn metrics(&self, h: SessionHandle) -> Result<RuntimeMetrics>;
}
```

`LoadOpts` carries `device: Cpu | Gpu { idx } | Auto`, ctx length, batch size, kv-cache type. `GenOpts` carries sampling params + tools. `RuntimeMetrics` carries tok/s, prefill ms, peak VRAM. Same interface for both adapters.

---

## 6. Model registry & download

- Static seed catalog (`registry/seed.json`) with the 4 models above + their HF repo + filename + sha256 + min RAM/VRAM hint.
- Downloader uses `hf-hub` crate with resumable downloads, verifies sha, stores under `~/.llm-bench/models/<runtime>/<repo>/<file>`.
- Discovery: `unsloth` collections via HF API for "more models" UI later.
- A model record:
  ```rust
  struct Model {
      id: String,           // "unsloth/gemma-4-31B-it-GGUF#UD-Q4_K_XL"
      family: ModelFamily,  // Gemma4 | Qwen36 | ...
      arch: Arch,           // Dense | Moe { active_b: f32 }
      modalities: Modalities, // text, vision, audio
      runtimes: Vec<RuntimeBinding>, // GGUF path, .litertlm path, etc.
      quant: Quant,         // Q4_K_M, IQ4_XS, MXFP4, ...
      ctx_max: u32,
  }
  ```

---

## 7. Chat & multimodal data model

- Conversation = ordered list of `Message { role, parts: Vec<Part>, ts }`.
- `Part = Text(String) | Image(Asset) | Audio(Asset) | ToolCall(...) | ToolResult(...)`.
- Assets live on disk under `~/.llm-bench/assets/<sha256>` and are referenced by hash in SQLite.
- Frontend renders parts polymorphically. Drag-drop image/audio attaches a `Part::Image|Audio`. Chat is rejected with a friendly error if `Capabilities::modalities` doesn't include the part type for the selected model.
- Streaming: server-sent token chunks → Tauri event channel → React state.

---

## 8. Evals subsystem

Each eval is a Rust module implementing:

```rust
#[async_trait]
trait Eval {
    fn id(&self) -> &str; // "mmlu", "taubench", "bfcl", "swebench"
    fn dataset_size(&self) -> usize;
    async fn run(&self, model: &Model, runtime: &dyn Runtime,
                 cfg: EvalCfg, progress: ProgressTx) -> Result<EvalReport>;
}
```

Per-dataset notes:

- **MMLU** — pull `cais/mmlu` from HF Datasets; 5-shot multiple-choice; score = exact match on letter answer; Rust impl with HF datasets crate or shell out to a small Python helper bundled as a sidecar.
- **τ-Bench** — Sierra's tool-use benchmark (airline / retail). Requires the runtime to support tool calling. Use the upstream Python harness as a sidecar; we only orchestrate.
- **BFCL** — Berkeley Function-Calling Leaderboard v3. Sidecar to the official `gorilla` repo runner; we collect their JSON output.
- **SWE-bench** (lite & verified) — heaviest by far. Needs Docker for sandboxed patch validation. v0.1: detect Docker, support SWE-bench Lite only, defer Verified.

**Publish results:** local `EvalRun` table in SQLite + optional "export to JSON" for sharing. A future "publish" feature could push to an Anthropic-hosted board, but only with explicit consent.

**Performance reality check:** running MMLU (~14k questions) on a 31B int4 model on a single consumer GPU takes hours. The UI will show ETA up front and let the user pick a stratified subsample.

---

## 9. Benchmark subsystem

For each (model, runtime, device, prompt-length, decode-length) tuple, measure:

- **TTFT** (time to first token)
- **Prefill speed** (tokens / sec)
- **Decode speed** (tokens / sec, sustained)
- **Peak resident memory** (RAM via `sysinfo`, VRAM via NVML on NVIDIA, IOReg on Apple Silicon)
- **Energy** (macOS: `powermetrics` sidecar with `sudo`; NVIDIA: NVML; otherwise unavailable and we say so)

Standard prompt sets: short (128 tok), long (4k), needle-in-a-haystack (32k+).

Bench runs are queued, run sequentially, write to `BenchRun` table. Results page = sortable table + bar/line charts (recharts).

GPU backend toggle exposes whatever each runtime offers:
- llama.cpp: CUDA, Metal, Vulkan, ROCm
- LiteRT-LM: GPU delegate (which uses MLDrift internally for desktop GPU paths), CPU XNNPACK

---

## 10. Side-by-side compare

A split chat view: top bar lets the user pick `(modelA, runtimeA)` and `(modelB, runtimeB)`. One prompt input, dual streams. Below each stream: live metrics (tok/s, TTFT). After both finish: small diff/stats panel. Conversations on each side are independent and savable.

---

## 11. Packaging & distribution

- Tauri produces signed `.dmg` (macOS, universal), `.msi` (Windows), `.AppImage`/`.deb` (Linux).
- Runtime binaries (`llama-server`, `litert-lm`) are **not bundled** in v0.1. App's first-run wizard downloads matching prebuilts to `~/.llm-bench/runtimes/` (mirrors how Ollama ships). This keeps the app bundle small and lets us update runtimes independently.
- CI (GitHub Actions) per-OS build matrix.

---

## 12. Walking skeleton — what v0.1 actually contains

Ordered checklist for the first concrete code drop, exactly what "walking skeleton" means here:

1. ✅ Tauri + React + TS scaffold; passes `cargo check` and `pnpm build`.
2. ✅ `Runtime` trait + `LlamaCppRuntime` adapter that spawns `llama-server`, talks OpenAI-compat HTTP, streams.
3. ✅ `LiteRtLmRuntime` adapter — stub that spawns `litert-lm` CLI but only implements `chat` for text. Greyed out in UI for unsupported models.
4. ✅ Model registry seeded with the 4 models; HF downloader works for GGUF; LiteRT-LM column shows "build pending".
5. ✅ Chat page: pick model + runtime, send text, stream tokens, save to SQLite. Image attach button present but disabled with a tooltip ("coming in v0.2").
6. ✅ Models page: list, download, delete, show disk usage.
7. ✅ Evals + Benchmarks + Compare pages exist with empty states and TODO banners — wired into nav so the shape of the app is visible.
8. ✅ README with build instructions including the CUDA 13.2 caveat.

That's it for v0.1. Anything below this line is v0.2+.

---

## 13. Roadmap beyond v0.1

- **v0.2** — multimodal chat (vision for Gemma 4); benchmark engine fully working with charts; CPU vs GPU comparison.
- **v0.3** — MMLU + BFCL evals end-to-end; eval result tables; export JSON.
- **v0.4** — τ-Bench tool-use eval; Compare view live.
- **v0.5** — SWE-bench Lite (Docker-gated); MLDrift backend toggle if LiteRT-LM exposes one publicly.
- **v0.6** — LiteRT-LM 26B/31B once `.litertlm` builds exist, or self-conversion pipeline.

---

## 14. Risks & open questions

| Risk | Mitigation |
|---|---|
| LiteRT-LM has no public `.litertlm` builds for 26B/31B/Qwen3.6 | Ship with llama.cpp coverage; add LiteRT-LM cells as builds appear; document conversion path |
| τ-Bench / BFCL / SWE-bench harnesses are Python-first | Treat as sidecar processes; bundle a Python venv in `~/.llm-bench/python/` on first eval run |
| SWE-bench requires Docker | Detect, prompt user, gate the feature |
| Apple Silicon vs NVIDIA energy probes use very different APIs | Abstract behind `EnergyProbe` trait; degrade gracefully |
| 31B + 35B models exceed VRAM on common consumer cards | Surface "won't fit" warning before load using model size hints + GPU mem query |
| llama.cpp + CUDA 13.2 gibberish bug | Build matrix pins toolchain |

---

## 15. Decisions locked

- **Location:** `~/Developer/llm-bench-app/` ✓
- **Repo:** `github.com/managers-can-code/llm-bench` (public) ✓
- **License:** Apache-2.0 ✓
- **App name:** `llm-bench` ✓

## 16. Still open (deferrable)

- **Telemetry** — opt-in anonymous benchmark sharing? Not needed for v0.1; revisit before v0.3 evals ship.
- **Anything in §12 you want pulled out, or pulled in earlier?**

---

*This plan is intentionally biased toward shipping v0.1 quickly and discovering the hard parts (LiteRT-LM model availability, eval sidecar packaging, energy probes) early rather than designing them in the abstract.*
