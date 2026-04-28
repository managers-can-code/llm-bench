export default function BenchmarksPage() {
  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="text-lg font-semibold mb-1">Benchmarks</h1>
      <p className="text-sm text-zinc-500 mb-6">
        Token-throughput, time-to-first-token, peak memory across (model ×
        runtime × device). Stubbed — see{" "}
        <code className="text-zinc-400">PLAN.md §9</code>.
      </p>

      <div className="border border-zinc-800 rounded p-6 max-w-3xl text-sm text-zinc-400 leading-relaxed">
        <p className="mb-2">When implemented, each run will measure:</p>
        <ul className="list-disc pl-5 space-y-1 text-zinc-500">
          <li>TTFT (time to first token)</li>
          <li>Prefill speed (tok/s)</li>
          <li>Decode speed (tok/s)</li>
          <li>Peak resident RAM / VRAM</li>
          <li>Energy where the platform exposes it</li>
        </ul>
        <p className="mt-4 text-zinc-600 text-xs">
          GPU backends to expose: llama.cpp (CUDA / Metal / Vulkan / ROCm),
          LiteRT-LM (GPU delegate via MLDrift, CPU XNNPACK).
        </p>
      </div>
    </div>
  );
}
