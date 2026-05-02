import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../lib/toast";
import { ConfirmProvider } from "../lib/confirm";
import type { Model } from "../lib/types";

const FAKE_MODELS: Model[] = [
  {
    id: "gemma-4-e2b-it",
    display_name: "Gemma 4 E2B (instruct)",
    family: "gemma_4",
    arch: { kind: "dense" },
    modalities: ["text", "vision"],
    quant: "iq4_xs",
    ctx_max: 32768,
    bindings: [
      {
        runtime: "llama_cpp",
        hf_repo: "unsloth/gemma-4-E2B-it-GGUF",
        hf_file: "gemma-4-E2B-it-IQ4_XS.gguf",
        size_gb: 2.4,
        available: true,
      },
    ],
    local: { llama_cpp: true },
  },
  {
    id: "qwen-3-5-4b",
    display_name: "Qwen 3.5 4B (instruct)",
    family: "qwen_3_6",
    arch: { kind: "dense" },
    modalities: ["text"],
    quant: "ud_q4_k_xl",
    ctx_max: 262144,
    bindings: [
      {
        runtime: "llama_cpp",
        hf_repo: "unsloth/Qwen3.5-4B-GGUF",
        hf_file: "Qwen3.5-4B-UD-Q4_K_XL.gguf",
        size_gb: 2.7,
        available: true,
      },
    ],
    local: { llama_cpp: false },
  },
];

vi.mock("../lib/ipc", () => ({
  listModels: vi.fn(async () => FAKE_MODELS),
  downloadModel: vi.fn(async () => undefined),
  pauseDownload: vi.fn(async () => undefined),
  deleteLocalModel: vi.fn(async () => undefined),
  importModel: vi.fn(async () => FAKE_MODELS[0]),
  onDownloadProgress: vi.fn(async () => () => {}),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => null),
}));

import ModelsPage from "../pages/Models";

function renderModels() {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <MemoryRouter>
          <ModelsPage />
        </MemoryRouter>
      </ConfirmProvider>
    </ToastProvider>,
  );
}

describe("ModelsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("renders both seeded models from listModels()", async () => {
    renderModels();
    await waitFor(() =>
      expect(
        screen.getByText("Gemma 4 E2B (instruct)"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("Qwen 3.5 4B (instruct)")).toBeInTheDocument();
  });

  test("search filter narrows to matching rows", async () => {
    const user = userEvent.setup();
    renderModels();
    await waitFor(() =>
      expect(screen.getByText("Gemma 4 E2B (instruct)")).toBeInTheDocument(),
    );
    const searchInput = screen.getByPlaceholderText("Search models…");
    await user.type(searchInput, "qwen");
    expect(
      screen.queryByText("Gemma 4 E2B (instruct)"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Qwen 3.5 4B (instruct)")).toBeInTheDocument();
  });

  test("'Installed only' checkbox hides un-downloaded rows", async () => {
    const user = userEvent.setup();
    renderModels();
    await waitFor(() =>
      expect(screen.getByText("Gemma 4 E2B (instruct)")).toBeInTheDocument(),
    );
    await user.click(screen.getByLabelText("Installed only"));
    expect(screen.getByText("Gemma 4 E2B (instruct)")).toBeInTheDocument();
    expect(
      screen.queryByText("Qwen 3.5 4B (instruct)"),
    ).not.toBeInTheDocument();
  });

  test("installed model shows 'Open in chat' link, not a delete button", async () => {
    renderModels();
    await waitFor(() =>
      expect(
        screen.getByText("Gemma 4 E2B (instruct)"),
      ).toBeInTheDocument(),
    );
    // The installed cell renders a link with title 'Open in chat'.
    const link = screen.getByTitle("Open in chat");
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("href")).toBe("/chat");
  });

  test("non-installed runtime cell shows download button with size", async () => {
    renderModels();
    await waitFor(() =>
      expect(
        screen.getByText("Qwen 3.5 4B (instruct)"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/download · 2\.7 GB/)).toBeInTheDocument();
  });
});
