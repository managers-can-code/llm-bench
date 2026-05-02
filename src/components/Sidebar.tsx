import { NavLink } from "react-router-dom";

const items: Array<{ to: string; label: string; badge?: string }> = [
  { to: "/chat", label: "Chat" },
  { to: "/models", label: "Models" },
  { to: "/evals", label: "Evals", badge: "soon" },
  { to: "/benchmarks", label: "Benchmarks", badge: "soon" },
  { to: "/compare", label: "Compare", badge: "soon" },
];

export default function Sidebar() {
  return (
    <aside className="w-56 shrink-0 border-r border-zinc-800 bg-zinc-950 flex flex-col">
      <div className="px-4 py-4 border-b border-zinc-800">
        <div className="text-sm font-semibold tracking-wide">llm-bench</div>
        <div className="text-xs text-zinc-400 mt-0.5">v0.1.0 · skeleton</div>
      </div>
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              [
                "flex items-center justify-between px-3 py-2 rounded-md text-sm",
                isActive
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200",
              ].join(" ")
            }
          >
            <span>{item.label}</span>
            {item.badge && (
              <span className="text-[10px] uppercase tracking-wider text-zinc-400">
                {item.badge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="px-4 py-3 border-t border-zinc-800 text-[11px] text-zinc-500">
        llama.cpp · LiteRT-LM
      </div>
    </aside>
  );
}
