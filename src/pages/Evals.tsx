export default function EvalsPage() {
  const evals = [
    {
      id: "mmlu",
      name: "MMLU",
      desc: "57-subject multiple-choice; classic knowledge benchmark.",
      planned: "v0.3",
    },
    {
      id: "bfcl",
      name: "BFCL v3",
      desc: "Berkeley Function-Calling Leaderboard. Tool-use accuracy.",
      planned: "v0.3",
    },
    {
      id: "taubench",
      name: "τ-Bench",
      desc: "Sierra's airline / retail tool-use benchmark.",
      planned: "v0.4",
    },
    {
      id: "swebench",
      name: "SWE-bench Lite",
      desc: "Resolves real GitHub issues in sandboxed Docker repos.",
      planned: "v0.5",
    },
  ];
  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="text-lg font-semibold mb-1">Evals</h1>
      <p className="text-sm text-zinc-400 mb-6">
        Run open-source academic benchmarks against any (model × runtime). Each
        eval below is wired but not yet executable — see{" "}
        <code className="text-zinc-400">PLAN.md §8</code>.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-4xl">
        {evals.map((e) => (
          <div
            key={e.id}
            className="border border-zinc-800 rounded p-4 bg-zinc-950"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-medium">{e.name}</h2>
              <span className="text-[10px] uppercase tracking-wider text-zinc-400">
                planned · {e.planned}
              </span>
            </div>
            <p className="text-sm text-zinc-400 mt-2">{e.desc}</p>
            <button
              disabled
              className="mt-3 text-xs px-2 py-1 rounded border border-zinc-800 text-zinc-500 cursor-not-allowed"
            >
              Run
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
