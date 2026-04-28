export default function ComparePage() {
  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="text-lg font-semibold mb-1">Compare</h1>
      <p className="text-sm text-zinc-500 mb-6">
        Side-by-side: same prompt, two (model × runtime) configs, dual streams,
        live metrics. Stubbed — see{" "}
        <code className="text-zinc-400">PLAN.md §10</code>.
      </p>

      <div className="grid grid-cols-2 gap-3 h-[60vh]">
        {["A", "B"].map((slot) => (
          <div
            key={slot}
            className="border border-dashed border-zinc-800 rounded p-4 text-zinc-600 flex items-center justify-center text-sm"
          >
            slot {slot} — model + runtime picker goes here
          </div>
        ))}
      </div>
    </div>
  );
}
