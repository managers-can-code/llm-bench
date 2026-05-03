import { useEffect, useMemo, useState } from "react";
import { Activity, Play, Trash2 } from "lucide-react";
import {
  deleteBenchRun,
  listBenchRuns,
  listModels,
  runBenchmark,
} from "../lib/ipc";
import {
  ALL_RUNTIMES,
  RUNTIME_LABELS,
  type BenchRun,
  type Model,
  type RuntimeId,
} from "../lib/types";
import { useToast } from "../lib/toast";
import { useConfirm } from "../lib/confirm";

interface RunningKey {
  modelId: string;
  runtime: RuntimeId;
}

export default function BenchmarksPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [runs, setRuns] = useState<BenchRun[]>([]);
  const [running, setRunning] = useState<RunningKey | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  const refresh = () => {
    listBenchRuns()
      .then(setRuns)
      .catch(() => setRuns([]));
  };

  useEffect(() => {
    listModels()
      .then(setModels)
      .catch(() => setModels([]));
    refresh();
  }, []);

  const startRun = async (modelId: string, runtime: RuntimeId) => {
    setRunning({ modelId, runtime });
    try {
      await runBenchmark(modelId, runtime);
      toast.push("Benchmark complete", "success");
      refresh();
    } catch (e) {
      toast.push(`Benchmark failed: ${e}`, "error");
    } finally {
      setRunning(null);
    }
  };

  const removeRun = async (run: BenchRun) => {
    const ok = await confirm.confirm({
      title: "Delete benchmark result?",
      message: `Delete the run for ${run.model_id} (${RUNTIME_LABELS[run.runtime]})?`,
      destructive: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await deleteBenchRun(run.id);
      refresh();
    } catch (e) {
      toast.push(`Delete failed: ${e}`, "error");
    }
  };

  // Latest run per (model, runtime) for the comparison chart.
  const latestByPair = useMemo(() => {
    const m = new Map<string, BenchRun>();
    for (const r of runs) {
      const key = `${r.model_id}::${r.runtime}`;
      if (!m.has(key)) m.set(key, r);
    }
    return Array.from(m.values());
  }, [runs]);

  return (
    <div className="h-full overflow-y-auto p-6">
      <header className="mb-6 max-w-4xl flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-zinc-100">
            <Activity size={18} />
            <h1 className="text-lg font-semibold">Benchmarks</h1>
          </div>
          <p className="text-sm text-zinc-400 mt-2">
            Run a fixed prompt through any (model × runtime) and capture
            TTFT, prefill / decode tok/s, peak RAM, and total time. Results
            persist to{" "}
            <code className="text-zinc-300">~/.llm-bench/store.sqlite</code>.
          </p>
        </div>
        <button
          onClick={() => setPickerOpen(true)}
          className="text-sm px-3 py-1.5 rounded bg-zinc-100 text-zinc-900 font-medium hover:bg-white inline-flex items-center gap-2"
        >
          <Play size={13} fill="currentColor" />
          New run
        </button>
      </header>

      {latestByPair.length > 0 && (
        <ComparisonChart runs={latestByPair} />
      )}

      <ResultsTable
        runs={runs}
        runningKey={running}
        onDelete={removeRun}
      />

      {pickerOpen && (
        <RunPickerDialog
          models={models}
          onClose={() => setPickerOpen(false)}
          onRun={(modelId, runtime) => {
            setPickerOpen(false);
            startRun(modelId, runtime);
          }}
        />
      )}
    </div>
  );
}

function ComparisonChart({ runs }: { runs: BenchRun[] }) {
  const max = Math.max(1, ...runs.map((r) => r.decode_tok_per_s));
  return (
    <div className="max-w-4xl mb-6 rounded-lg border border-zinc-800 p-4 bg-zinc-950">
      <div className="text-xs uppercase tracking-wider text-zinc-500 mb-3">
        Latest run per (model × runtime) — decode tok/s
      </div>
      <div className="space-y-1.5">
        {runs.map((r) => (
          <div key={r.id} className="flex items-center gap-3 text-xs">
            <span className="w-44 truncate text-zinc-300">{r.model_id}</span>
            <span className="w-20 text-zinc-500 font-mono">
              {RUNTIME_LABELS[r.runtime]}
            </span>
            <div className="flex-1 h-2 bg-zinc-900 rounded">
              <div
                className="h-full bg-emerald-600 rounded"
                style={{ width: `${(r.decode_tok_per_s / max) * 100}%` }}
              />
            </div>
            <span className="w-24 text-right text-zinc-200 font-mono tabular-nums">
              {r.decode_tok_per_s.toFixed(1)} tok/s
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ResultsTableProps {
  runs: BenchRun[];
  runningKey: RunningKey | null;
  onDelete: (run: BenchRun) => void;
}

function ResultsTable({ runs, runningKey, onDelete }: ResultsTableProps) {
  return (
    <div className="max-w-5xl border border-zinc-800 rounded overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-zinc-900 text-zinc-400 text-xs uppercase tracking-wider">
          <tr>
            <th className="text-left px-3 py-2">Model</th>
            <th className="text-left px-3 py-2">Runtime</th>
            <th className="text-left px-3 py-2">Hardware</th>
            <th className="text-right px-3 py-2">TTFT</th>
            <th className="text-right px-3 py-2">Prefill</th>
            <th className="text-right px-3 py-2">Decode</th>
            <th className="text-right px-3 py-2">Total</th>
            <th className="text-right px-3 py-2">RAM Δ</th>
            <th className="text-right px-3 py-2">When</th>
            <th className="px-2 py-2 w-8"></th>
          </tr>
        </thead>
        <tbody>
          {runningKey && (
            <tr className="border-t border-zinc-800 bg-amber-950/20">
              <td className="px-3 py-3 text-zinc-200">{runningKey.modelId}</td>
              <td className="px-3 py-3 text-zinc-300">
                {RUNTIME_LABELS[runningKey.runtime]}
              </td>
              <td colSpan={7} className="px-3 py-3 text-amber-300 text-xs">
                running benchmark…
              </td>
              <td />
            </tr>
          )}
          {runs.length === 0 && !runningKey && (
            <tr>
              <td colSpan={10} className="px-6 py-10 text-center">
                <BenchEmptyState />
              </td>
            </tr>
          )}
          {runs.map((r) => (
            <tr
              key={r.id}
              className="border-t border-zinc-800 group hover:bg-zinc-900/40"
            >
              <td className="px-3 py-2.5 text-zinc-200">{r.model_id}</td>
              <td className="px-3 py-2.5 text-zinc-300">
                {RUNTIME_LABELS[r.runtime]}
              </td>
              <td className="px-3 py-2.5 text-zinc-400 text-xs font-mono">
                {r.device || "—"}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-zinc-200">
                {r.ttft_ms.toFixed(0)}ms
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-zinc-200">
                {r.prefill_tok_per_s > 0
                  ? `${r.prefill_tok_per_s.toFixed(1)} tok/s`
                  : "—"}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-emerald-300 font-medium">
                {r.decode_tok_per_s.toFixed(1)} tok/s
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-zinc-300">
                {r.total_ms < 1000
                  ? `${r.total_ms}ms`
                  : `${(r.total_ms / 1000).toFixed(1)}s`}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-zinc-400">
                {r.peak_ram_mb > 0 ? `${r.peak_ram_mb} MB` : "—"}
              </td>
              <td className="px-3 py-2.5 text-right text-xs text-zinc-500">
                {new Date(r.started_at).toLocaleString()}
              </td>
              <td className="px-2 py-2.5">
                <button
                  onClick={() => onDelete(r)}
                  aria-label="Delete run"
                  className="opacity-30 group-hover:opacity-100 text-zinc-400 hover:text-red-400 p-1 rounded"
                >
                  <Trash2 size={12} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BenchEmptyState() {
  return (
    <div className="text-sm text-zinc-400">
      <p className="text-base text-zinc-200 mb-1">No benchmark runs yet</p>
      <p>
        Click <span className="text-zinc-300 font-medium">New run</span> above
        to benchmark a (model × runtime). One run takes 5–30 seconds.
      </p>
    </div>
  );
}

interface RunPickerDialogProps {
  models: Model[];
  onClose: () => void;
  onRun: (modelId: string, runtime: RuntimeId) => void;
}

function RunPickerDialog({ models, onClose, onRun }: RunPickerDialogProps) {
  const [modelId, setModelId] = useState(models[0]?.id ?? "");
  const [runtime, setRuntime] = useState<RuntimeId>("llama_cpp");

  const selectedModel = models.find((m) => m.id === modelId);
  const supported: RuntimeId[] =
    selectedModel?.bindings
      .filter((b) => b.available && selectedModel.local[b.runtime])
      .map((b) => b.runtime) ?? [];

  // If the picked runtime isn't supported (e.g. not downloaded), fall back
  // to the first one that is.
  useEffect(() => {
    if (selectedModel && supported.length > 0 && !supported.includes(runtime)) {
      setRuntime(supported[0]);
    }
  }, [modelId, supported.join(","), runtime, selectedModel]);

  const canRun = selectedModel && supported.includes(runtime);

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="bg-zinc-950 border border-zinc-800 rounded-lg w-[480px] p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-semibold text-zinc-100">New benchmark run</h2>
        <div>
          <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-1">
            Model (downloaded only)
          </label>
          <select
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
          >
            {models
              .filter((m) => Object.values(m.local).some(Boolean))
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name}
                </option>
              ))}
          </select>
          {models.filter((m) => Object.values(m.local).some(Boolean))
            .length === 0 && (
            <p className="text-xs text-amber-400 mt-2">
              Download a model from the Models page first.
            </p>
          )}
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-1">
            Runtime
          </label>
          <div className="inline-flex items-center rounded-md border border-zinc-800 bg-zinc-900 p-0.5">
            {ALL_RUNTIMES.map((rt) => {
              const ok = supported.includes(rt);
              const active = runtime === rt;
              return (
                <button
                  key={rt}
                  type="button"
                  onClick={() => ok && setRuntime(rt)}
                  disabled={!ok}
                  className={[
                    "text-xs px-3 py-1 rounded",
                    active && ok
                      ? "bg-zinc-700 text-zinc-100"
                      : ok
                        ? "text-zinc-300 hover:text-zinc-100"
                        : "text-zinc-600 cursor-not-allowed",
                  ].join(" ")}
                >
                  {RUNTIME_LABELS[rt]}
                </button>
              );
            })}
          </div>
        </div>
        <p className="text-xs text-zinc-500">
          Default config: ~512-char prompt, max 256 decode tokens, fixed seed.
          Single iteration — for averaged runs, use multiple clicks.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="text-sm px-3 py-1.5 rounded text-zinc-300 hover:bg-zinc-900"
          >
            Cancel
          </button>
          <button
            onClick={() => canRun && onRun(modelId, runtime)}
            disabled={!canRun}
            className="text-sm px-3 py-1.5 rounded bg-zinc-100 text-zinc-900 font-medium disabled:opacity-40"
          >
            Run benchmark
          </button>
        </div>
      </div>
    </div>
  );
}
