import { describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../lib/ipc", () => ({
  listModels: vi.fn(async () => []),
  listBenchRuns: vi.fn(async () => []),
  runBenchmark: vi.fn(async () => null),
  deleteBenchRun: vi.fn(async () => undefined),
}));

import EvalsPage from "../pages/Evals";
import BenchmarksPage from "../pages/Benchmarks";
import ComparePage from "../pages/Compare";
import { ToastProvider } from "../lib/toast";
import { ConfirmProvider } from "../lib/confirm";

function renderWithProviders(ui: React.ReactNode) {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </ConfirmProvider>
    </ToastProvider>,
  );
}

describe("Preview pages", () => {
  test("Evals renders all four eval cards with planned milestones", () => {
    renderWithProviders(<EvalsPage />);
    expect(screen.getByText("MMLU")).toBeInTheDocument();
    expect(screen.getByText("BFCL v3")).toBeInTheDocument();
    expect(screen.getByText("τ-Bench")).toBeInTheDocument();
    expect(screen.getByText("SWE-bench Lite")).toBeInTheDocument();
    expect(screen.getAllByText(/^v0\.\d$/).length).toBeGreaterThanOrEqual(3);
  });

  test("Benchmarks renders empty state with 'New run' button when no runs exist", async () => {
    renderWithProviders(<BenchmarksPage />);
    expect(
      screen.getByRole("heading", { name: /Benchmarks/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /New run/i }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText(/No benchmark runs yet/i)).toBeInTheDocument(),
    );
  });

  test("Compare renders both slot mockups with different runtimes", () => {
    renderWithProviders(<ComparePage />);
    expect(screen.getByText(/slot A/i)).toBeInTheDocument();
    expect(screen.getByText(/slot B/i)).toBeInTheDocument();
  });
});
