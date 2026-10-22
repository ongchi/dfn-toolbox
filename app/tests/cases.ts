// Test cases of tests/data, read in Node, and the WebAssembly module.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initSync, input_file_names } from "../src/pkg/dfngen_wasm.js";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The library repository, a sibling folder of this project
export const dfngenDir = resolve(appDir, "../../dfngen-rs");
const dataDir = join(dfngenDir, "tests/data");

export function initWasm(): void {
  const bytes = readFileSync(join(appDir, "src/pkg/dfngen_wasm_bg.wasm"));
  initSync({ module: bytes });
}

export interface CaseFiles {
  toml: string;
  mesh: string;
  userFractures: string | undefined;
}

export const caseNames: string[] = readdirSync(dataDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(dataDir, entry.name, `${entry.name}.toml`)))
  .map((entry) => entry.name)
  .sort();

export function caseTomlPath(caseName: string): string {
  return join(dataDir, caseName, `${caseName}.toml`);
}

/** Reads the TOML of a case and the files which it names (needs `initWasm`). */
export function readCase(caseName: string, toml?: string): CaseFiles {
  const caseDir = join(dataDir, caseName);
  const text = toml ?? readFileSync(caseTomlPath(caseName), "utf8");
  const names = input_file_names(text);
  return {
    toml: text,
    mesh: readFileSync(join(caseDir, names.domain), "utf8"),
    userFractures:
      names.user_fractures === undefined
        ? undefined
        : readFileSync(join(caseDir, names.user_fractures), "utf8"),
  };
}

/** Runs the native binary (target/release/dfngen) on a case; returns the output folder. */
export function runNativeBinary(caseName: string): string {
  const binary = join(dfngenDir, "target/release/dfngen");
  if (!existsSync(binary)) {
    throw new Error(`${binary} is missing: run "cargo build --release" in the repository`);
  }
  const outputDir = mkdtempSync(join(tmpdir(), `dfngen-${caseName}-`));
  execFileSync(binary, [caseTomlPath(caseName), outputDir], { stdio: "ignore" });
  return outputDir;
}
