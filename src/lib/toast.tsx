import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, AlertTriangle, Info, X as XIcon } from "lucide-react";

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  ttlMs: number;
}

interface ToastApi {
  push: (text: string, kind?: ToastKind, ttlMs?: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback<ToastApi["push"]>(
    (text, kind = "info", ttlMs = 4000) => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { id, kind, text, ttlMs }]);
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Outside provider (e.g. in tests rendered without ToastProvider).
    return {
      push: (text) => {
        // eslint-disable-next-line no-console
        console.warn("[toast outside provider]", text);
      },
    };
  }
  return ctx;
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), toast.ttlMs);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);

  const palette =
    toast.kind === "error"
      ? "border-red-900/60 bg-red-950/40 text-red-200"
      : toast.kind === "success"
        ? "border-emerald-900/60 bg-emerald-950/40 text-emerald-200"
        : "border-zinc-800 bg-zinc-900 text-zinc-200";

  const Icon =
    toast.kind === "error"
      ? AlertTriangle
      : toast.kind === "success"
        ? CheckCircle2
        : Info;

  return (
    <div
      role="status"
      className={[
        "pointer-events-auto rounded-md border px-3 py-2 text-sm shadow-lg flex items-start gap-2 max-w-sm",
        palette,
      ].join(" ")}
    >
      <Icon size={14} className="mt-0.5 shrink-0" />
      <div className="flex-1 leading-snug">{toast.text}</div>
      <button
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="text-zinc-400 hover:text-zinc-100 -mr-1"
      >
        <XIcon size={12} />
      </button>
    </div>
  );
}
