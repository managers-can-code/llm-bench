import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../lib/toast";
import { ConfirmProvider } from "../lib/confirm";
import type { Model } from "../lib/types";

// Module-scoped mutable state used by the hoisted vi.mock factory.
// Must be declared via vi.hoisted so it's initialized before mock factory runs.
const state = vi.hoisted(() => ({
  models: [] as Model[],
}));

vi.mock("../lib/ipc", () => ({
  listModels: vi.fn(async () => state.models),
  listConversations: vi.fn(async () => []),
  getConversation: vi.fn(async () => {
    throw new Error("not used");
  }),
  deleteConversation: vi.fn(async () => undefined),
  createConversation: vi.fn(async () => ({
    id: "c1",
    title: "t",
    model_id: "m",
    runtime: "llama_cpp" as const,
    messages: [],
    created_at: 0,
    updated_at: 0,
  })),
  startChatTurn: vi.fn(async () => "turn1"),
  onChatChunk: vi.fn(async () => () => {}),
}));

import ChatPage from "../pages/Chat";

function setModels(ms: Model[]) {
  state.models = ms;
}

function renderChat() {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <MemoryRouter>
          <ChatPage />
        </MemoryRouter>
      </ConfirmProvider>
    </ToastProvider>,
  );
}

describe("ChatPage empty states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("with no models loaded at all, renders the 'no models' card", async () => {
    setModels([]);
    renderChat();
    await waitFor(() =>
      expect(screen.getByText(/No models loaded/i)).toBeInTheDocument(),
    );
  });

  test("with models in registry but none downloaded, shows welcome + Browse models link", async () => {
    setModels([
      {
        id: "m1",
        display_name: "Test M1",
        family: "gemma_4",
        arch: { kind: "dense" },
        modalities: ["text"],
        quant: "iq4_xs",
        ctx_max: 4096,
        bindings: [
          {
            runtime: "llama_cpp",
            hf_repo: "x/y",
            hf_file: "z.gguf",
            size_gb: 1.0,
            available: true,
          },
        ],
        local: { llama_cpp: false },
      },
    ]);
    renderChat();
    await waitFor(() =>
      expect(screen.getByText(/Welcome to llm-bench/i)).toBeInTheDocument(),
    );
    const browse = screen.getByRole("link", { name: /Browse models/i });
    expect(browse.getAttribute("href")).toBe("/models");
  });

  test("with models downloaded, shows prompt suggestion chips", async () => {
    setModels([
      {
        id: "m1",
        display_name: "Test M1",
        family: "gemma_4",
        arch: { kind: "dense" },
        modalities: ["text"],
        quant: "iq4_xs",
        ctx_max: 4096,
        bindings: [
          {
            runtime: "llama_cpp",
            hf_repo: "x/y",
            hf_file: "z.gguf",
            size_gb: 1.0,
            available: true,
          },
        ],
        local: { llama_cpp: true },
      },
    ]);
    renderChat();
    await waitFor(() =>
      expect(screen.getByText(/Send a message to start/i)).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/Explain int4 quantization/i),
    ).toBeInTheDocument();
  });

  test("clicking a suggestion chip pre-fills the textarea", async () => {
    setModels([
      {
        id: "m1",
        display_name: "Test M1",
        family: "gemma_4",
        arch: { kind: "dense" },
        modalities: ["text"],
        quant: "iq4_xs",
        ctx_max: 4096,
        bindings: [
          {
            runtime: "llama_cpp",
            hf_repo: "x/y",
            hf_file: "z.gguf",
            size_gb: 1.0,
            available: true,
          },
        ],
        local: { llama_cpp: true },
      },
    ]);
    const user = userEvent.setup();
    renderChat();
    await waitFor(() =>
      expect(
        screen.getByText(/Explain int4 quantization/i),
      ).toBeInTheDocument(),
    );
    await user.click(screen.getByText(/Explain int4 quantization/i));
    const ta = screen.getByPlaceholderText(
      /Ask anything/i,
    ) as HTMLTextAreaElement;
    expect(ta.value).toMatch(/int4 quantization/i);
  });
});
