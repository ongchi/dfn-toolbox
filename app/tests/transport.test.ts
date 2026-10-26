// The particle tracking of dfntrans in WebAssembly, on the flow of the mesh of
// the example l_shape_north_east: the dfntrans input of the transport form,
// the output against the native binary of dfntrans, and the errors.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, expect, test } from "vitest";
import { pointCount } from "../src/flow/polyData";
import { FLOW_MESH_FILE, meshBoundaryNames, updateBoundaries } from "../src/flow/state";
import { flowToLibraryToml } from "../src/flow/toml";
import { check_transport_input, run_transport } from "../src/pkg/dfn_wasm.js";
import {
  defaultTransportState,
  TRANSPORT_FLOW_FILE,
  updateTransportBoundaries,
  type BoundaryRole,
  type TransportState,
} from "../src/transport/state";
import { transportToLibraryToml } from "../src/transport/toml";
import { markVelocityAsVectors } from "../src/transport/trajectories";
import { nodeVelocityMagnitudes } from "../src/transport/velocities";
import { compareOutputFolders, generateExample, initWasm, runNativeDfntrans } from "./cases";

// The example with the boundary arrays of the mesh surface, and of the boundary surfaces north and east
const EXAMPLE_NAME = "l_shape_north_east";

let mesh = "";
let flowToml = "";

beforeAll(() => {
  initWasm();
  const example = generateExample(EXAMPLE_NAME);
  mesh = example.mesh;

  // The flow of the example: from north to east
  const flowState = example.workflow.flow;
  updateBoundaries(flowState, meshBoundaryNames(mesh));
  flowToml = flowToLibraryToml(flowState);
});

/** The transport state with the given boundary roles; one particle on each in-flow line (a few particles) */
function transportState(roles: Record<string, BoundaryRole>): TransportState {
  const state = defaultTransportState();
  updateTransportBoundaries(state, meshBoundaryNames(mesh));
  for (const boundary of state.boundaries) {
    boundary.role = roles[boundary.name] ?? "none";
  }
  state.seeding.method = "uniform_per_line";
  state.seeding.particlesPerLine = 1;
  return state;
}

const ROLES: Record<string, BoundaryRole> = { north: "inflow", east: "outflow" };

test("the TOML of the transport form is a valid input", () => {
  expect(check_transport_input(transportToLibraryToml(transportState(ROLES)), flowToml, mesh)).toBeUndefined();
});

test("the dfntrans input always has the trajectories and the velocities, and only the particles which exit", () => {
  expect(transportToLibraryToml(transportState(ROLES))).toContain(
    "[output]\ntrajectories = true\nall_particles = false\nvelocities = true\n",
  );
});

test("a new mesh keeps the roles of the boundaries with the same name", () => {
  const state = transportState(ROLES);
  updateTransportBoundaries(state, ["north", "west"]);
  expect(state.boundaries.slice(0, 2)).toEqual([
    { name: "north", role: "inflow" },
    { name: "west", role: "none" },
  ]);
});

test("a used boundary which is not in the new mesh stays at the end", () => {
  const state = transportState(ROLES);
  updateTransportBoundaries(state, ["north", "west"]);
  expect(state.boundaries.map((boundary) => boundary.name)).toEqual(["north", "west", "east"]);
});

// The times add up the rounding differences of wasm and native over
// thousands of time steps (up to 6e-7 relative). The integers (particles,
// time steps, fractures, points of each path) are equal: the paths are the same.
const TRANSPORT_TOLERANCE = "1e-5";

test("the output files agree with the native binary of dfntrans", () => {
  const toml = transportToLibraryToml(transportState(ROLES));
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
  const result = run_transport(transportToLibraryToml(transportState(ROLES)), flowToml, mesh, 1);
  expect(result.particle_count).toBeGreaterThan(0);
  expect(result.exit_count).toBeGreaterThan(0);
  expect(result.inflow_volume_flux).toBeGreaterThan(0);
});

test("the trajectories have the velocity as the active vectors for the view", () => {
  const result = run_transport(transportToLibraryToml(transportState(ROLES)), flowToml, mesh, 1);
  const trajectories = markVelocityAsVectors(result.file("trajectories.vtp") ?? "");
  expect(trajectories).toMatch(/<PointData Vectors="velocity">[\s\S]*Name="velocity" NumberOfComponents="3"/);
});

test("seed 0 uses the seed of the page", () => {
  const state = transportState(ROLES);
  state.seed = 0;
  expect(run_transport(transportToLibraryToml(state), flowToml, mesh, 77).seed).toBe(77);
});

test("no in-flow boundary is an error", () => {
  const error = check_transport_input(transportToLibraryToml(transportState({ east: "outflow" })), flowToml, mesh);
  expect(error?.kind).toBe("dfntrans.InflowOutflowMissing");
});

test("an unknown boundary is an error of the run", () => {
  const toml = transportToLibraryToml(transportState(ROLES)).replace('inflow = ["north"]', 'inflow = ["west"]');
  const error = run_transport(toml, flowToml, mesh, 1).error;
  expect([error?.kind, error?.field_values]).toEqual(["dfntrans.UnknownBoundary", ["west"]]);
});

test("the transport velocities give a speed at the points of the mesh", () => {
  const state = transportState(ROLES);
  const result = run_transport(transportToLibraryToml(state), flowToml, mesh, 1);
  expect(result.error).toBeUndefined();
  const speeds = nodeVelocityMagnitudes(result.file("velocities.vtp") ?? "", pointCount(mesh), state.timeUnit);
  expect(speeds.every((speed) => Number.isFinite(speed) && speed >= 0) && speeds.some((speed) => speed > 0)).toBe(true);
});
