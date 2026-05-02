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

type TurnStatus =
  | "idle"
  | "loading_model"
  | "thinking"
  | "streaming"
  | "done"
  | "error";

interface Bubble {
  role: "user" | "assistant";
  text: string;
  modelId?: string;
  runtime?: RuntimeId;
  status?: TurnStatus;
  ts: number;
}

export default function ChatPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [modelId, setModelId] = useState<string>("");
  const [runtime, setRuntime] = useState<RuntimeId>("llama_cpp");
  const [convId, setConvId] = useState<string | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [turnStatus, setTurnStatus] = useState<TurnStatus>("idle");
  const scrollRef = useRef<HTMLDivElement>(null);
  // Track the time we sent the request so first-chunk can flip status to streaming.
  const turnStartedAtRef = useRef<number>(0);

  // Load model list on mount.
  useEffect(() => {
    listModels()
      .then((ms) => {
        setModels(ms);
        if (ms.length && !modelId) setModelId(ms[0].id);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to streaming chunks for the active conversation.
  useEffect(() => {
    if (!convId) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    onChatChunk(convId, (chunk) => {
      if (cancelled) return;
      // First chunk transitions from "thinking" → "streaming".
      setTurnStatus((prev) =>
        prev === "thinking" || prev === "loading_model" ? "streaming" : prev,
      );
      setBubbles((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant" && last.status !== "done") {
          last.text += chunk.text;
          if (chunk.done) {
            last.status = chunk.text.startsWith("[error]") ? "error" : "done";
          } else {
            last.status = "streaming";
          }
        }
        return next;
      });
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current.scrollHeight,
        });
      });
      if (chunk.done) {
        setTurnStatus(chunk.text.startsWith("[error]") ? "error" : "done");
      }
    }).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [convId]);

  const selectedModel = models.find((m) => m.id === modelId);
  const supportedRuntimes: RuntimeId[] =
    selectedModel?.bindings.filter((b) => b.available).map((b) => b.runtime) ??
    [];

  const send = async () => {
    const text = input.trim();
    if (!text || !modelId) return;
    if (turnStatus === "thinking" || turnStatus === "streaming") return;
    setInput("");
    setTurnStatus("loading_model");
    turnStartedAtRef.current = performance.now();

    let id = convId;
    if (!id) {
      try {
        const conv = await createConversation(modelId, runtime);
        id = conv.id;
        setConvId(id);
      } catch {
        id = `local-${Date.now()}`;
        setConvId(id);
      }
    }

    setBubbles((prev) => [
      ...prev,
      { role: "user", text, ts: Date.now() },
      {
        role: "assistant",
        text: "",
        modelId,
        runtime,
        status: "loading_model",
        ts: Date.now(),
      },
    ]);

    const userMsg: Message = {
      role: "user",
      parts: [{ kind: "text", text }],
      ts: Date.now(),
    };

    try {
      await startChatTurn(id!, userMsg);
      // Once startChatTurn returns, the runtime has accepted the prompt.
      // First chunk will flip to "streaming".
      setTurnStatus("thinking");
    } catch (e) {
      setBubbles((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant") {
          last.status = "error";
          last.text = `[error] ${String(e)}`;
        }
        return next;
      });
      setTurnStatus("error");
    }
  };

  const handleNewChat = () => {
    setConvId(null);
    setBubbles([]);
    setInput("");
    setTurnStatus("idle");
  };

  return (
    <div className="h-full flex flex-col bg-zinc-950">
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

        <StatusPill status={turnStatus} />

        <span className="text-zinc-500 text-xs ml-auto">
          {selectedModel
            ? `${selectedModel.arch.kind === "moe" ? "MoE" : "dense"} · ${selectedModel.quant}`
            : ""}
        </span>

        <button
          onClick={handleNewChat}
          className="text-xs px-2 py-1 rounded border border-zinc-800 hover:border-zinc-600 text-zinc-400"
        >
          + New chat
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
        {bubbles.length === 0 && (
          <div className="text-center text-zinc-600 text-sm pt-12">
            Pick a model and runtime, then send a message.
          </div>
        )}
        {bubbles.map((b, i) => (
          <BubbleView key={i} bubble={b} />
        ))}
      </div>

      <footer className="border-t border-zinc-800 p-3">
        <div className="flex gap-2 items-end max-w-4xl mx-auto">
          <button
            type="button"
            disabled
            title="Image attach coming in v0.3"
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
            disabled={
              !input.trim() ||
              turnStatus === "thinking" ||
              turnStatus === "streaming" ||
              turnStatus === "loading_model"
            }
            className="bg-zinc-100 text-zinc-900 text-sm font-medium px-4 py-2 rounded disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </footer>
    </div>
  );
}

interface BubbleViewProps {
  bubble: Bubble;
}

function BubbleView({ bubble }: BubbleViewProps) {
  const isUser = bubble.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-2xl rounded-2xl rounded-tr-sm bg-zinc-100 text-zinc-900 px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
          {bubble.text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-2xl flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-[11px] text-zinc-500">
          <span className="font-medium text-zinc-400">assistant</span>
          {bubble.modelId && (
            <span className="rounded bg-zinc-900 border border-zinc-800 px-1.5 py-0.5">
              {bubble.modelId}
            </span>
          )}
          {bubble.runtime && (
            <span className="rounded bg-zinc-900 border border-zinc-800 px-1.5 py-0.5">
              {RUNTIME_LABELS[bubble.runtime]}
            </span>
          )}
        </div>
        <div
          className={[
            "rounded-2xl rounded-tl-sm border bg-zinc-900 px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap",
            bubble.status === "error"
              ? "border-red-900/50 text-red-300"
              : "border-zinc-800 text-zinc-200",
          ].join(" ")}
        >
          {bubble.text || (
            <BubblePending status={bubble.status ?? "thinking"} />
          )}
        </div>
      </div>
    </div>
  );
}

function BubblePending({ status }: { status: TurnStatus }) {
  const label =
    status === "loading_model"
      ? "loading model…"
      : status === "thinking"
        ? "thinking…"
        : "…";
  return (
    <span className="text-zinc-500 italic flex items-center gap-2">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-500 animate-pulse" />
      {label}
    </span>
  );
}

interface StatusPillProps {
  status: TurnStatus;
}

function StatusPill({ status }: StatusPillProps) {
  if (status === "idle") return null;

  const styles: Record<TurnStatus, { label: string; cls: string }> = {
    idle: { label: "idle", cls: "" },
    loading_model: {
      label: "loading model",
      cls: "border-blue-700/40 text-blue-300 bg-blue-900/20",
    },
    thinking: {
      label: "thinking",
      cls: "border-amber-700/40 text-amber-300 bg-amber-900/20",
    },
    streaming: {
      label: "streaming",
      cls: "border-emerald-700/40 text-emerald-300 bg-emerald-900/20",
    },
    done: {
      label: "done",
      cls: "border-zinc-700 text-zinc-400 bg-zinc-900",
    },
    error: {
      label: "error",
      cls: "border-red-800 text-red-300 bg-red-900/20",
    },
  };
  const s = styles[status];
  return (
    <span
      className={[
        "text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border",
        s.cls,
      ].join(" ")}
    >
      {s.label}
    </span>
  );
}
