# llm-bench

Desktop app for running open-weight LLMs on **llama.cpp** and **LiteRT-LM**, with chat, evals, benchmarks, and side-by-side comparison. Modeled on Ollama's spirit but scoped to these two runtimes.

> **Status:** v0.1 walking skeleton. The app launches, the frontend renders, the IPC layer is wired, and the llama.cpp adapter spawns `llama-server` and streams real tokens. Many features are stubbed — see [PLAN.md](./PLAN.md).

## What's in v0.1

- Tauri + Rust + React app shell with sidebar nav (Chat, Models, Evals, Benchmarks, Compare)
- `Runtime` trait with two adapters:
  - **llama.cpp** — spawns `llama-server`, talks OpenAI-compat HTTP, streams tokens via SSE
  - **LiteRT-LM** — stub; greyed out until `.litertlm` builds for our 26B+ models exist
- Model registry seeded with int4 builds of:
  - Gemma 4 26B-A4B (MoE)
  - Gemma 4 31B (dense)
  - Qwen 3.6 27B (dense)
  - Qwen 3.6 35B-A3B (MoE)
- HF Hub downloader (resumable, sha-verified, progress events)
- SQLite-backed conversation persistence
- Stub pages for Evals + Benchmarks + Compare with their full plans linked
- GitHub Actions CI for typecheck, `cargo check`, `clippy`, and per-OS builds

## What's *not* yet in v0.1

- Multimodal chat (vision/audio attach disabled in UI)
- Eval runs (MMLU / BFCL / τ-Bench / SWE-bench harnesses)
- Benchmark engine (TTFT, tok/s, peak memory, energy)
- Side-by-side compare
- Runtime auto-installer (you supply `llama-server` yourself for now)

The rest of the roadmap lives in [PLAN.md §13](./PLAN.md#13-roadmap-beyond-v01).

## Build & run

### Prerequisites

- **Node 20+** and **npm 10+**
- **Rust stable 1.77+** with `cargo`
- macOS / Linux / Windows
- Linux only: `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libsoup-3.0-dev`
- Tauri requires icon files; generate them once with:
  ```bash
  npm run tauri icon path/to/source.png
  ```

### Development

```bash
git clone git@github.com:managers-can-code/llm-bench.git
cd llm-bench
npm install
npm run tauri:dev
```

Or, frontend-only iteration without the Tauri shell:

```bash
npm run dev
```

### Production build

```bash
npm run tauri:build
```

Output: `src-tauri/target/release/bundle/{dmg,deb,appimage,msi}/`.

## Runtimes — bring your own (for now)

The app expects runtime binaries here:

```
~/.llm-bench/runtimes/llama_cpp/llama-server
~/.llm-bench/runtimes/litert_lm/litert-lm
```

Until v0.2 ships an auto-installer, build them yourself.

### llama.cpp

```bash
git clone https://github.com/ggml-org/llama.cpp
cd llama.cpp
# Pick the right backend for your machine. Examples:
cmake -B build -DGGML_METAL=ON         # Apple Silicon
cmake -B build -DGGML_CUDA=ON          # NVIDIA (avoid CUDA 13.2 — known gibberish bug)
cmake -B build -DGGML_VULKAN=ON        # Linux/Windows portable
cmake --build build --config Release -j --target llama-server
mkdir -p ~/.llm-bench/runtimes/llama_cpp
cp build/bin/llama-server ~/.llm-bench/runtimes/llama_cpp/
```

> **CUDA caveat:** llama.cpp + CUDA 13.2 produces gibberish output on Blackwell GPUs. Pin to ≤ 13.1 or ≥ 13.3 — see [llama.cpp#21371](https://github.com/ggml-org/llama.cpp/issues/21371).

### LiteRT-LM

Follow [Google AI Edge's LiteRT-LM CLI guide](https://ai.google.dev/edge/litert-lm/cli). The CLI binary should land at `~/.llm-bench/runtimes/litert_lm/litert-lm`.

## Models

Pull from the **Models** tab in the app. Files land at:

```
~/.llm-bench/models/<runtime>/<hf_repo>/<file>
```

Default int4 quants (UD-Q4_K_XL where Unsloth provides them):

| Model | HF repo (llama.cpp / GGUF) |
|---|---|
| Gemma 4 26B-A4B | `unsloth/gemma-4-26B-A4B-it-GGUF` |
| Gemma 4 31B | `unsloth/gemma-4-31B-it-GGUF` |
| Qwen 3.6 27B | `unsloth/Qwen3.6-27B-GGUF` |
| Qwen 3.6 35B-A3B | `unsloth/Qwen3.6-35B-A3B-GGUF` |

LiteRT-LM packages for these sizes aren't on Hugging Face yet — those rows are visibly greyed out as **build pending**.

## Project layout

```
llm-bench/
├── PLAN.md                 # full architecture + roadmap
├── README.md
├── package.json            # Vite + React frontend
├── src/
│   ├── lib/
│   │   ├── ipc.ts          # typed wrappers around invoke()
│   │   └── types.ts        # mirror of Rust core types
│   ├── pages/              # Chat, Models, Evals, Benchmarks, Compare
│   └── components/Sidebar.tsx
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json
    └── src/
        ├── lib.rs          # AppState + Tauri builder
        ├── commands.rs     # Tauri command handlers (IPC surface)
        ├── core/           # Model, Conversation, paths, types
        ├── runtimes/       # Runtime trait + llamacpp + litertlm
        ├── registry/       # seed.json + downloader
        ├── store/          # SQLite + schema.sql
        ├── evals/          # stub
        └── bench/          # stub
```

## Publishing this repo to GitHub

The remote isn't created yet. Either:

```bash
# option A — gh CLI
gh repo create managers-can-code/llm-bench --public --source=. \
  --remote=origin --push --description "Local LLM runner across llama.cpp and LiteRT-LM"

# option B — create empty repo on github.com first, then:
git init
git remote add origin git@github.com:managers-can-code/llm-bench.git
git add .
git commit -m "v0.1 walking skeleton"
git push -u origin main
```

## License

Apache-2.0 — see [LICENSE](./LICENSE).

## Contributing

Issues and PRs welcome once the repo is public. The single best contribution right now is helping the LiteRT-LM 26B+ packaging story land — see [PLAN.md §14](./PLAN.md#14-risks--open-questions).
