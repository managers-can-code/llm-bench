import { useEffect, useRef, useState } from "react";
import {
  listModels,
  createConversation,
  startChatTurn,
  onChatChunk,
} from "../lib/ipc";
import {
  ALL_RUNTIMES,
  RUNTIME_LABELS,
  type Model,
  type Message,
  type RuntimeId,
} from "../lib/types";

interface Bubble {
  role: "user" | "assistant";
  text: string;
  pending?: boolean;
}

export default function ChatPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [modelId, setModelId] = useState<string>("");
  const [runtime, setRuntime] = useState<RuntimeId>("llama_cpp");
  const [convId, setConvId] = useState<string | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load model list on mount.
  useEffect(() => {
    listModels()
      .then((ms) => {
        setModels(ms);
        if (ms.length && !modelId) setModelId(ms[0].id);
      })
      .catch(() => {
        // Backend not wired yet — leave empty so the UI still renders.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to streaming chunks for the active conversation.
  useEffect(() => {
    if (!convId) return;
    let unlisten: (() => void) | undefined;
    onChatChunk(convId, (chunk) => {
      setBubbles((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant" && last.pending) {
          last.text += chunk.text;
          if (chunk.done) last.pending = false;
        }
        return next;
      });
      // auto-scroll
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current.scrollHeight,
        });
      });
      if (chunk.done) setSending(false);
    }).then((u) => (unlisten = u));
    return () => {
      unlisten?.();
    };
  }, [convId]);

  const selectedModel = models.find((m) => m.id === modelId);
  const supportedRuntimes: RuntimeId[] =
    selectedModel?.bindings
      .filter((b) => b.available)
      .map((b) => b.runtime) ?? [];

  const send = async () => {
    if (!input.trim() || !modelId || sending) return;
    setSending(true);
    const text = input;
    setInput("");

    let id = convId;
    if (!id) {
      try {
        const conv = await createConversation(modelId, runtime);
        id = conv.id;
        setConvId(id);
      } catch {
        // Backend not yet implemented; fall back to a fake id so UI still flows.
        id = `local-${Date.now()}`;
        setConvId(id);
      }
    }

    setBubbles((prev) => [
      ...prev,
      { role: "user", text },
      { role: "assistant", text: "", pending: true },
    ]);

    const userMsg: Message = {
      role: "user",
      parts: [{ kind: "text", text }],
      ts: Date.now(),
    };

    try {
      await startChatTurn(id!, userMsg);
    } catch (e) {
      setBubbles((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant" && last.pending) {
          last.pending = false;
          last.text = `(backend not implemented yet — ${String(e)})`;
        }
        return next;
      });
      setSending(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-zinc-800 px-4 py-2 flex items-center gap-3 text-sm">
        <select
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-sm"
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
        >
          {models.length === 0 && <option value="">(no models)</option>}
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.display_name}
            </option>
          ))}
        </select>

        <select
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-sm disabled:opacity-50"
          value={runtime}
          onChange={(e) => setRuntime(e.target.value as RuntimeId)}
          disabled={!selectedModel}
        >
          {ALL_RUNTIMES.map((rt) => (
            <option
              key={rt}
              value={rt}
              disabled={!supportedRuntimes.includes(rt)}
            >
              {RUNTIME_LABELS[rt]}
            </option>
          ))}
        </select>

        <span className="text-zinc-500 text-xs">
          {selectedModel
            ? `${selectedModel.arch.kind === "moe" ? "MoE" : "dense"} · ${selectedModel.quant}`
            : "select a model"}
        </span>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {bubbles.length === 0 && (
          <div className="text-center text-zinc-600 text-sm pt-12">
            Send a message to start.
          </div>
        )}
        {bubbles.map((b, i) => (
          <div
            key={i}
            className={[
              "max-w-3xl rounded-lg px-4 py-3 whitespace-pre-wrap text-sm leading-relaxed",
              b.role === "user"
                ? "ml-auto bg-zinc-800 text-zinc-100"
                : "mr-auto bg-zinc-900 border border-zinc-800 text-zinc-200",
            ].join(" ")}
          >
            {b.text || (b.pending ? "…" : "")}
          </div>
        ))}
      </div>

      <footer className="border-t border-zinc-800 p-3">
        <div className="flex gap-2 items-end max-w-4xl mx-auto">
          <button
            type="button"
            disabled
            title="Image attach coming in v0.2"
            className="text-xs px-2 py-2 rounded border border-zinc-800 text-zinc-600 cursor-not-allowed"
          >
            + image
          </button>
          <textarea
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm resize-none focus:outline-none focus:border-zinc-600"
            rows={2}
            placeholder="Ask anything…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button
            type="button"
            onClick={send}
            disabled={sending || !input.trim()}
            className="bg-zinc-100 text-zinc-900 text-sm font-medium px-4 py-2 rounded disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </footer>
    </div>
  );
}
