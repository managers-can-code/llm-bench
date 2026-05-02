import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle } from "lucide-react";
import { useShortcut } from "./useShortcut";

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface ConfirmApi {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmApi | null>(null);

interface PendingConfirm extends ConfirmOptions {
  resolve: (v: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback<ConfirmApi["confirm"]>(
    (opts) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...opts, resolve });
      }),
    [],
  );

  const close = useCallback(
    (result: boolean) => {
      if (pending) {
        pending.resolve(result);
        setPending(null);
      }
    },
    [pending],
  );

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {pending && <ConfirmDialog opts={pending} onResolve={close} />}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmApi {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    return {
      confirm: async (opts) => window.confirm(opts.message),
    };
  }
  return ctx;
}

function ConfirmDialog({
  opts,
  onResolve,
}: {
  opts: ConfirmOptions;
  onResolve: (v: boolean) => void;
}) {
  useShortcut("esc", () => onResolve(false));
  useEffect(() => {
    // Auto-focus the confirm button on open for keyboard users.
    const t = setTimeout(() => {
      const btn = document.querySelector<HTMLButtonElement>(
        "[data-confirm-default]",
      );
      btn?.focus();
    }, 10);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onResolve(false);
      }}
    >
      <div
        className="bg-zinc-950 border border-zinc-800 rounded-lg w-[420px] p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          {opts.destructive && (
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          )}
          <div className="flex-1">
            {opts.title && (
              <h3 className="font-medium text-zinc-100 mb-1">{opts.title}</h3>
            )}
            <p className="text-sm text-zinc-300 leading-relaxed">
              {opts.message}
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={() => onResolve(false)}
            className="text-sm px-3 py-1.5 rounded text-zinc-300 hover:bg-zinc-900"
          >
            {opts.cancelLabel ?? "Cancel"}
          </button>
          <button
            onClick={() => onResolve(true)}
            data-confirm-default
            className={[
              "text-sm px-3 py-1.5 rounded font-medium",
              opts.destructive
                ? "bg-red-600 text-white hover:bg-red-500"
                : "bg-zinc-100 text-zinc-900 hover:bg-white",
            ].join(" ")}
          >
            {opts.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
