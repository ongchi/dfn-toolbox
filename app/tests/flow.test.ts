// The flow of fehm in WebAssembly, on the mesh of a generation: the TOML of
// the flow form, the output against the native binary of fehm, and the errors.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, expect, test } from "vitest";
import { triangleGridToPolyData } from "../src/flow/polyData";
import { defaultFlowState, FLOW_MESH_FILE, meshBoundaryNames, updateBoundaries, type FlowState } from "../src/flow/state";
import { flowStateToToml } from "../src/flow/toml";
import { check_flow_input, run_flow, run_generation } from "../src/pkg/dfn_wasm.js";
import { compareOutputFolders, initWasm, readCase, runNativeFehm } from "./cases";

// The case with boundary arrays: the mesh surface, and the regions south and north
const CASE_NAME = "mesh_regions";

let mesh = "";

beforeAll(() => {
  initWasm();
  const files = readCase(CASE_NAME);
  const result = run_generation(files.toml, files.mesh, files.userFractures, 1n, () => {});
  mesh = result.file(FLOW_MESH_FILE) ?? "";
});

/** The flow state with the given boundaries used, at their pressures (MPa) */
function flowState(pressures: Record<string, number>): FlowState {
  const state = defaultFlowState();
  updateBoundaries(state, meshBoundaryNames(mesh));
  for (const boundary of state.boundaries) {
    boundary.isUsed = boundary.name in pressures;
    boundary.pressure = pressures[boundary.name] ?? boundary.pressure;
  }
  return state;
}

const PRESSURES = { mesh_surface: 10.1, north: 10.0 };

test("the boundaries of the mesh are its boundary arrays", () => {
  expect(meshBoundaryNames(mesh)).toEqual(["mesh_surface", "south", "north"]);
});

test("the TOML of the flow form is a valid input", () => {
  expect(check_flow_input(flowStateToToml(flowState(PRESSURES)), mesh)).toBeUndefined();
});

test("a new mesh keeps the values of the boundaries with the same name", () => {
  const state = flowState(PRESSURES);
  updateBoundaries(state, ["north", "east"]);
  expect(state.boundaries).toEqual([
    { name: "north", isUsed: true, pressure: 10.0 },
    { name: "east", isUsed: false, pressure: 10.0 },
  ]);
});

test("the output files agree with the native binary of fehm", () => {
  const toml = flowStateToToml(flowState(PRESSURES));
  const result = run_flow(toml, mesh);
  expect(result.error).toBeUndefined();

  const wasmDir = mkdtempSync(join(tmpdir(), "fehm-wasm-"));
  for (const name of result.file_names) {
    writeFileSync(join(wasmDir, name), result.file(name) ?? "");
  }
  expect(compareOutputFolders(runNativeFehm(toml, FLOW_MESH_FILE, mesh), wasmDir)).toBe("");
});

test("the in-flow and the out-flow are equal", () => {
  const result = run_flow(flowStateToToml(flowState(PRESSURES)), mesh);
  const [inflow, outflow] = result.boundary_flows;
  expect(result.boundary_names).toEqual(["mesh_surface", "north"]);
  expect(inflow).toBeGreaterThan(0);
  expect(Math.abs(inflow + outflow)).toBeLessThan(1e-9 * inflow);
});

test("a boundary array with no point is an error", () => {
  const error = check_flow_input(flowStateToToml(flowState({ south: 10.0, north: 10.0 })), mesh);
  expect(error).toMatch(/boundary "south": the array boundary__south has no point/);
});

test("no boundary is an error", () => {
  expect(check_flow_input(flowStateToToml(flowState({})), mesh)).toMatch(/there is no \[\[boundary\]\]/);
});

test("the pressure file as PolyData has the triangles and the pressure", () => {
  const result = run_flow(flowStateToToml(flowState(PRESSURES)), mesh);
  const polyData = triangleGridToPolyData(result.file("pressure.vtu") ?? "");
  expect(polyData).toMatch(/<VTKFile type="PolyData"/);
  expect(polyData).toMatch(/<Piece NumberOfPoints="\d+" NumberOfVerts="0" NumberOfLines="0" NumberOfStrips="0" NumberOfPolys="\d+">/);
  expect(polyData).toMatch(/<Polys>/);
  expect(polyData).not.toMatch(/Name="types"/);
  expect(polyData).toMatch(/Name="pressure"/);
});
