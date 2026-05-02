# llm-bench

A desktop app that runs open-weight LLMs **on your own machine**, across three different inference engines, so you can chat with them and compare them.

```
┌─────────────────────────────────────────────────────────────┐
│  Sidebar    │  Chat                                         │
│  ─────────  │  ──────────────────────────────────────────── │
│  • Chat     │  [model ▾]  [runtime ▾]  ⏱ ⚙ + New chat      │
│  • Models   │                                               │
│  • Evals    │           ┌─────────────────────┐ Hello       │
│  • Bench    │           └─────────────────────┘             │
│  • Compare  │   assistant gemma-4-e2b llama.cpp             │
│             │   ┌────────────────────────────────────────┐  │
│             │   │ Hi! How can I help you today?          │  │
│             │   └────────────────────────────────────────┘  │
│             │   hw llama.cpp · Metal  ttft 124ms            │
│             │   prefill 41 tok/s  decode 75 tok/s           │
└─────────────────────────────────────────────────────────────┘
```

**What you can do today:**
- Chat with Gemma 4 and Qwen models that fit on a laptop
- Switch between three runtimes: **llama.cpp**, **MLX**, and **LiteRT-LM** — same model, different engines
- See real performance numbers under each response (time-to-first-token, tokens-per-second, hardware used)
- Tune temperature, top-p, top-k, max-tokens via a side panel
- Save and load past conversations
- Pause/resume model downloads
- Bring your own model files (any `.gguf`, `.litertlm`, or MLX directory)

**Coming later:** automated evals (MMLU, BFCL, τ-Bench, SWE-bench), benchmark suite, side-by-side compare. See [PLAN.md](./PLAN.md).

---

## Get it running in 3 steps

> Designed for macOS first; Linux + Windows work via CI but haven't been hand-tested yet.

### Step 1 — install the things

You need:
- **Node 20+** and **npm**
- **Rust** (stable) — install from [rustup.rs](https://rustup.rs/) if you don't have it
- One or more **runtime binaries** (next section)

On macOS the easiest way:
```bash
# Node
brew install node

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Restart your shell or run:
source "$HOME/.cargo/env"
```

### Step 2 — install at least one runtime

You need **at least one** of these on your machine. Each runs models a bit differently and you can pick whichever you want at chat time. Install the ones you're curious about.

**llama.cpp** (best general-purpose, lots of model support):
```bash
git clone https://github.com/ggml-org/llama.cpp ~/code/llama.cpp
cd ~/code/llama.cpp
cmake -B build -DGGML_METAL=ON       # Apple Silicon
# OR: cmake -B build -DGGML_CUDA=ON  # NVIDIA Linux/Windows (NOT CUDA 13.2)
cmake --build build --config Release -j --target llama-server
mkdir -p ~/.llm-bench/runtimes/llama_cpp
cp build/bin/llama-server ~/.llm-bench/runtimes/llama_cpp/
```

**MLX** (fastest on Apple Silicon, Mac only):
```bash
# Install uv (a modern Python tool runner)
curl -LsSf https://astral.sh/uv/install.sh | sh
# Open a fresh terminal, then:
uv tool install mlx-lm
which mlx_lm.server          # should print a path
```

**LiteRT-LM** (Google's edge runtime):
```bash
uv tool install litert-lm
which litert-lm              # should print a path
```

The app finds these automatically — no PATH gymnastics needed. You can install one, two, or all three.

### Step 3 — clone, build, and run

```bash
git clone https://github.com/managers-can-code/llm-bench
cd llm-bench
npm install
npm run tauri:dev
```

The first build takes 2–3 minutes (Rust compiles a lot of dependencies). Subsequent runs are seconds. A window will open titled **llm-bench**.

---

## First chat

1. Click **Models** in the sidebar.
2. Find a row you can fit on your machine. **Gemma 4 E2B** is ~2.5 GB and works almost anywhere.
3. Click **download** under whichever runtime you have installed. Wait for the progress bar to hit 100%.
4. Click **Chat** in the sidebar.
5. Pick the model and runtime you just installed.
6. Type "hello" and press Enter.

You should see tokens stream in. Under the response you'll see a small footer with timing data — that's how the runtimes will be compared once the Benchmarks page lights up later.

---

## Bring your own model

Got a `.gguf` file or an MLX-quantized directory you want to test? Click **+ Import model** on the Models page. The dialog lets you pick:
- A `.gguf` file → registered for **llama.cpp**
- A `.litertlm` file → registered for **LiteRT-LM**
- A directory containing `config.json` + safetensors + tokenizer → registered for **MLX**

The file gets copied into `~/.llm-bench/models/<runtime>/imported/<your-name>/` and shows up as a row you can chat with.

---

## Where things live

```
~/.llm-bench/
├── store.sqlite          ← your conversations
├── imported.json         ← models you imported yourself
├── models/
│   ├── llama_cpp/        ← .gguf files
│   ├── mlx/              ← MLX directories
│   └── litert_lm/        ← .litertlm files
├── runtimes/             ← optional vendored binaries
│   ├── llama_cpp/llama-server
│   ├── mlx/mlx_lm.server
│   └── litert_lm/litert-lm
└── logs/
```

---

## Troubleshooting (the issues real users hit)

**"runtime not available: llama-server not installed at ..."**
→ Step 2 of "First time setup" hasn't finished. Make sure the binary actually exists at the path the error mentions.

**"No such option: --model"** (LiteRT-LM)
→ Your `litert-lm` is probably a different version with different flags. Run `litert-lm run -h` and tell us; we'll add support for your CLI.

**MLX chat says "Model type gemma4 not supported"**
→ Your `mlx-lm` is too old (< 0.30). It needs Python 3.10+. The simplest fix is `uv tool install --upgrade mlx-lm` — uv ships its own Python so this avoids macOS's `libexpat` issue.

**The 26B+ models OOM when I try to chat**
→ Big MoE models (Gemma 4 26B-A4B) need expert-tensor offload to fit on consumer GPUs. The app does this automatically for llama.cpp but it's still tight on M-series Macs with under 24 GB. Stick with E2B / E4B / 4B variants — they're the recommended starters anyway.

**Chat hangs forever on "..."**
→ Watch the dev terminal (where `npm run tauri:dev` is running). The runtime's stdout/stderr appears there. Most hangs are model loads taking longer than expected; give it 60 seconds. If still nothing, paste the terminal output as an issue.

**Downloads keep failing partway**
→ Click pause, then resume. Resume picks up from the last byte received via HTTP Range. If it keeps failing, the underlying network is the issue — `curl -L -C -` outside the app works as a fallback.

---

## Going further

- The full design and roadmap live in [PLAN.md](./PLAN.md). Phases 5+ cover MMLU/BFCL/τ-Bench evals, the benchmark suite, and the side-by-side compare view.
- All code is documented inline; the parts that surprised us (MoE-CPU offload, mmap-vs-override-tensor on Apple Silicon, the StrictMode listener race that doubled tokens, etc.) are called out in commit messages and module docstrings.
- File issues at https://github.com/managers-can-code/llm-bench/issues with the dev-terminal output and we'll dig in.

## Develop on the project itself

```bash
npm test                                # vitest unit tests
cd src-tauri && cargo test              # rust unit tests
cd src-tauri && cargo clippy --all-targets -- -D warnings
cd src-tauri && cargo fmt --all -- --check
```

The pre-commit hook at `.githooks/pre-commit` runs all of these before every commit. Activate it once with:
```bash
git config core.hooksPath .githooks
```

## License

Apache-2.0 — see [LICENSE](./LICENSE).
