import { useEffect, useState } from "react";
import {
  listModels,
  downloadModel,
  deleteLocalModel,
  onDownloadProgress,
} from "../lib/ipc";
import type { Model, RuntimeId, DownloadProgress } from "../lib/types";

export default function ModelsPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({});

  const refresh = () => {
    listModels()
      .then(setModels)
      .catch(() => setModels([]));
  };

  useEffect(() => {
    refresh();
    let unlisten: (() => void) | undefined;
    onDownloadProgress((p) => {
      const key = `${p.model_id}::${p.runtime}`;
      setProgress((prev) => ({ ...prev, [key]: p }));
      if (p.state === "done") refresh();
    }).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, []);

  const handleDownload = async (m: Model, rt: RuntimeId) => {
    try {
      await downloadModel(m.id, rt);
    } catch (e) {
      alert(`download failed: ${e}`);
    }
  };

  const handleDelete = async (m: Model, rt: RuntimeId) => {
    if (!confirm(`Delete local copy of ${m.display_name} (${rt})?`)) return;
    try {
      await deleteLocalModel(m.id, rt);
      refresh();
    } catch (e) {
      alert(`delete failed: ${e}`);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="text-lg font-semibold mb-1">Models</h1>
      <p className="text-sm text-zinc-500 mb-6">
        Initial lineup is int4-quantized. Pull models from Hugging Face into{" "}
        <code className="text-zinc-400">~/.llm-bench/models/</code>.
      </p>

      <div className="border border-zinc-800 rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-zinc-400 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-3 py-2">Model</th>
              <th className="text-left px-3 py-2">Arch</th>
              <th className="text-left px-3 py-2">Quant</th>
              <th className="text-left px-3 py-2">llama.cpp</th>
              <th className="text-left px-3 py-2">LiteRT-LM</th>
            </tr>
          </thead>
          <tbody>
            {models.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="text-center text-zinc-600 py-8 text-sm"
                >
                  No models loaded. Backend not yet running, or registry empty.
                </td>
              </tr>
            )}
            {models.map((m) => (
              <tr key={m.id} className="border-t border-zinc-800">
                <td className="px-3 py-3">
                  <div className="font-medium">{m.display_name}</div>
                  <div className="text-xs text-zinc-500">{m.id}</div>
                </td>
                <td className="px-3 py-3 text-zinc-300">
                  {m.arch.kind === "moe"
                    ? `MoE (${m.arch.active_b}B/${m.arch.total_b}B)`
                    : "dense"}
                </td>
                <td className="px-3 py-3 text-zinc-300 font-mono text-xs">
                  {m.quant}
                </td>
                {(["llama_cpp", "litert_lm"] as RuntimeId[]).map((rt) => {
                  const binding = m.bindings.find((b) => b.runtime === rt);
                  const local = m.local[rt];
                  const key = `${m.id}::${rt}`;
                  const prog = progress[key];
                  return (
                    <td key={rt} className="px-3 py-3">
                      {!binding || !binding.available ? (
                        <span className="text-xs text-zinc-600">
                          build pending
                        </span>
                      ) : prog && prog.state === "downloading" ? (
                        <span className="text-xs text-zinc-400">
                          {Math.round(
                            (prog.bytes_done / Math.max(1, prog.bytes_total)) *
                              100,
                          )}
                          %
                        </span>
                      ) : local ? (
                        <button
                          onClick={() => handleDelete(m, rt)}
                          className="text-xs px-2 py-1 rounded border border-zinc-700 hover:border-red-700 hover:text-red-400"
                        >
                          delete · {binding.size_gb} GB
                        </button>
                      ) : (
                        <button
                          onClick={() => handleDownload(m, rt)}
                          className="text-xs px-2 py-1 rounded border border-zinc-700 hover:border-zinc-500"
                        >
                          download · {binding.size_gb} GB
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
    </div>
  );
}
