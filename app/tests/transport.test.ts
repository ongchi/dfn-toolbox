// The particle tracking of dfntrans in WebAssembly, on the flow of the mesh of
// a generation: the TOML of the transport form, the output against the
// native binary of dfntrans, and the errors.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, expect, test } from "vitest";
import { defaultFlowState, FLOW_MESH_FILE, meshBoundaryNames, updateBoundaries } from "../src/flow/state";
import { flowStateToToml } from "../src/flow/toml";
import { check_transport_input, run_generation, run_transport } from "../src/pkg/dfn_wasm.js";
import {
  defaultTransportState,
  TRANSPORT_FLOW_FILE,
  updateTransportBoundaries,
  type BoundaryRole,
  type TransportState,
} from "../src/transport/state";
import { transportStateToToml } from "../src/transport/toml";
import { compareOutputFolders, initWasm, readCase, runNativeDfntrans } from "./cases";

// The case with boundary arrays: the mesh surface, and the regions south and north
const CASE_NAME = "mesh_regions";

let mesh = "";
let flowToml = "";

beforeAll(() => {
  initWasm();
  const files = readCase(CASE_NAME);
  const result = run_generation(files.toml, files.mesh, files.userFractures, 1n, () => {});
  mesh = result.file(FLOW_MESH_FILE) ?? "";

  // Flow from north to the mesh surface
  const flowState = defaultFlowState();
  updateBoundaries(flowState, meshBoundaryNames(mesh));
  const pressures: Record<string, number> = { north: 10.1, mesh_surface: 10.0 };
  for (const boundary of flowState.boundaries) {
    boundary.isUsed = boundary.name in pressures;
    boundary.pressure = pressures[boundary.name] ?? boundary.pressure;
  }
  flowToml = flowStateToToml(flowState);
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

const ROLES: Record<string, BoundaryRole> = { north: "inflow", mesh_surface: "outflow" };

test("the TOML of the transport form is a valid input", () => {
  expect(check_transport_input(transportStateToToml(transportState(ROLES)), flowToml, mesh)).toBeUndefined();
});

test("a new mesh keeps the roles of the boundaries with the same name", () => {
  const state = transportState(ROLES);
  updateTransportBoundaries(state, ["north", "east"]);
  expect(state.boundaries).toEqual([
    { name: "north", role: "inflow" },
    { name: "east", role: "none" },
  ]);
});

// The times add up the rounding differences of wasm and native over
// thousands of time steps (up to 6e-7 relative). The integers (particles,
// time steps, fractures, points of each path) are equal: the paths are the same.
const TRANSPORT_TOLERANCE = "1e-5";

test("the output files agree with the native binary of dfntrans", () => {
  const state = transportState(ROLES);
  state.controlSurfaces.shape = "plane";
  state.controlSurfaces.axis = "y";
  state.hasTrajectories = true;
  const toml = transportStateToToml(state);
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
  const result = run_transport(transportStateToToml(transportState(ROLES)), flowToml, mesh, 1);
  expect(result.particle_count).toBeGreaterThan(0);
  expect(result.exit_count).toBeGreaterThan(0);
  expect(result.inflow_volume_flux).toBeGreaterThan(0);
});

test("seed 0 uses the seed of the page", () => {
  const state = transportState(ROLES);
  state.seed = 0;
  expect(run_transport(transportStateToToml(state), flowToml, mesh, 77).seed).toBe(77);
});

test("no in-flow boundary is an error", () => {
  const error = check_transport_input(transportStateToToml(transportState({ mesh_surface: "outflow" })), flowToml, mesh);
  expect(error).toMatch(/inflow and outflow must each name at least one boundary/);
});

test("an unknown boundary is an error of the run", () => {
  const toml = transportStateToToml(transportState(ROLES)).replace('inflow = ["north"]', 'inflow = ["east"]');
  expect(run_transport(toml, flowToml, mesh, 1).error).toMatch(/no point data array boundary__east/);
});
