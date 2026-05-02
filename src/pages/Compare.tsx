import { Columns2 } from "lucide-react";

export default function ComparePage() {
  return (
    <div className="h-full overflow-y-auto p-6">
      <header className="mb-6 max-w-3xl">
        <div className="flex items-center gap-2 text-zinc-100">
          <Columns2 size={18} />
          <h1 className="text-lg font-semibold">Compare</h1>
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-zinc-700 text-zinc-300 bg-zinc-900">
            preview
          </span>
        </div>
        <p className="text-sm text-zinc-400 mt-2">
          Send the same prompt to two (model × runtime) configurations side
          by side. Each side streams independently, with live metrics. Use it
          to feel the difference between, say, a 4B Qwen on llama.cpp vs the
          same on MLX. Real implementation lands in v0.4.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4 max-w-5xl">
        <ComparePreviewSlot
          slot="A"
          model="Gemma 4 E2B"
          runtime="llama.cpp"
          hardware="Metal"
          tps="75.3"
        />
        <ComparePreviewSlot
          slot="B"
          model="Gemma 4 E2B"
          runtime="MLX"
          hardware="Metal"
          tps="92.1"
        />
      </div>
    </div>
  );
}

interface ComparePreviewSlotProps {
  slot: string;
  model: string;
  runtime: string;
  hardware: string;
  tps: string;
}

function ComparePreviewSlot({
  slot,
  model,
  runtime,
  hardware,
  tps,
}: ComparePreviewSlotProps) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 p-4 relative overflow-hidden min-h-[320px]">
      <div className="absolute top-2 right-2 text-[9px] uppercase tracking-wider text-zinc-500 font-medium">
        slot {slot} · preview
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="rounded bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 text-zinc-300">
          {model}
        </span>
        <span className="rounded bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 text-zinc-300">
          {runtime}
        </span>
      </div>
      <div className="mt-4 space-y-2 opacity-60 text-sm text-zinc-400 leading-relaxed">
        <div className="rounded-lg rounded-tl-sm border border-zinc-800 bg-zinc-900 px-3 py-2">
          The model would respond here, streaming token by token, with the
          status pill flipping from <em>thinking</em> to <em>streaming</em>{" "}
          to <em>done</em>.
        </div>
      </div>
      <div className="absolute bottom-3 left-4 right-4 flex justify-between text-[10px] font-mono text-zinc-500">
        <span>hw {hardware}</span>
        <span>decode {tps} tok/s</span>
      </div>
    </div>
  );
}
