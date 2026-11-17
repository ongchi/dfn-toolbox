// The flow of fehm in WebAssembly, on the mesh of a test workflow
// l_shape_north_east: the fehm input of the flow form, the output against
// the native binary of fehm, and the errors.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, expect, test } from "vitest";
import { flowSurfaces, surfacesWithPoints } from "../src/boundaryRoles";
import { defaultFlowState, FLOW_MESH_FILE, pressureOf } from "../src/flow/state";
import { flowTables, flowToLibraryToml } from "../src/flow/toml";
import { check_flow_input } from "../src/pkg/dfn_wasm.js";
import { compareOutputFolders, generateWorkflow, initWasm, runFlow, runNativeFehm, textBoundaries } from "./cases";

// The test workflow with the boundary arrays of the mesh surface, of the regions
// west_box, east_box and other_boxes, and of the boundary surfaces north and east
const WORKFLOW_NAME = "l_shape_north_east";

let mesh = "";

beforeAll(() => {
  initWasm();
  mesh = generateWorkflow(WORKFLOW_NAME).mesh;
});

/** The fehm input with these boundaries at their pressures (MPa) */
function flowToml(pressures: Record<string, number>): string {
  return flowToLibraryToml({ ...defaultFlowState(), pressures }, Object.keys(pressures));
}

const PRESSURES = { north: 10.1, east: 10.0 };

/** The mesh with one more boundary array, of zeros */
function meshWithEmptyArray(): string {
  const pointCount = Number(/NumberOfPoints="(\d+)"/.exec(mesh)?.[1]);
  const emptyArray = `<DataArray type="Int32" Name="boundary__empty" format="ascii">${"0 ".repeat(pointCount)}</DataArray>`;
  return mesh.replace("<PointData>", `<PointData>\n${emptyArray}`);
}

test("the surfaces with points are the boundary arrays with a value above 0", () => {
  expect(surfacesWithPoints(textBoundaries(meshWithEmptyArray()), ["north", "empty", "east", "nowhere"])).toEqual(["north", "east"]);
});

test("the TOML of the flow form is a valid input", () => {
  expect(check_flow_input(flowToml(PRESSURES), mesh)).toBeUndefined();
});

test("a surface with no pressure of its own has the default pressure", () => {
  expect(pressureOf(defaultFlowState(), "north")).toBe(10.0);
});

test("the workflow file has the pressures of the in-flow and out-flow surfaces only", () => {
  const state = { ...defaultFlowState(), pressures: { north: 10.1, east: 10.0, west: 9.0 } };
  const [root] = flowTables(state, { inflow: ["north"], outflow: ["east"] });
  expect(root.lines).toContain("pressure = { north = 10.1, east = 10.0 }");
});

test("the flow of the workflow file is a valid input", () => {
  const { flow, boundaries } = generateWorkflow(WORKFLOW_NAME).workflow;
  expect(check_flow_input(flowToLibraryToml(flow, flowSurfaces(boundaries)), mesh)).toBeUndefined();
});

test("the output files agree with the native binary of fehm", () => {
  const toml = flowToml(PRESSURES);
  const result = runFlow(toml, mesh);
  expect(result.error).toBeUndefined();

  const wasmDir = mkdtempSync(join(tmpdir(), "fehm-wasm-"));
  for (const name of result.file_names) {
    writeFileSync(join(wasmDir, name), result.file(name) ?? "");
  }
  expect(compareOutputFolders(runNativeFehm(toml, FLOW_MESH_FILE, mesh), wasmDir)).toBe("");
});

test("the in-flow and the out-flow are equal", () => {
  const result = runFlow(flowToml(PRESSURES), mesh);
  const [inflow, outflow] = result.boundary_flows;
  expect(result.boundary_names).toEqual(["north", "east"]);
  expect(inflow).toBeGreaterThan(0);
  expect(Math.abs(inflow + outflow)).toBeLessThan(1e-9 * inflow);
});

test("a boundary array with no point is an error", () => {
  const error = check_flow_input(flowToml({ empty: 10.0, north: 10.0 }), meshWithEmptyArray());
  expect([error?.kind, error?.field_values]).toEqual(["fehm.EmptyBoundary", ["empty"]]);
});

test("no boundary is an error", () => {
  expect(check_flow_input(flowToml({}), mesh)?.kind).toBe("fehm.NoBoundaryDefined");
});
