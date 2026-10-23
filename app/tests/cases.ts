// Test cases of tests/data and the workflow examples of ../examples, read in
// Node, the WebAssembly module, and the native binaries of dfngen, fehm and
// dfntrans.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FLOW_MESH_FILE } from "../src/flow/state";
import { networkToLibraryToml } from "../src/form/toml";
import { initSync, input_file_names, run_generation } from "../src/pkg/dfn_wasm.js";
import { tomlToWorkflow, type Workflow } from "../src/workflow";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The library repository, a sibling folder of this project
export const dfngenDir = resolve(appDir, "../../dfngen-rs");
const fehmDir = resolve(appDir, "../../fehm-rs");
const dfntransDir = resolve(appDir, "../../dfntrans-rs");
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

// The workflow examples of dfn-web (../examples)
const examplesDir = resolve(appDir, "../examples");

export const exampleNames: string[] = readdirSync(examplesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(examplesDir, entry.name, `${entry.name}.toml`)))
  .map((entry) => entry.name)
  .sort();

export interface ExampleFiles {
  /** The workflow file */
  toml: string;
  /** The full path of a file which the workflow file names (relative to its folder) */
  path(name: string): string;
  readFile(name: string): string;
}

export function readExample(exampleName: string): ExampleFiles {
  const exampleDir = join(examplesDir, exampleName);
  const path = (name: string) => join(exampleDir, name);
  return {
    toml: readFileSync(path(`${exampleName}.toml`), "utf8"),
    path,
    readFile: (name) => readFileSync(path(name), "utf8"),
  };
}

/** The workflow of an example and the triangle mesh of its network, in WebAssembly (needs `initWasm`). */
export function generateExample(exampleName: string): { workflow: Workflow; mesh: string } {
  const example = readExample(exampleName);
  const workflow = tomlToWorkflow(example.toml);
  const network = workflow.network;
  const userFractures = network.userFractures === null ? undefined : example.readFile(network.userFractures);
  const result = run_generation(networkToLibraryToml(network), example.readFile(network.domain), userFractures, 1n, () => {});
  if (result.error !== undefined) {
    throw new Error(`the generation of ${exampleName} failed: ${result.error}`);
  }
  return { workflow, mesh: result.file(FLOW_MESH_FILE) ?? "" };
}

/** Runs the native binary of dfngen on an input file in a folder; returns the output folder. */
export function runNativeDfngen(tomlPath: string): string {
  const binary = join(dfngenDir, "target/release/dfngen");
  if (!existsSync(binary)) {
    throw new Error(`${binary} is missing: run "cargo build --release" in the repository`);
  }
  const outputDir = mkdtempSync(join(tmpdir(), "dfngen-"));
  execFileSync(binary, [tomlPath, outputDir], { stdio: "ignore" });
  return outputDir;
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

/**
 * Runs the native binary of dfntrans (../dfntrans-rs/target/release/dfntrans)
 * with its flow input and mesh; returns the output folder.
 */
export function runNativeDfntrans(
  transportToml: string,
  flow: { fileName: string; toml: string },
  mesh: { fileName: string; text: string },
): string {
  const binary = join(dfntransDir, "target/release/dfntrans");
  if (!existsSync(binary)) {
    throw new Error(`${binary} is missing: run "cargo build --release" in ../dfntrans-rs`);
  }
  const inputDir = mkdtempSync(join(tmpdir(), "dfntrans-input-"));
  writeFileSync(join(inputDir, "transport.toml"), transportToml);
  writeFileSync(join(inputDir, flow.fileName), flow.toml);
  writeFileSync(join(inputDir, mesh.fileName), mesh.text);
  const outputDir = mkdtempSync(join(tmpdir(), "dfntrans-"));
  execFileSync(binary, [join(inputDir, "transport.toml"), outputDir], { stdio: "ignore" });
  return outputDir;
}

/**
 * Differences of two output folders (scripts/compare_output.py of dfngen); "" = none.
 * The integers must be equal; `tolerance` is that of the decimal numbers (relative).
 */
export function compareOutputFolders(expectedDir: string, actualDir: string, tolerance = TOLERANCE): string {
  try {
    execFileSync("python3", [join(dfngenDir, "scripts/compare_output.py"), expectedDir, actualDir, tolerance], {
      encoding: "utf8",
    });
    return "";
  } catch (error) {
    return String((error as { stdout?: string }).stdout ?? error);
  }
}
