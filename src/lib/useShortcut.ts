import { useEffect } from "react";

/**
 * Global keyboard shortcut hook.
 *
 * `combo` is a string like `"cmd+n"`, `"cmd+1"`, `"esc"`, `"cmd+enter"`.
 * On macOS `cmd` is the Command key; on Linux/Windows it falls back to `Ctrl`.
 * Use lowercase keys; modifiers are `cmd`, `shift`, `alt`. Multiple shortcuts
 * can be passed via the `useShortcuts` helper below.
 *
 * The handler is NOT fired when focus is inside an `<input>`, `<textarea>`,
 * or `[contenteditable]` — except for `cmd+enter` and `esc`, which are common
 * in those contexts.
 */
export function useShortcut(
  combo: string,
  handler: (e: KeyboardEvent) => void,
  deps: unknown[] = [],
) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (matchesCombo(e, combo)) {
        if (shouldSkipInInput(e, combo)) return;
        e.preventDefault();
        handler(e);
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function useShortcuts(
  bindings: Array<{
    combo: string;
    handler: (e: KeyboardEvent) => void;
  }>,
  deps: unknown[] = [],
) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      for (const b of bindings) {
        if (matchesCombo(e, b.combo)) {
          if (shouldSkipInInput(e, b.combo)) continue;
          e.preventDefault();
          b.handler(e);
          return;
        }
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

function matchesCombo(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split("+");
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);

  const wantCmd = modifiers.includes("cmd");
  const wantShift = modifiers.includes("shift");
  const wantAlt = modifiers.includes("alt");

  // Cmd on macOS = metaKey; elsewhere = ctrlKey.
  const cmdPressed = isMac() ? e.metaKey : e.ctrlKey;
  if (wantCmd !== cmdPressed) return false;
  if (wantShift !== e.shiftKey) return false;
  if (wantAlt !== e.altKey) return false;

  // Match by lowercase key.
  const k = (e.key || "").toLowerCase();
  if (key === "esc") return k === "escape";
  if (key === "enter") return k === "enter";
  if (key === ",") return k === ",";
  if (key === "/") return k === "/";
  return k === key;
}

function shouldSkipInInput(e: KeyboardEvent, combo: string): boolean {
  // Esc and Cmd+Enter should fire inside inputs (close dialog, send message).
  const lower = combo.toLowerCase();
  if (lower === "esc" || lower === "cmd+enter") return false;

  const target = e.target as HTMLElement | null;
  if (!target) return false;
  const tag = target.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || target.isContentEditable) {
    return true;
  }
  return false;
}

export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac/i.test(navigator.platform || navigator.userAgent || "");
}

/** Render a shortcut hint string for tooltips, e.g. "⌘N" / "Ctrl+N". */
export function shortcutLabel(combo: string): string {
  const parts = combo.split("+").map((p) => p.toLowerCase());
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  const cmdSym = isMac() ? "⌘" : "Ctrl+";
  const shiftSym = isMac() ? "⇧" : "Shift+";
  const altSym = isMac() ? "⌥" : "Alt+";
  const keySym =
    key === "esc"
      ? "Esc"
      : key === "enter"
        ? "↵"
        : key.length === 1
          ? key.toUpperCase()
          : key.charAt(0).toUpperCase() + key.slice(1);
  return (
    (mods.includes("cmd") ? cmdSym : "") +
    (mods.includes("shift") ? shiftSym : "") +
    (mods.includes("alt") ? altSym : "") +
    keySym
  );
}
