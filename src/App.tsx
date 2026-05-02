import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { useState } from "react";
import Sidebar from "./components/Sidebar";
import ChatPage from "./pages/Chat";
import ModelsPage from "./pages/Models";
import EvalsPage from "./pages/Evals";
import BenchmarksPage from "./pages/Benchmarks";
import ComparePage from "./pages/Compare";
import { useShortcuts } from "./lib/useShortcut";

const NAV_PATHS = ["/chat", "/models", "/evals", "/benchmarks", "/compare"];

export default function App() {
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Global nav shortcuts: Cmd+1..5 jump pages, Cmd+K opens command palette.
  useShortcuts(
    [
      ...NAV_PATHS.map((path, i) => ({
        combo: `cmd+${i + 1}`,
        handler: () => navigate(path),
      })),
      { combo: "cmd+k", handler: () => setPaletteOpen(true) },
      { combo: "esc", handler: () => setPaletteOpen(false) },
    ],
    [navigate],
  );

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/models" element={<ModelsPage />} />
          <Route path="/evals" element={<EvalsPage />} />
          <Route path="/benchmarks" element={<BenchmarksPage />} />
          <Route path="/compare" element={<ComparePage />} />
        </Routes>
      </main>
      {paletteOpen && (
        <CommandPaletteStub onClose={() => setPaletteOpen(false)} />
      )}
    </div>
  );
}

/**
 * Cmd-K command palette — currently a stub. Registering the binding now
 * tells users this app is keyboard-first; the actual fuzzy-search action
 * list will land in a follow-up.
 */
function CommandPaletteStub({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-start justify-center z-50 pt-32"
      onClick={onClose}
    >
      <div
        className="bg-zinc-950 border border-zinc-800 rounded-lg w-[480px] p-4 text-sm shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-zinc-400">
          <span className="text-zinc-200 font-medium">Command palette</span>{" "}
          coming in v0.4.
        </div>
        <div className="text-xs text-zinc-500 mt-2">
          Press <Kbd>Esc</Kbd> to close.
        </div>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
      {children}
    </span>
  );
}
