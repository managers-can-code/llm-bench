import { describe, expect, test, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider, useToast } from "../lib/toast";

function PushButton({ kind, ttlMs }: { kind?: "info" | "success" | "error"; ttlMs?: number }) {
  const toast = useToast();
  return (
    <button onClick={() => toast.push("hello world", kind, ttlMs)}>push</button>
  );
}

describe("Toast primitive", () => {
  test("push renders a toast and auto-dismisses after the ttl", async () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <PushButton ttlMs={1000} />
      </ToastProvider>,
    );
    // Click is fine in fake-timer mode; userEvent setup defers timers but we
    // can dispatch a normal click via fireEvent here.
    act(() => {
      screen.getByText("push").click();
    });
    expect(screen.getByText("hello world")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText("hello world")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  test("manual dismiss via X button removes the toast immediately", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <PushButton ttlMs={60_000} />
      </ToastProvider>,
    );
    await user.click(screen.getByText("push"));
    expect(screen.getByText("hello world")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByText("hello world")).not.toBeInTheDocument();
  });

  test("stacks multiple toasts at once", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <PushButton ttlMs={60_000} />
      </ToastProvider>,
    );
    await user.click(screen.getByText("push"));
    await user.click(screen.getByText("push"));
    await user.click(screen.getByText("push"));
    expect(screen.getAllByText("hello world").length).toBe(3);
  });

  test("error kind applies the red palette class", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ToastProvider>
        <PushButton kind="error" ttlMs={60_000} />
      </ToastProvider>,
    );
    await user.click(screen.getByText("push"));
    // The toast container wraps the message with a className that includes red palette.
    const toast = container.querySelector('[role="status"]');
    expect(toast).toBeTruthy();
    expect(toast!.className).toMatch(/red/);
  });
});
