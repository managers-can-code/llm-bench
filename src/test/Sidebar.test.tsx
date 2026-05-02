import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Sidebar from "../components/Sidebar";

describe("Sidebar", () => {
  function renderInRouter(initialPath = "/chat") {
    return render(
      <MemoryRouter initialEntries={[initialPath]}>
        <Sidebar />
      </MemoryRouter>,
    );
  }

  test("renders the app brand and version", () => {
    renderInRouter();
    expect(screen.getByText("llm-bench")).toBeInTheDocument();
    // Skeleton tag is part of the version line.
    expect(screen.getByText(/skeleton/i)).toBeInTheDocument();
  });

  test("links to all five primary pages", () => {
    renderInRouter();
    expect(screen.getByRole("link", { name: /chat/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /models/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /evals/i })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /benchmarks/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /compare/i })).toBeInTheDocument();
  });

  test("highlights the link matching the current route", () => {
    renderInRouter("/models");
    const link = screen.getByRole("link", { name: /models/i });
    expect(link.className).toMatch(/bg-zinc-800/);
  });
});
