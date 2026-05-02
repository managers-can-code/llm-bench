import { NavLink } from "react-router-dom";
import {
  BarChart3,
  Box,
  Columns2,
  MessageSquare,
  ScanSearch,
  type LucideIcon,
} from "lucide-react";
import { isMac } from "../lib/useShortcut";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  shortcutNum: number;
  badge?: string;
}

const items: NavItem[] = [
  { to: "/chat", label: "Chat", icon: MessageSquare, shortcutNum: 1 },
  { to: "/models", label: "Models", icon: Box, shortcutNum: 2 },
  {
    to: "/evals",
    label: "Evals",
    icon: ScanSearch,
    shortcutNum: 3,
    badge: "soon",
  },
  {
    to: "/benchmarks",
    label: "Benchmarks",
    icon: BarChart3,
    shortcutNum: 4,
    badge: "soon",
  },
  {
    to: "/compare",
    label: "Compare",
    icon: Columns2,
    shortcutNum: 5,
    badge: "soon",
  },
];

export default function Sidebar() {
  const cmdSym = isMac() ? "⌘" : "Ctrl+";
  return (
    <aside className="w-56 shrink-0 border-r border-zinc-800 bg-zinc-950 flex flex-col">
      <div className="px-4 py-4 border-b border-zinc-800">
        <div className="text-sm font-semibold tracking-wide text-zinc-100">
          llm-bench
        </div>
        <div className="text-xs text-zinc-500 mt-0.5">v{__APP_VERSION__}</div>
      </div>
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              title={`${item.label} (${cmdSym}${item.shortcutNum})`}
              className={({ isActive }) =>
                [
                  "group relative flex items-center gap-2.5 px-3 py-2 rounded-md text-sm",
                  isActive
                    ? "bg-zinc-800/80 text-zinc-100 font-medium"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200",
                ].join(" ")
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r-full bg-zinc-100"
                    />
                  )}
                  <Icon size={14} className="shrink-0" />
                  <span className="flex-1">{item.label}</span>
                  {item.badge && <SoonPill />}
                  <kbd className="text-[10px] text-zinc-500 font-mono opacity-0 group-hover:opacity-100">
                    {cmdSym}
                    {item.shortcutNum}
                  </kbd>
                </>
              )}
            </NavLink>
          );
        })}
      </nav>
      <div className="px-3 py-3 border-t border-zinc-800 space-y-1">
        <RuntimeStatusList />
      </div>
    </aside>
  );
}

function SoonPill() {
  return (
    <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 uppercase tracking-wider font-medium">
      soon
    </span>
  );
}

/**
 * Three small dot+label rows showing which runtimes have working binaries.
 * v0.3 placeholder: just lists all three as 'available' since we don't yet
 * fetch backend runtime_status from this component. Wire to the real probe
 * in a follow-up.
 */
function RuntimeStatusList() {
  const items = [
    { name: "llama.cpp", status: "ready" as const },
    { name: "MLX", status: "ready" as const },
    { name: "LiteRT-LM", status: "ready" as const },
  ];
  return (
    <div className="flex flex-col gap-0.5">
      {items.map((it) => (
        <div
          key={it.name}
          className="flex items-center gap-2 text-[11px] text-zinc-500"
        >
          <span
            className={[
              "h-1.5 w-1.5 rounded-full",
              it.status === "ready" ? "bg-emerald-500/70" : "bg-zinc-700",
            ].join(" ")}
          />
          <span>{it.name}</span>
        </div>
      ))}
    </div>
  );
}
