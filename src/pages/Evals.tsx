import { Link } from "react-router-dom";
import { ScanSearch } from "lucide-react";

interface EvalDef {
  id: string;
  name: string;
  desc: string;
  planned: string;
  exampleScore?: string;
}

const EVALS: EvalDef[] = [
  {
    id: "mmlu",
    name: "MMLU",
    desc: "57-subject multiple-choice; classic knowledge benchmark.",
    planned: "v0.3",
    exampleScore: "0.62",
  },
  {
    id: "bfcl",
    name: "BFCL v3",
    desc: "Berkeley Function-Calling Leaderboard. Tool-use accuracy.",
    planned: "v0.3",
    exampleScore: "0.71",
  },
  {
    id: "taubench",
    name: "τ-Bench",
    desc: "Sierra's airline / retail tool-use benchmark.",
    planned: "v0.4",
    exampleScore: "0.48",
  },
  {
    id: "swebench",
    name: "SWE-bench Lite",
    desc: "Resolves real GitHub issues in sandboxed Docker repos.",
    planned: "v0.5",
    exampleScore: "0.18",
  },
];

export default function EvalsPage() {
  return (
    <div className="h-full overflow-y-auto p-6">
      <header className="mb-6 max-w-3xl">
        <div className="flex items-center gap-2 text-zinc-100">
          <ScanSearch size={18} />
          <h1 className="text-lg font-semibold">Evals</h1>
          <PreviewBadge />
        </div>
        <p className="text-sm text-zinc-400 mt-2">
          Run open-source academic benchmarks against any (model × runtime).
          The eval definitions are wired in the registry but the harnesses
          aren't shipping yet — see the per-card schedule below. Eval runs
          require a downloaded model from{" "}
          <Link to="/models" className="text-zinc-300 underline underline-offset-2 hover:text-zinc-100">
            Models
          </Link>
          .
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-4xl">
        {EVALS.map((e) => (
          <EvalCardPreview key={e.id} ev={e} />
        ))}
      </div>
    </div>
  );
}

function EvalCardPreview({ ev }: { ev: EvalDef }) {
  return (
    <div className="border border-dashed border-zinc-800 rounded-lg p-4 bg-zinc-950/40 relative overflow-hidden">
      <div className="absolute top-2 right-2 text-[9px] uppercase tracking-wider text-zinc-500 font-medium">
        preview
      </div>
      <div className="flex items-center justify-between">
        <h2 className="font-medium text-zinc-100">{ev.name}</h2>
        <span className="text-[10px] uppercase tracking-wider text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-800">
          {ev.planned}
        </span>
      </div>
      <p className="text-sm text-zinc-400 mt-2">{ev.desc}</p>

      {/* Mock result row showing what the future card will look like */}
      <div className="mt-4 pt-3 border-t border-zinc-800/60 opacity-60">
        <div className="flex items-baseline justify-between text-xs text-zinc-500">
          <span>example result</span>
          <span className="font-mono tabular-nums text-zinc-300 text-base">
            {ev.exampleScore}
          </span>
        </div>
        <div className="mt-1 h-1 bg-zinc-800 rounded overflow-hidden">
          <div
            className="h-full bg-zinc-600"
            style={{ width: `${parseFloat(ev.exampleScore ?? "0") * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function PreviewBadge() {
  return (
    <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-zinc-700 text-zinc-300 bg-zinc-900">
      preview
    </span>
  );
}
