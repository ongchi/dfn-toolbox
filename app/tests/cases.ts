// Test cases of dfngen-rs/tests/data and the workflow files of tests/data/workflows, read in
// Node, the WebAssembly module, and the native binaries of dfngen, fehm and
// dfntrans.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FLOW_MESH_FILE } from "../src/flow/state";
import { networkToLibraryToml } from "../src/form/toml";
import {
  FlowMesh,
  initSync,
  input_file_names,
  MeshStep,
  run_flow,
  run_generation,
  run_transport,
  type FlowResult,
  type TrajectoryDetail,
  type TransportResult,
} from "../src/pkg/dfn_wasm.js";
import type { MeshBoundary } from "../src/generationClient";
import { dataArrayValues } from "../src/inputFiles";
import type { FormState } from "../src/form/state";
import type { ReleasePoint, TransportState } from "../src/transport/state";
import { meshRegionNames } from "../src/inputFiles";
import { userFracturesToVtp } from "../src/userFractures";
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

/** The boundaries of a `dfn_mesh.vtu` text */
export function textBoundaries(meshText: string): MeshBoundary[] {
  return [...meshText.matchAll(/Name="boundary__([^"]+)"/g)].map(([, name]) => {
    const values = dataArrayValues(meshText, `boundary__${name}`) ?? [];
    const nodes = values.flatMap((value, point) => (value > 0 ? [point] : []));
    return [name, Uint32Array.from(nodes)];
  });
}

/** The coordinates of the points of a `dfn_mesh.vtu` text */
export function meshPoints(meshText: string): ReleasePoint[] {
  const numbers = /<Points>\s*<DataArray[^>]*>\s*([^<]*)/.exec(meshText)?.[1].trim().split(/\s+/).map(Number) ?? [];
  return Array.from({ length: numbers.length / 3 }, (_, point) => [
    numbers[3 * point],
    numbers[3 * point + 1],
    numbers[3 * point + 2],
  ]);
}

/**
 * Release points for the tests (the user clicks them in the app): at most
 * `count` points of the mesh on the in-flow surfaces, spread over their list
 */
export function inflowReleasePoints(meshText: string, inflow: string[], count = 3): ReleasePoint[] {
  const points = meshPoints(meshText);
  const nodes = textBoundaries(meshText)
    .filter(([name]) => inflow.includes(name))
    .flatMap(([, boundaryNodes]) => [...boundaryNodes]);
  const step = Math.max(1, Math.floor(nodes.length / count));
  return nodes
    .filter((_, index) => index % step === 0)
    .slice(0, count)
    .map((node) => points[node]);
}

/** A transport state with release points on the in-flow surfaces: the workflow files have none */
export function withInflowReleasePoints(state: TransportState, meshText: string, inflow: string[]): TransportState {
  return { ...state, seeding: { ...state.seeding, points: inflowReleasePoints(meshText, inflow) } };
}

/** `run_flow` on the mesh of a `dfn_mesh.vtu` text, with the output files */
export function runFlow(toml: string, meshText: string): FlowResult {
  return run_flow(toml, FlowMesh.from_text(meshText));
}

/** `run_transport` on the mesh of a `dfn_mesh.vtu` text, with the output files */
export function runTransport(
  toml: string,
  flowToml: string,
  meshText: string,
  seedIfZero: number,
  detail: TrajectoryDetail,
): TransportResult {
  return run_transport(toml, flowToml, FlowMesh.from_text(meshText), seedIfZero, detail);
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

// The predefined domain meshes of dfn-toolbox (../meshes): the `domain` of a workflow names one
const meshesDir = resolve(appDir, "../meshes");

export function meshPath(name: string): string {
  return join(meshesDir, name);
}

export function readMesh(name: string): string {
  return readFileSync(meshPath(name), "utf8");
}

/** The file names of the predefined domain meshes */
export const meshNames: string[] = readdirSync(meshesDir)
  .filter((fileName) => fileName.endsWith(".vtu"))
  .sort();

/** The polygon file of the user-defined fractures of a network; empty (no polygon) without them */
export function userFracturesFile(network: FormState): string {
  return userFracturesToVtp(network.userFractures, network, meshRegionNames(readMesh(network.domain)));
}

// The workflow files of the tests (tests/data/workflows)
const workflowsDir = join(appDir, "tests/data/workflows");

export const workflowNames: string[] = readdirSync(workflowsDir)
  .filter((fileName) => fileName.endsWith(".toml"))
  .map((fileName) => fileName.slice(0, -".toml".length))
  .sort();

/** The text of a workflow file of the tests */
export function readWorkflowFile(workflowName: string): string {
  return readFileSync(join(workflowsDir, `${workflowName}.toml`), "utf8");
}

/** A workflow of the tests and the triangle mesh of its network, in WebAssembly (needs `initWasm`). */
export function generateWorkflow(workflowName: string): { workflow: Workflow; mesh: string } {
  const workflow = tomlToWorkflow(readWorkflowFile(workflowName));
  const network = workflow.network;
  const result = run_generation(
    networkToLibraryToml(network, workflow.boundaries),
    readMesh(network.domain),
    userFracturesFile(network),
    1n,
    MeshStep.Make,
    () => {},
  );
  if (result.error !== undefined) {
    throw new Error(`the generation of ${workflowName} failed: ${result.error.message}`);
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
