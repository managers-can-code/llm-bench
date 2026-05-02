import { Activity } from "lucide-react";

interface BenchmarkRow {
  model: string;
  runtime: string;
  hardware: string;
  ttft: number;
  prefill: number;
  decode: number;
}

const MOCK_RESULTS: BenchmarkRow[] = [
  {
    model: "Gemma 4 E2B",
    runtime: "llama.cpp",
    hardware: "Metal",
    ttft: 124,
    prefill: 41.6,
    decode: 75.3,
  },
  {
    model: "Gemma 4 E2B",
    runtime: "MLX",
    hardware: "Metal",
    ttft: 86,
    prefill: 58.2,
    decode: 92.1,
  },
  {
    model: "Gemma 4 E2B",
    runtime: "LiteRT-LM",
    hardware: "GPU",
    ttft: 142,
    prefill: 38.0,
    decode: 70.4,
  },
];

export default function BenchmarksPage() {
  const maxDecode = Math.max(...MOCK_RESULTS.map((r) => r.decode));

  return (
    <div className="h-full overflow-y-auto p-6">
      <header className="mb-6 max-w-3xl">
        <div className="flex items-center gap-2 text-zinc-100">
          <Activity size={18} />
          <h1 className="text-lg font-semibold">Benchmarks</h1>
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-zinc-700 text-zinc-300 bg-zinc-900">
            preview
          </span>
        </div>
        <p className="text-sm text-zinc-400 mt-2">
          Compare token throughput, time-to-first-token, and peak memory
          across (model × runtime × hardware). The card below is a mock to
          show what the result table will look like — real benchmark runs
          land in v0.3.
        </p>
      </header>

      <div className="max-w-3xl rounded-lg border border-dashed border-zinc-800 p-5 bg-zinc-950/40 relative">
        <div className="absolute top-2 right-2 text-[9px] uppercase tracking-wider text-zinc-500 font-medium">
          example data
        </div>
        <h2 className="text-sm font-medium text-zinc-200 mb-3">
          Gemma 4 E2B — sample run
        </h2>
        <div className="space-y-2">
          {MOCK_RESULTS.map((r) => {
            const pct = (r.decode / maxDecode) * 100;
            return (
              <div
                key={`${r.runtime}-${r.hardware}`}
                className="flex items-center gap-3 text-xs"
              >
                <span className="w-24 text-zinc-300">{r.runtime}</span>
                <span className="w-14 text-zinc-500 font-mono">
                  {r.hardware}
                </span>
                <div className="flex-1 h-2 bg-zinc-900 rounded">
                  <div
                    className="h-full bg-zinc-500 rounded"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-20 text-right text-zinc-200 font-mono tabular-nums">
                  {r.decode.toFixed(1)} tok/s
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-4 pt-3 border-t border-zinc-800/60 grid grid-cols-3 gap-3 text-[11px]">
          <Stat label="ttft" value={`${MOCK_RESULTS[0].ttft}ms`} />
          <Stat
            label="prefill"
            value={`${MOCK_RESULTS[0].prefill.toFixed(1)} tok/s`}
          />
          <Stat
            label="decode"
            value={`${MOCK_RESULTS[0].decode.toFixed(1)} tok/s`}
          />
        </div>
      </div>

      <div className="mt-6 max-w-3xl text-xs text-zinc-500 leading-relaxed">
        <p>
          Each benchmark run captures: TTFT, prefill tok/s, decode tok/s,
          peak resident RAM/VRAM, and energy where the platform exposes it.
          GPU backends supported: llama.cpp (CUDA / Metal / Vulkan / ROCm),
          MLX (Metal), LiteRT-LM (Metal/CPU XNNPACK).
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-zinc-500 uppercase tracking-wider text-[9px]">
        {label}
      </div>
      <div className="text-zinc-200 font-mono tabular-nums">{value}</div>
    </div>
  );
}
