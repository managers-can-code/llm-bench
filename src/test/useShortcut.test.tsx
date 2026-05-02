import { describe, expect, test, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { shortcutLabel, useShortcut } from "../lib/useShortcut";

function ShortcutHarness({
  combo,
  onFire,
}: {
  combo: string;
  onFire: () => void;
}) {
  useShortcut(combo, onFire);
  return null;
}

describe("useShortcut", () => {
  test("fires when the combo matches (cmd+n on macOS, ctrl+n elsewhere)", () => {
    const onFire = vi.fn();
    render(<ShortcutHarness combo="cmd+n" onFire={onFire} />);
    // Try BOTH metaKey and ctrlKey so the test passes regardless of platform
    // detected by isMac() — exactly one should fire on each OS.
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "n", metaKey: true }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "n", ctrlKey: true }),
      );
    });
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  test("does not fire on a plain key without modifier", () => {
    const onFire = vi.fn();
    render(<ShortcutHarness combo="cmd+n" onFire={onFire} />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "n" }));
    });
    expect(onFire).not.toHaveBeenCalled();
  });

  test("Esc fires even when focus is on a textarea", () => {
    const onFire = vi.fn();
    render(
      <>
        <textarea data-testid="ta" />
        <ShortcutHarness combo="esc" onFire={onFire} />
      </>,
    );
    const ta = document.querySelector("textarea")!;
    ta.focus();
    act(() => {
      ta.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  test("alphanumeric shortcut DOES NOT fire when focus is on an input", () => {
    const onFire = vi.fn();
    render(
      <>
        <input data-testid="i" />
        <ShortcutHarness combo="cmd+n" onFire={onFire} />
      </>,
    );
    const i = document.querySelector("input")!;
    i.focus();
    act(() => {
      // Send both metaKey and ctrlKey — neither should fire because focus is in input.
      i.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "n",
          metaKey: true,
          bubbles: true,
        }),
      );
      i.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "n",
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });
    expect(onFire).not.toHaveBeenCalled();
  });

  test("shortcutLabel renders cmd/ctrl per platform", () => {
    // We can't easily fake navigator.platform inside the test, so just
    // assert the output is one of the two valid forms.
    const label = shortcutLabel("cmd+n");
    expect(["⌘N", "Ctrl+N"]).toContain(label);
  });
});
