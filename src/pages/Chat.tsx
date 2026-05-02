import { useEffect, useRef, useState } from "react";
import { History, Plus, Settings2, X as XIcon } from "lucide-react";
import {
  listModels,
  createConversation,
  startChatTurn,
  onChatChunk,
  listConversations,
  getConversation,
  deleteConversation as deleteConvIpc,
} from "../lib/ipc";
import {
  ALL_RUNTIMES,
  RUNTIME_LABELS,
  type Model,
  type Message,
  type RuntimeId,
  type RuntimeMetrics,
  type GenOpts,
  type Conversation,
} from "../lib/types";

type TurnStatus =
  | "idle"
  | "loading_model"
  | "thinking"
  | "streaming"
  | "done"
  | "error";

type DrawerTab = "history" | "settings" | null;

interface Bubble {
  role: "user" | "assistant";
  text: string;
  modelId?: string;
  runtime?: RuntimeId;
  status?: TurnStatus;
  metrics?: RuntimeMetrics;
  ts: number;
}

const GEN_OPTS_LS_KEY = "llm-bench:gen-opts";

const DEFAULT_GEN_OPTS: GenOpts = {
  temperature: 0.7,
  top_p: 0.95,
  top_k: 40,
  max_tokens: 512,
};

function loadGenOpts(): GenOpts {
  try {
    const raw = localStorage.getItem(GEN_OPTS_LS_KEY);
    if (raw) return { ...DEFAULT_GEN_OPTS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_GEN_OPTS };
}

export default function ChatPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [modelId, setModelId] = useState<string>("");
  const [runtime, setRuntime] = useState<RuntimeId>("llama_cpp");
  const [convId, setConvId] = useState<string | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [turnStatus, setTurnStatus] = useState<TurnStatus>("idle");
  const [drawer, setDrawer] = useState<DrawerTab>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [genOpts, setGenOpts] = useState<GenOpts>(loadGenOpts);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Persist gen opts on change.
  useEffect(() => {
    try {
      localStorage.setItem(GEN_OPTS_LS_KEY, JSON.stringify(genOpts));
    } catch {
      /* ignore */
    }
  }, [genOpts]);

  // Load model list on mount.
  useEffect(() => {
    listModels()
      .then((ms) => {
        setModels(ms);
        if (ms.length && !modelId) setModelId(ms[0].id);
      })
      .catch(() => {});
    refreshHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshHistory = () => {
    listConversations()
      .then(setConversations)
      .catch(() => setConversations([]));
  };

  // Subscribe to streaming chunks for the active conversation.
  useEffect(() => {
    if (!convId) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    onChatChunk(convId, (chunk) => {
      if (cancelled) return;
      setTurnStatus((prev) =>
        prev === "thinking" || prev === "loading_model" ? "streaming" : prev,
      );
      setBubbles((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant" && last.status !== "done") {
          last.text += chunk.text;
          if (chunk.metrics) last.metrics = chunk.metrics;
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
        refreshHistory();
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
      await startChatTurn(id!, userMsg, genOpts);
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

  const loadConversation = async (id: string) => {
    try {
      const conv = await getConversation(id);
      setConvId(conv.id);
      setModelId(conv.model_id);
      setRuntime(conv.runtime);
      setBubbles(
        conv.messages
          .filter((m) => m.role !== "system")
          .map((m) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            text: m.parts
              .map((p) => (p.kind === "text" ? p.text : ""))
              .join(""),
            modelId: conv.model_id,
            runtime: conv.runtime,
            status: "done",
            ts: m.ts ?? Date.now(),
          })),
      );
      setTurnStatus("idle");
      setDrawer(null);
    } catch (e) {
      alert(`could not load conversation: ${e}`);
    }
  };

  const handleDeleteConversation = async (id: string, evt: React.MouseEvent) => {
    evt.stopPropagation();
    if (!confirm("Delete this conversation?")) return;
    try {
      await deleteConvIpc(id);
      if (convId === id) handleNewChat();
      refreshHistory();
    } catch (e) {
      alert(`delete failed: ${e}`);
    }
  };

  return (
    <div className="h-full flex bg-zinc-950">
      {/* Main chat column */}
      <div className="flex-1 flex flex-col min-w-0">
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

          <div className="ml-auto flex items-center gap-1">
            <IconButton
              label="History"
              active={drawer === "history"}
              onClick={() => setDrawer(drawer === "history" ? null : "history")}
            >
              <History size={14} />
            </IconButton>
            <IconButton
              label="Settings"
              active={drawer === "settings"}
              onClick={() =>
                setDrawer(drawer === "settings" ? null : "settings")
              }
            >
              <Settings2 size={14} />
            </IconButton>
            <button
              onClick={handleNewChat}
              title="New chat"
              aria-label="New chat"
              className="text-xs px-2 py-1 rounded border border-zinc-800 hover:border-zinc-600 text-zinc-300 ml-1 inline-flex items-center gap-1.5"
            >
              <Plus size={13} />
              New chat
            </button>
          </div>
        </header>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-6 py-6 space-y-5"
        >
          {bubbles.length === 0 && (
            <div className="text-center text-zinc-500 text-sm pt-12">
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
              title="Image attach coming in v0.4"
              className="text-xs px-2 py-2 rounded border border-zinc-800 text-zinc-500 cursor-not-allowed"
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

      {/* Right drawer */}
      {drawer && (
        <aside className="w-72 border-l border-zinc-800 bg-zinc-950 flex flex-col">
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
            <span className="text-sm font-medium">
              {drawer === "history" ? "Chat history" : "Generation"}
            </span>
            <button
              onClick={() => setDrawer(null)}
              aria-label="Close"
              title="Close (Esc)"
              className="text-zinc-400 hover:text-zinc-100 p-1 rounded hover:bg-zinc-900"
            >
              <XIcon size={14} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {drawer === "history" ? (
              <HistoryDrawer
                conversations={conversations}
                activeId={convId}
                onLoad={loadConversation}
                onDelete={handleDeleteConversation}
              />
            ) : (
              <GenOptsDrawer
                opts={genOpts}
                onChange={setGenOpts}
                onReset={() => setGenOpts({ ...DEFAULT_GEN_OPTS })}
              />
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

interface IconButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function IconButton({ label, active, onClick, children }: IconButtonProps) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={[
        "w-7 h-7 rounded text-sm flex items-center justify-center border",
        active
          ? "bg-zinc-800 border-zinc-700 text-zinc-100"
          : "border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

interface HistoryDrawerProps {
  conversations: Conversation[];
  activeId: string | null;
  onLoad: (id: string) => void;
  onDelete: (id: string, evt: React.MouseEvent) => void;
}

function HistoryDrawer({
  conversations,
  activeId,
  onLoad,
  onDelete,
}: HistoryDrawerProps) {
  if (conversations.length === 0) {
    return (
      <p className="text-xs text-zinc-500 px-4 py-6">
        No saved conversations yet.
      </p>
    );
  }
  return (
    <ul className="px-2 py-2 space-y-0.5">
      {conversations.map((c) => {
        const firstUser = c.messages.find((m) => m.role === "user");
        const subtitle = firstUser
          ? firstUser.parts
              .map((p) => (p.kind === "text" ? p.text : ""))
              .join("")
              .slice(0, 80)
          : "(empty)";
        const isActive = c.id === activeId;
        return (
          <li
            key={c.id}
            onClick={() => onLoad(c.id)}
            className={[
              "group cursor-pointer rounded px-2 py-2 text-xs",
              isActive
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-300 hover:bg-zinc-900",
            ].join(" ")}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{c.title}</div>
                <div className="text-[10px] text-zinc-400 truncate">
                  {subtitle}
                </div>
                <div className="text-[10px] text-zinc-500 mt-0.5">
                  {RUNTIME_LABELS[c.runtime]} · {new Date(c.updated_at).toLocaleString()}
                </div>
              </div>
              <button
                onClick={(e) => onDelete(c.id, e)}
                className="opacity-30 group-hover:opacity-100 focus-visible:opacity-100 text-zinc-400 hover:text-red-400 p-0.5 rounded"
                title="Delete"
                aria-label="Delete conversation"
              >
                <XIcon size={12} />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

interface GenOptsDrawerProps {
  opts: GenOpts;
  onChange: (next: GenOpts) => void;
  onReset: () => void;
}

function GenOptsDrawer({ opts, onChange, onReset }: GenOptsDrawerProps) {
  const set = (patch: Partial<GenOpts>) => onChange({ ...opts, ...patch });

  return (
    <div className="px-4 py-3 space-y-4 text-sm">
      <SliderField
        label="temperature"
        hint="randomness — higher = more creative"
        value={opts.temperature ?? 0.7}
        min={0}
        max={2}
        step={0.05}
        onChange={(v) => set({ temperature: v })}
      />
      <SliderField
        label="top_p"
        hint="nucleus sampling — pick from top p% of probs"
        value={opts.top_p ?? 0.95}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => set({ top_p: v })}
      />
      <SliderField
        label="top_k"
        hint="restrict to k highest-probability tokens"
        value={opts.top_k ?? 40}
        min={0}
        max={200}
        step={1}
        onChange={(v) => set({ top_k: Math.round(v) })}
        integer
      />
      <SliderField
        label="max_tokens"
        hint="hard cap on response length"
        value={opts.max_tokens ?? 512}
        min={32}
        max={4096}
        step={32}
        onChange={(v) => set({ max_tokens: Math.round(v) })}
        integer
      />
      <SeedField
        value={opts.seed}
        onChange={(v) => set({ seed: v })}
      />

      <div className="pt-2 flex justify-between">
        <button
          onClick={onReset}
          className="text-xs text-zinc-400 hover:text-zinc-300"
        >
          reset to defaults
        </button>
        <span className="text-[10px] text-zinc-500">
          saved automatically
        </span>
      </div>
    </div>
  );
}

interface SliderFieldProps {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  integer?: boolean;
  onChange: (v: number) => void;
}

function SliderField({
  label,
  hint,
  value,
  min,
  max,
  step,
  integer,
  onChange,
}: SliderFieldProps) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <label className="text-xs font-mono text-zinc-300">{label}</label>
        <span className="text-xs tabular-nums text-zinc-400">
          {integer ? value : value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-zinc-300"
      />
      <p className="text-[10px] text-zinc-500 mt-0.5">{hint}</p>
    </div>
  );
}

interface SeedFieldProps {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
}

function SeedField({ value, onChange }: SeedFieldProps) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <label className="text-xs font-mono text-zinc-300">seed</label>
        <span className="text-[10px] text-zinc-500">
          empty = random each turn
        </span>
      </div>
      <input
        type="text"
        inputMode="numeric"
        value={text}
        placeholder="(none)"
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value === "") {
            onChange(undefined);
          } else {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(n);
          }
        }}
        className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs font-mono"
      />
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
        <div className="flex items-center gap-2 text-[11px] text-zinc-400">
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
        {bubble.metrics && bubble.status === "done" && (
          <StatsFooter metrics={bubble.metrics} />
        )}
      </div>
    </div>
  );
}

function StatsFooter({ metrics }: { metrics: RuntimeMetrics }) {
  const items: Array<[string, string]> = [];
  if (metrics.hardware) items.push(["hw", metrics.hardware]);
  if (metrics.ttft_ms) items.push(["ttft", `${metrics.ttft_ms}ms`]);
  if (metrics.tokens_per_sec_prefill > 0)
    items.push([
      "prefill",
      `${metrics.tokens_per_sec_prefill.toFixed(1)} tok/s`,
    ]);
  if (metrics.tokens_per_sec_decode > 0)
    items.push([
      "decode",
      `${metrics.tokens_per_sec_decode.toFixed(1)} tok/s`,
    ]);
  if (metrics.total_ms)
    items.push([
      "total",
      metrics.total_ms < 1000
        ? `${metrics.total_ms}ms`
        : `${(metrics.total_ms / 1000).toFixed(1)}s`,
    ]);
  if (metrics.completion_tokens)
    items.push(["out", `${metrics.completion_tokens} tok`]);

  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-zinc-400 mt-1 px-1 font-mono">
      {items.map(([k, v]) => (
        <span key={k}>
          <span className="text-zinc-500">{k}</span>{" "}
          <span className="text-zinc-400 tabular-nums">{v}</span>
        </span>
      ))}
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
    <span className="text-zinc-400 italic flex items-center gap-2">
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
