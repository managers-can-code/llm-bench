import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  listModels,
  downloadModel,
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

export default function ModelsPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({});
  const [importOpen, setImportOpen] = useState(false);

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
      setProgress((prev) => ({ ...prev, [key]: p }));
      if (p.state === "done") refresh();
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
          <p className="text-sm text-zinc-500">
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
                  className="text-center text-zinc-600 py-8 text-sm"
                >
                  No models loaded.
                </td>
              </tr>
            )}
            {models.map((m) => (
              <tr key={m.id} className="border-t border-zinc-800 align-top">
                <td className="px-3 py-3">
                  <div className="font-medium">{m.display_name}</div>
                  <div className="text-xs text-zinc-500">{m.id}</div>
                  <div className="text-[10px] text-zinc-600 mt-0.5 uppercase tracking-wider">
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
                  return (
                    <td key={rt} className="px-3 py-3">
                      {!binding ? (
                        <span className="text-xs text-zinc-700">—</span>
                      ) : !binding.available ? (
                        <span className="text-xs text-zinc-600">build pending</span>
                      ) : prog && prog.state === "downloading" ? (
                        <ProgressBar p={prog} />
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

function ProgressBar({ p }: { p: DownloadProgress }) {
  const pct = p.bytes_total
    ? Math.round((p.bytes_done / p.bytes_total) * 100)
    : 0;
  return (
    <div className="text-xs">
      <div className="text-zinc-400 mb-1">{pct}%</div>
      <div className="h-1 w-24 bg-zinc-800 rounded overflow-hidden">
        <div
          className="h-full bg-zinc-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
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

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-zinc-950 border border-zinc-800 rounded-lg w-[480px] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Import a model</h2>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 text-sm"
          >
            close
          </button>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-1">
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
          <p className="text-xs text-zinc-500 mt-2">{FORMAT_HINT[runtime]}</p>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-1">
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
          <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-1">
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
