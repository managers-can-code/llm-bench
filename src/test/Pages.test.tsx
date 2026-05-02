import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import EvalsPage from "../pages/Evals";
import BenchmarksPage from "../pages/Benchmarks";
import ComparePage from "../pages/Compare";

describe("Preview pages", () => {
  test("Evals renders all four eval cards with planned milestones", () => {
    render(
      <MemoryRouter>
        <EvalsPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("MMLU")).toBeInTheDocument();
    expect(screen.getByText("BFCL v3")).toBeInTheDocument();
    expect(screen.getByText("τ-Bench")).toBeInTheDocument();
    expect(screen.getByText("SWE-bench Lite")).toBeInTheDocument();
    // Each card has a milestone tag.
    expect(screen.getAllByText(/^v0\.\d$/).length).toBeGreaterThanOrEqual(3);
  });

  test("Benchmarks renders the mock comparison table with all three runtimes", () => {
    render(<BenchmarksPage />);
    expect(screen.getByText(/Gemma 4 E2B/)).toBeInTheDocument();
    expect(screen.getByText("llama.cpp")).toBeInTheDocument();
    expect(screen.getByText("MLX")).toBeInTheDocument();
    expect(screen.getByText("LiteRT-LM")).toBeInTheDocument();
  });

  test("Compare renders both slot mockups with different runtimes", () => {
    render(<ComparePage />);
    expect(screen.getByText(/slot A/i)).toBeInTheDocument();
    expect(screen.getByText(/slot B/i)).toBeInTheDocument();
    expect(screen.getByText("llama.cpp")).toBeInTheDocument();
    expect(screen.getByText("MLX")).toBeInTheDocument();
  });
});
