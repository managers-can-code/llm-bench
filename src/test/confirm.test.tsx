import { describe, expect, test, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmProvider, useConfirm } from "../lib/confirm";

function ConfirmButton({
  onResult,
  destructive,
}: {
  onResult: (v: boolean) => void;
  destructive?: boolean;
}) {
  const { confirm } = useConfirm();
  return (
    <button
      onClick={async () => {
        const r = await confirm({
          title: "Delete?",
          message: "This cannot be undone.",
          destructive,
        });
        onResult(r);
      }}
    >
      ask
    </button>
  );
}

describe("Confirm primitive", () => {
  test("clicking Confirm resolves true", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <ConfirmButton onResult={onResult} />
      </ConfirmProvider>,
    );
    await user.click(screen.getByText("ask"));
    expect(screen.getByText("Delete?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onResult).toHaveBeenCalledWith(true);
    expect(screen.queryByText("Delete?")).not.toBeInTheDocument();
  });

  test("clicking Cancel resolves false", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <ConfirmButton onResult={onResult} />
      </ConfirmProvider>,
    );
    await user.click(screen.getByText("ask"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onResult).toHaveBeenCalledWith(false);
  });

  test("destructive confirm renders red button + warning icon", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    const { container } = render(
      <ConfirmProvider>
        <ConfirmButton onResult={onResult} destructive />
      </ConfirmProvider>,
    );
    await user.click(screen.getByText("ask"));
    const confirmBtn = screen.getByRole("button", { name: "Confirm" });
    expect(confirmBtn.className).toMatch(/red/);
    // The dialog also renders an AlertTriangle SVG; presence is enough.
    expect(container.querySelector("svg")).toBeTruthy();
  });

  test("Esc closes the dialog and resolves false", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <ConfirmButton onResult={onResult} />
      </ConfirmProvider>,
    );
    await user.click(screen.getByText("ask"));
    expect(screen.getByText("Delete?")).toBeInTheDocument();
    // Esc keydown on window — useShortcut listens at window level.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(screen.queryByText("Delete?")).not.toBeInTheDocument();
    expect(onResult).toHaveBeenCalledWith(false);
  });
});
