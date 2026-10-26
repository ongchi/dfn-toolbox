// The flow of fehm in WebAssembly, on the mesh of the example
// l_shape_north_east: the fehm input of the flow form, the output against
// the native binary of fehm, and the errors.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, expect, test } from "vitest";
import { triangleGridToPolyData } from "../src/flow/polyData";
import { defaultFlowState, FLOW_MESH_FILE, meshBoundaryNames, updateBoundaries, type FlowState } from "../src/flow/state";
import { flowToLibraryToml } from "../src/flow/toml";
import { check_flow_input, run_flow } from "../src/pkg/dfn_wasm.js";
import { compareOutputFolders, generateExample, initWasm, runNativeFehm } from "./cases";

// The example with the boundary arrays of the mesh surface, of the regions
// west_box, east_box and other_boxes, and of the boundary surfaces north and east
const EXAMPLE_NAME = "l_shape_north_east";

let mesh = "";

beforeAll(() => {
  initWasm();
  mesh = generateExample(EXAMPLE_NAME).mesh;
});

/** The flow state with the given boundaries of the mesh used, at their pressures (MPa) */
function flowState(pressures: Record<string, number>, boundaryMesh = mesh): FlowState {
  const state = defaultFlowState();
  updateBoundaries(state, meshBoundaryNames(boundaryMesh));
  for (const boundary of state.boundaries) {
    boundary.isUsed = boundary.name in pressures;
    boundary.pressure = pressures[boundary.name] ?? boundary.pressure;
  }
  return state;
}

const PRESSURES = { north: 10.1, east: 10.0 };

test("the boundaries of the mesh are its boundary arrays", () => {
  expect(meshBoundaryNames(mesh)).toEqual(["mesh_surface", "west_box", "east_box", "other_boxes", "north", "east"]);
});

test("the TOML of the flow form is a valid input", () => {
  expect(check_flow_input(flowToLibraryToml(flowState(PRESSURES)), mesh)).toBeUndefined();
});

test("a new mesh keeps the values of the boundaries with the same name", () => {
  const state = flowState(PRESSURES);
  updateBoundaries(state, ["north", "west"]);
  expect(state.boundaries.slice(0, 2)).toEqual([
    { name: "north", isUsed: true, pressure: 10.1 },
    { name: "west", isUsed: false, pressure: 10.0 },
  ]);
});

test("a used boundary which is not in the new mesh stays at the end", () => {
  const state = flowState(PRESSURES);
  updateBoundaries(state, ["north", "west"]);
  expect(state.boundaries.map((boundary) => boundary.name)).toEqual(["north", "west", "east"]);
});

test("the flow of the workflow file is a valid input", () => {
  const { flow } = generateExample(EXAMPLE_NAME).workflow;
  updateBoundaries(flow, meshBoundaryNames(mesh));
  expect(check_flow_input(flowToLibraryToml(flow), mesh)).toBeUndefined();
});

test("the output files agree with the native binary of fehm", () => {
  const toml = flowToLibraryToml(flowState(PRESSURES));
  const result = run_flow(toml, mesh);
  expect(result.error).toBeUndefined();

  const wasmDir = mkdtempSync(join(tmpdir(), "fehm-wasm-"));
  for (const name of result.file_names) {
    writeFileSync(join(wasmDir, name), result.file(name) ?? "");
  }
  expect(compareOutputFolders(runNativeFehm(toml, FLOW_MESH_FILE, mesh), wasmDir)).toBe("");
});

test("the in-flow and the out-flow are equal", () => {
  const result = run_flow(flowToLibraryToml(flowState(PRESSURES)), mesh);
  const [inflow, outflow] = result.boundary_flows;
  expect(result.boundary_names).toEqual(["north", "east"]);
  expect(inflow).toBeGreaterThan(0);
  expect(Math.abs(inflow + outflow)).toBeLessThan(1e-9 * inflow);
});

test("a boundary array with no point is an error", () => {
  // The mesh with one more boundary array, of zeros
  const pointCount = Number(/NumberOfPoints="(\d+)"/.exec(mesh)?.[1]);
  const emptyArray = `<DataArray type="Int32" Name="boundary__empty" format="ascii">${"0 ".repeat(pointCount)}</DataArray>`;
  const meshWithEmptyArray = mesh.replace("<PointData>", `<PointData>\n${emptyArray}`);
  const toml = flowToLibraryToml(flowState({ empty: 10.0, north: 10.0 }, meshWithEmptyArray));
  const error = check_flow_input(toml, meshWithEmptyArray);
  expect(error).toMatch(/boundary "empty": the array boundary__empty has no point/);
});

test("no boundary is an error", () => {
  expect(check_flow_input(flowToLibraryToml(flowState({})), mesh)).toMatch(/there is no \[\[boundary\]\]/);
});

test("the pressure file as PolyData has the triangles and the pressure", () => {
  const result = run_flow(flowToLibraryToml(flowState(PRESSURES)), mesh);
  const polyData = triangleGridToPolyData(result.file("pressure.vtu") ?? "");
  expect(polyData).toMatch(/<VTKFile type="PolyData"/);
  expect(polyData).toMatch(/<Piece NumberOfPoints="\d+" NumberOfVerts="0" NumberOfLines="0" NumberOfStrips="0" NumberOfPolys="\d+">/);
  expect(polyData).toMatch(/<Polys>/);
  expect(polyData).not.toMatch(/Name="types"/);
  expect(polyData).toMatch(/Name="pressure"/);
});
