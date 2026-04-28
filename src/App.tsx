import { Routes, Route, Navigate } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import ChatPage from "./pages/Chat";
import ModelsPage from "./pages/Models";
import EvalsPage from "./pages/Evals";
import BenchmarksPage from "./pages/Benchmarks";
import ComparePage from "./pages/Compare";

export default function App() {
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
    </div>
  );
}
