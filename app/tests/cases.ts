// Test cases of tests/data, read in Node, the WebAssembly module, and the
// native binaries of dfngen and fehm.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initSync, input_file_names } from "../src/pkg/dfn_wasm.js";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The library repository, a sibling folder of this project
export const dfngenDir = resolve(appDir, "../../dfngen-rs");
const fehmDir = resolve(appDir, "../../fehm-rs");
const dataDir = join(dfngenDir, "tests/data");
// Tolerance of the decimal numbers, as in the regression check of dfngen
const TOLERANCE = "1e-9";

export function initWasm(): void {
  const bytes = readFileSync(join(appDir, "src/pkg/dfn_wasm_bg.wasm"));
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

/** Runs the native binary of fehm (../fehm-rs/target/release/fehm); returns the output folder. */
export function runNativeFehm(toml: string, meshFileName: string, mesh: string): string {
  const binary = join(fehmDir, "target/release/fehm");
  if (!existsSync(binary)) {
    throw new Error(`${binary} is missing: run "cargo build --release" in ../fehm-rs`);
  }
  const inputDir = mkdtempSync(join(tmpdir(), "fehm-input-"));
  writeFileSync(join(inputDir, "flow.toml"), toml);
  writeFileSync(join(inputDir, meshFileName), mesh);
  const outputDir = mkdtempSync(join(tmpdir(), "fehm-"));
  execFileSync(binary, [join(inputDir, "flow.toml"), outputDir], { stdio: "ignore" });
  return outputDir;
}

/** Differences of two output folders (scripts/compare_output.py of dfngen); "" = none */
export function compareOutputFolders(expectedDir: string, actualDir: string): string {
  try {
    execFileSync("python3", [join(dfngenDir, "scripts/compare_output.py"), expectedDir, actualDir, TOLERANCE], {
      encoding: "utf8",
    });
    return "";
  } catch (error) {
    return String((error as { stdout?: string }).stdout ?? error);
  }
}
