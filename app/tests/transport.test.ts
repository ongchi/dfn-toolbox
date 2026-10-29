// The particle tracking of dfntrans in WebAssembly, on the flow of the mesh of
// the example l_shape_north_east: the dfntrans input of the transport form,
// the output against the native binary of dfntrans, and the errors.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, expect, test } from "vitest";
import { flowSurfaces, type BoundaryRoles } from "../src/boundaryRoles";
import { pointCount } from "../src/flow/polyData";
import { FLOW_MESH_FILE } from "../src/flow/state";
import { flowToLibraryToml } from "../src/flow/toml";
import { check_transport_input, run_transport } from "../src/pkg/dfn_wasm.js";
import { defaultTransportState, TRANSPORT_FLOW_FILE, type TransportState } from "../src/transport/state";
import { transportTables, transportToLibraryToml } from "../src/transport/toml";
import { markVelocityAsVectors } from "../src/transport/trajectories";
import { nodeVelocityMagnitudes } from "../src/transport/velocities";
import { compareOutputFolders, generateExample, initWasm, runNativeDfntrans } from "./cases";

// The example with the boundary surfaces north and east
const EXAMPLE_NAME = "l_shape_north_east";

/** The roles of the example: from north to east */
const ROLES: BoundaryRoles = { inflow: ["north"], outflow: ["east"] };

let mesh = "";
let flowToml = "";

beforeAll(() => {
  initWasm();
  const example = generateExample(EXAMPLE_NAME);
  mesh = example.mesh;
  flowToml = flowToLibraryToml(example.workflow.flow, flowSurfaces(ROLES));
});

/** The transport state with one particle on each in-flow line (a few particles) */
function transportState(): TransportState {
  const state = defaultTransportState();
  state.seeding.method = "uniform_per_line";
  state.seeding.particlesPerLine = 1;
  return state;
}

/** The dfntrans input of a transport state and roles */
function transportToml(state = transportState(), roles = ROLES): string {
  return transportToLibraryToml(state, roles);
}

test("the TOML of the transport form is a valid input", () => {
  expect(check_transport_input(transportToml(), flowToml, mesh)).toBeUndefined();
});

test("the dfntrans input has the in-flow and out-flow surfaces of the roles", () => {
  expect(transportToml()).toMatch(/^inflow = \["north"\]\noutflow = \["east"\]$/m);
});

test("the workflow file has no in-flow and out-flow surfaces in the transport", () => {
  const [root] = transportTables(transportState());
  expect(root.lines.filter((line) => /^(inflow|outflow) =/.test(line))).toEqual([]);
});

test("the dfntrans input always has the trajectories and the velocities, and only the particles which exit", () => {
  expect(transportToml()).toContain("[output]\ntrajectories = true\nall_particles = false\nvelocities = true\n");
});

// The times add up the rounding differences of wasm and native over
// thousands of time steps (up to 6e-7 relative). The integers (particles,
// time steps, fractures, points of each path) are equal: the paths are the same.
const TRANSPORT_TOLERANCE = "1e-5";

test("the output files agree with the native binary of dfntrans", () => {
  const toml = transportToml();
  const result = run_transport(toml, flowToml, mesh, 1);
  expect(result.error).toBeUndefined();

  const wasmDir = mkdtempSync(join(tmpdir(), "dfntrans-wasm-"));
  for (const name of result.file_names) {
    writeFileSync(join(wasmDir, name), result.file(name) ?? "");
  }
  const nativeDir = runNativeDfntrans(
    toml,
    { fileName: TRANSPORT_FLOW_FILE, toml: flowToml },
    { fileName: FLOW_MESH_FILE, text: mesh },
  );
  expect(compareOutputFolders(nativeDir, wasmDir, TRANSPORT_TOLERANCE)).toBe("");
});

test("some particles exit through the out-flow boundary", () => {
  const result = run_transport(transportToml(), flowToml, mesh, 1);
  expect(result.particle_count).toBeGreaterThan(0);
  expect(result.exit_count).toBeGreaterThan(0);
  expect(result.inflow_volume_flux).toBeGreaterThan(0);
});

test("the trajectories have the velocity as the active vectors for the view", () => {
  const result = run_transport(transportToml(), flowToml, mesh, 1);
  const trajectories = markVelocityAsVectors(result.file("trajectories.vtp") ?? "");
  expect(trajectories).toMatch(/<PointData Vectors="velocity">[\s\S]*Name="velocity" NumberOfComponents="3"/);
});

test("seed 0 uses the seed of the page", () => {
  const state = transportState();
  state.seed = 0;
  expect(run_transport(transportToml(state), flowToml, mesh, 77).seed).toBe(77);
});

test("no in-flow boundary is an error", () => {
  const error = check_transport_input(transportToml(transportState(), { inflow: [], outflow: ["east"] }), flowToml, mesh);
  expect(error?.kind).toBe("dfntrans.InflowOutflowMissing");
});

test("an unknown boundary is an error of the run", () => {
  const toml = transportToml().replace('inflow = ["north"]', 'inflow = ["west"]');
  const error = run_transport(toml, flowToml, mesh, 1).error;
  expect([error?.kind, error?.field_values]).toEqual(["dfntrans.UnknownBoundary", ["west"]]);
});

test("the transport velocities give a speed at the points of the mesh", () => {
  const state = transportState();
  const result = run_transport(transportToml(state), flowToml, mesh, 1);
  expect(result.error).toBeUndefined();
  const speeds = nodeVelocityMagnitudes(result.file("velocities.vtp") ?? "", pointCount(mesh), state.timeUnit);
  expect(speeds.every((speed) => Number.isFinite(speed) && speed >= 0) && speeds.some((speed) => speed > 0)).toBe(true);
});
