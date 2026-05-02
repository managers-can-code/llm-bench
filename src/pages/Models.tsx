import { useEffect, useRef, useState } from "react";
import { Pause, Play, X as XIcon } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useShortcut } from "../lib/useShortcut";
import {
  listModels,
  downloadModel,
  pauseDownload,
  deleteLocalModel,
  importModel,
  onDownloadProgress,
} from "../lib/ipc";
import {
  ALL_RUNTIMES,
  RUNTIME_LABELS,
  type Model,
  type RuntimeId,
  type DownloadProgress,
} from "../lib/types";

interface ProgressSample {
  ts: number;
  bytes: number;
}

export default function ModelsPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({});
  const [importOpen, setImportOpen] = useState(false);
  // History of (timestamp, bytes_done) per download key, used for speed/ETA.
  const samplesRef = useRef<Record<string, ProgressSample[]>>({});

  const refresh = () => {
    listModels()
      .then(setModels)
      .catch(() => setModels([]));
  };

  useEffect(() => {
    refresh();
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    onDownloadProgress((p) => {
      if (cancelled) return;
      const key = `${p.model_id}::${p.runtime}`;
      // Roll a small ring buffer of samples to compute instantaneous speed.
      const arr = samplesRef.current[key] ?? [];
      arr.push({ ts: Date.now(), bytes: p.bytes_done });
      while (arr.length > 8) arr.shift();
      samplesRef.current[key] = arr;
      setProgress((prev) => ({ ...prev, [key]: p }));
      if (p.state === "done") {
        delete samplesRef.current[key];
        refresh();
      }
    }).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const handleDownload = async (m: Model, rt: RuntimeId) => {
    try {
      await downloadModel(m.id, rt);
    } catch (e) {
      alert(`download failed: ${e}`);
    }
  };

  const handlePause = async (m: Model, rt: RuntimeId) => {
    try {
      await pauseDownload(m.id, rt);
    } catch (e) {
      alert(`pause failed: ${e}`);
    }
  };

  const handleDelete = async (m: Model, rt: RuntimeId) => {
    if (!confirm(`Delete local copy of ${m.display_name} (${RUNTIME_LABELS[rt]})?`))
      return;
    try {
      await deleteLocalModel(m.id, rt);
      refresh();
    } catch (e) {
      alert(`delete failed: ${e}`);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold mb-1">Models</h1>
          <p className="text-sm text-zinc-400">
            int4-quantized models from Unsloth. Pulled into{" "}
            <code className="text-zinc-400">~/.llm-bench/models/</code>.
          </p>
        </div>
        <button
          onClick={() => setImportOpen(true)}
          className="text-sm px-3 py-1.5 rounded bg-zinc-100 text-zinc-900 font-medium hover:bg-white"
        >
          + Import model
        </button>
      </div>

      <div className="border border-zinc-800 rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-zinc-400 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-3 py-2">Model</th>
              <th className="text-left px-3 py-2">Arch</th>
              <th className="text-left px-3 py-2">Quant</th>
              {ALL_RUNTIMES.map((rt) => (
                <th key={rt} className="text-left px-3 py-2">
                  {RUNTIME_LABELS[rt]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {models.length === 0 && (
              <tr>
                <td
                  colSpan={3 + ALL_RUNTIMES.length}
                  className="text-center text-zinc-500 py-8 text-sm"
                >
                  No models loaded.
                </td>
              </tr>
            )}
            {models.map((m) => (
              <tr key={m.id} className="border-t border-zinc-800 align-top">
                <td className="px-3 py-3">
                  <div className="font-medium">{m.display_name}</div>
                  <div className="text-xs text-zinc-400">{m.id}</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5 uppercase tracking-wider">
                    {m.modalities.join(" · ")}
                  </div>
                </td>
                <td className="px-3 py-3 text-zinc-300">
                  {m.arch.kind === "moe"
                    ? `MoE (${m.arch.active_b}B/${m.arch.total_b}B)`
                    : "dense"}
                </td>
                <td className="px-3 py-3 text-zinc-300 font-mono text-xs">
                  {m.quant}
                </td>
                {ALL_RUNTIMES.map((rt) => {
                  const binding = m.bindings.find((b) => b.runtime === rt);
                  const local = m.local[rt];
                  const key = `${m.id}::${rt}`;
                  const prog = progress[key];
                  const samples = samplesRef.current[key] ?? [];
                  return (
                    <td key={rt} className="px-3 py-3">
                      {!binding ? (
                        <span className="text-xs text-zinc-700">—</span>
                      ) : !binding.available ? (
                        <span className="text-xs text-zinc-500">build pending</span>
                      ) : prog && prog.state === "downloading" ? (
                        <DownloadingCell
                          p={prog}
                          samples={samples}
                          onPause={() => handlePause(m, rt)}
                        />
                      ) : prog && prog.state === "paused" ? (
                        <button
                          onClick={() => handleDownload(m, rt)}
                          aria-label="Resume download"
                          className="text-xs px-2 py-1 rounded border border-amber-700 text-amber-400 hover:border-amber-500 inline-flex items-center gap-1.5"
                        >
                          <Play size={12} fill="currentColor" />
                          resume · {(prog.bytes_done / 1_073_741_824).toFixed(1)} GB
                        </button>
                      ) : local ? (
                        <button
                          onClick={() => handleDelete(m, rt)}
                          className="text-xs px-2 py-1 rounded border border-zinc-700 hover:border-red-700 hover:text-red-400"
                        >
                          delete · {binding.size_gb.toFixed(1)} GB
                        </button>
                      ) : (
                        <button
                          onClick={() => handleDownload(m, rt)}
                          className="text-xs px-2 py-1 rounded border border-zinc-700 hover:border-zinc-500"
                        >
                          download · {binding.size_gb.toFixed(1)} GB
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {importOpen && (
        <ImportDialog
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setImportOpen(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

interface DownloadingCellProps {
  p: DownloadProgress;
  samples: ProgressSample[];
  onPause: () => void;
}

function DownloadingCell({ p, samples, onPause }: DownloadingCellProps) {
  const pct = p.bytes_total
    ? Math.round((p.bytes_done / Math.max(1, p.bytes_total)) * 100)
    : 0;

  // Speed = (latest_bytes - oldest_bytes) / (latest_ts - oldest_ts), in B/s.
  let speedLabel = "…";
  let etaLabel = "";
  if (samples.length >= 2) {
    const first = samples[0];
    const last = samples[samples.length - 1];
    const dt = (last.ts - first.ts) / 1000;
    const db = last.bytes - first.bytes;
    if (dt > 0 && db > 0) {
      const bps = db / dt;
      speedLabel = formatSpeed(bps);
      const remaining = Math.max(0, p.bytes_total - p.bytes_done);
      if (remaining > 0 && p.bytes_total > 0) {
        etaLabel = formatEta(remaining / bps);
      }
    }
  }

  return (
    <div className="text-xs space-y-1 min-w-[140px]">
      <div className="flex items-center gap-2">
        <span className="text-zinc-300 tabular-nums">{pct}%</span>
        <span className="text-zinc-400 tabular-nums">{speedLabel}</span>
        {etaLabel && (
          <span className="text-zinc-500 tabular-nums">{etaLabel}</span>
        )}
        <button
          onClick={onPause}
          title="Pause"
          aria-label="Pause download"
          className="ml-auto text-zinc-400 hover:text-zinc-100 p-1 rounded hover:bg-zinc-800"
        >
          <Pause size={12} fill="currentColor" />
        </button>
      </div>
      <div className="h-1 w-32 bg-zinc-800 rounded overflow-hidden">
        <div className="h-full bg-zinc-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function formatSpeed(bps: number): string {
  if (bps >= 1_048_576) return `${(bps / 1_048_576).toFixed(1)} MB/s`;
  if (bps >= 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${bps.toFixed(0)} B/s`;
}

function formatEta(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m${s.toString().padStart(2, "0")}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h${m.toString().padStart(2, "0")}m`;
}

interface ImportDialogProps {
  onClose: () => void;
  onImported: () => void;
}

function ImportDialog({ onClose, onImported }: ImportDialogProps) {
  const [runtime, setRuntime] = useState<RuntimeId>("llama_cpp");
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const FORMAT_HINT: Record<RuntimeId, string> = {
    llama_cpp: "Pick a single .gguf file",
    litert_lm: "Pick a single .litertlm file",
    mlx: "Pick the model directory containing config.json + safetensors + tokenizer",
  };

  const pickPath = async () => {
    setErr(null);
    try {
      const selected = await open({
        directory: runtime === "mlx",
        multiple: false,
        filters:
          runtime === "llama_cpp"
            ? [{ name: "GGUF", extensions: ["gguf"] }]
            : runtime === "litert_lm"
              ? [{ name: "LiteRT-LM", extensions: ["litertlm"] }]
              : undefined,
      });
      if (typeof selected === "string") {
        setPath(selected);
        if (!name) {
          // Auto-suggest a name from filename/dir.
          const base = selected.split("/").pop() ?? "";
          const cleaned = base.replace(/\.(gguf|litertlm)$/i, "");
          setName(cleaned);
        }
      }
    } catch (e) {
      setErr(String(e));
    }
  };

  const submit = async () => {
    if (!path || !name) {
      setErr("Pick a path and provide a display name.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await importModel(runtime, path, name);
      onImported();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  // Esc to close — defined inside the dialog so it only fires while open.
  useShortcut("esc", onClose);

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={(e) => {
        // Backdrop click closes; clicks inside the panel bubble are stopped below.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-zinc-950 border border-zinc-800 rounded-lg w-[480px] p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Import a model</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
            className="text-zinc-400 hover:text-zinc-100 p-1 rounded hover:bg-zinc-900"
          >
            <XIcon size={14} />
          </button>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-zinc-400 mb-1">
            Runtime
          </label>
          <div className="flex gap-2">
            {ALL_RUNTIMES.map((rt) => (
              <button
                key={rt}
                onClick={() => {
                  setRuntime(rt);
                  setPath("");
                }}
                className={[
                  "px-3 py-1.5 text-sm rounded border",
                  runtime === rt
                    ? "border-zinc-300 bg-zinc-800 text-zinc-100"
                    : "border-zinc-800 text-zinc-400 hover:border-zinc-600",
                ].join(" ")}
              >
                {RUNTIME_LABELS[rt]}
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-400 mt-2">{FORMAT_HINT[runtime]}</p>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-zinc-400 mb-1">
            Source
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={path}
              placeholder="(none selected)"
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs font-mono"
            />
            <button
              onClick={pickPath}
              className="text-sm px-3 py-1.5 rounded border border-zinc-700 hover:border-zinc-500"
            >
              Browse
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-zinc-400 mb-1">
            Display name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Mistral 7B Instruct"
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm"
          />
        </div>

        {err && (
          <div className="text-sm text-red-400 bg-red-950/30 border border-red-900/40 rounded px-3 py-2">
            {err}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            disabled={busy}
            className="text-sm px-3 py-1.5 rounded text-zinc-400 hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || !path || !name}
            className="text-sm px-3 py-1.5 rounded bg-zinc-100 text-zinc-900 font-medium disabled:opacity-40"
          >
            {busy ? "Importing…" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
