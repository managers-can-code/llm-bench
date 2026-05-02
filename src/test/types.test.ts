import { describe, expect, test } from "vitest";
import {
  ALL_RUNTIMES,
  RUNTIME_LABELS,
  type RuntimeId,
} from "../lib/types";

describe("RuntimeId enumeration", () => {
  test("ALL_RUNTIMES contains exactly the three supported runtimes", () => {
    expect(ALL_RUNTIMES).toEqual(["llama_cpp", "litert_lm", "mlx"]);
  });

  test("RUNTIME_LABELS has a label for every RuntimeId", () => {
    for (const r of ALL_RUNTIMES) {
      expect(RUNTIME_LABELS[r]).toBeTruthy();
    }
  });

  test("RUNTIME_LABELS has no extra keys beyond ALL_RUNTIMES", () => {
    const labelKeys = Object.keys(RUNTIME_LABELS).sort() as RuntimeId[];
    const allKeys = [...ALL_RUNTIMES].sort();
    expect(labelKeys).toEqual(allKeys);
  });

  test("Wire strings match the Rust serde renames pinned in tests/runtimes/mod.rs", () => {
    // If these change, also update the corresponding Rust test
    // `runtime_id_wire_strings_are_stable` in src-tauri/src/runtimes/mod.rs.
    expect(ALL_RUNTIMES).toContain("llama_cpp");
    expect(ALL_RUNTIMES).toContain("litert_lm");
    expect(ALL_RUNTIMES).toContain("mlx");
  });
});
