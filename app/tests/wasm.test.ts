// The WebAssembly module gives the same output files as the native binary.
//
// The math functions of wasm32 (libm) and of the native platform can round
// differently, thus the decimal numbers are compared with the tolerance of
// the regression check (scripts/compare_output.py).
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { check_input, run_generation } from "../src/pkg/dfngen_wasm.js";
import { caseNames, initWasm, readCase, repoDir, runNativeBinary } from "./cases";

const TOLERANCE = "1e-9";

beforeAll(initWasm);

function compareOutputFolders(nativeDir: string, wasmDir: string): string {
  try {
    execFileSync("python3", [join(repoDir, "scripts/compare_output.py"), nativeDir, wasmDir, TOLERANCE], {
      encoding: "utf8",
    });
    return "";
  } catch (error) {
    return String((error as { stdout?: string }).stdout ?? error);
  }
}

describe.each(caseNames)("case %s", (caseName) => {
  test("output files agree with the native binary", () => {
    const files = readCase(caseName);
    const result = run_generation(files.toml, files.mesh, files.userFractures, 1n, () => {});
    expect(result.error).toBeUndefined();

    const wasmDir = mkdtempSync(join(tmpdir(), `dfngen-wasm-${caseName}-`));
    for (const name of result.file_names) {
      writeFileSync(join(wasmDir, name), result.file(name) ?? "");
    }
    expect(compareOutputFolders(runNativeBinary(caseName), wasmDir)).toBe("");
  });
});

test("bad input gives the error message of the library", () => {
  const files = readCase("base");
  const toml = files.toml.replace("seed = 12345", "seed = 12345\nsede = 1");
  expect(check_input(toml, files.mesh, files.userFractures)).toMatch(/unknown field `sede`/);
});

test("progress is reported", () => {
  const files = readCase("base");
  const fractions: number[] = [];
  run_generation(files.toml, files.mesh, files.userFractures, 1n, (_count: number, fraction: number) => {
    fractions.push(fraction);
  });
  expect(fractions.at(-1)).toBe(1);
});
