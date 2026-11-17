// The particle tracking of dfntrans in WebAssembly, on the flow of the mesh of
// the test workflow l_shape_north_east: the dfntrans input of the transport form,
// the output against the native binary of dfntrans, and the errors.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, expect, test } from "vitest";
import { flowSurfaces, type BoundaryRoles } from "../src/boundaryRoles";
import { FLOW_MESH_FILE } from "../src/flow/state";
import { flowToLibraryToml } from "../src/flow/toml";
import { check_transport_input, TrajectoryDetail } from "../src/pkg/dfn_wasm.js";
import { defaultTransportState, TRANSPORT_FLOW_FILE, type ReleasePoint, type TransportState } from "../src/transport/state";
import { parseToml, tablesToToml } from "../src/form/toml";
import { readTransport, transportTables, transportToLibraryToml } from "../src/transport/toml";
import { nodeVelocityMagnitudes } from "../src/transport/velocities";
import {
  compareOutputFolders,
  generateWorkflow,
  initWasm,
  meshPoints,
  runNativeDfntrans,
  runTransport,
  withInflowReleasePoints,
} from "./cases";

// The test workflow with the boundary surfaces north and east
const WORKFLOW_NAME = "l_shape_north_east";

/** The roles of the workflow: from north to east */
const ROLES: BoundaryRoles = { inflow: ["north"], outflow: ["east"] };

let mesh = "";
let flowToml = "";

beforeAll(() => {
  initWasm();
  const generated = generateWorkflow(WORKFLOW_NAME);
  mesh = generated.mesh;
  flowToml = flowToLibraryToml(generated.workflow.flow, flowSurfaces(ROLES));
});

/** The transport state with one particle at each of a few points on the in-flow surface */
function transportState(): TransportState {
  return withInflowReleasePoints(defaultTransportState(), mesh, ROLES.inflow);
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

test("the dfntrans input always has the trajectories and the velocities, also of the particles which do not exit", () => {
  expect(transportToml()).toContain("[output]\ntrajectories = true\nall_particles = true\nvelocities = true\n");
});

// The math functions are the same, but the flow solution is not exactly the
// same (within 1e-9 of flow.test.ts), and the times add up such differences
// over thousands of time steps. The integers (particles, time steps, fractures,
// points of each path) are equal: the paths are the same.
const TRANSPORT_TOLERANCE = "1e-5";

test("the output files agree with the native binary of dfntrans", () => {
  const toml = transportToml();
  const result = runTransport(toml, flowToml, mesh, 1, TrajectoryDetail.Full);
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
  const result = runTransport(transportToml(), flowToml, mesh, 1, TrajectoryDetail.Full);
  expect(result.particle_count).toBeGreaterThan(0);
  expect(result.exit_count).toBeGreaterThan(0);
  expect(result.inflow_volume_flux).toBeGreaterThan(0);
});

test("seed 0 uses the seed of the page", () => {
  const state = transportState();
  state.seed = 0;
  expect(runTransport(transportToml(state), flowToml, mesh, 77, TrajectoryDetail.Full).seed).toBe(77);
});

test("no in-flow boundary is an error", () => {
  const error = check_transport_input(transportToml(transportState(), { inflow: [], outflow: ["east"] }), flowToml, mesh);
  expect(error?.kind).toBe("dfntrans.InflowOutflowMissing");
});

test("an unknown boundary is an error of the run", () => {
  const toml = transportToml().replace('inflow = ["north"]', 'inflow = ["nowhere"]');
  const error = runTransport(toml, flowToml, mesh, 1, TrajectoryDetail.Full).error;
  expect([error?.kind, error?.field_values]).toEqual(["dfntrans.UnknownBoundary", ["nowhere"]]);
});

/** Number of points of a text of `trajectories.vtp` */
function trajectoryPointCount(vtpText: string): number {
  return Number(/NumberOfPoints="(\d+)"/.exec(vtpText)?.[1]);
}

test("the trajectories for the 3D view have far fewer points than those of the binary", () => {
  const full = runTransport(transportToml(), flowToml, mesh, 1, TrajectoryDetail.Full);
  const view = runTransport(transportToml(), flowToml, mesh, 1, TrajectoryDetail.View);
  expect(view.error).toBeUndefined();
  const fullPoints = trajectoryPointCount(full.file("trajectories.vtp") ?? "");
  const viewPoints = trajectoryPointCount(view.file("trajectories.vtp") ?? "");

  expect(viewPoints).toBeGreaterThan(0);
  expect(viewPoints).toBeLessThan(fullPoints / 10);
});

test("the transport velocities give a speed at the points of the mesh", () => {
  const state = transportState();
  const result = runTransport(transportToml(state), flowToml, mesh, 1, TrajectoryDetail.Full);
  expect(result.error).toBeUndefined();
  const pointCount = Number(mesh.match(/NumberOfPoints="(\d+)"/)?.[1]);
  const speeds = [...nodeVelocityMagnitudes(result.sector_nodes, result.sector_velocities, pointCount, state.timeUnit)];
  expect(speeds.every((speed) => Number.isFinite(speed) && speed >= 0) && speeds.some((speed) => speed > 0)).toBe(true);
});

/** The first point of the triangle mesh: it is on a fracture */
function firstMeshPoint(): ReleasePoint {
  return meshPoints(mesh)[0];
}

/** The transport state with particles at release points */
function pointState(points: ReleasePoint[]): TransportState {
  const state = defaultTransportState();
  state.seeding.points = points;
  state.seeding.particlesPerPoint = 2;
  return state;
}

test("the release points of the workflow file give the same state back", () => {
  const state = pointState([firstMeshPoint(), [1.5, -2.25, 1e-7]]);
  const problems: string[] = [];
  const read = readTransport(parseToml(tablesToToml(transportTables(state), "")), problems);
  expect([read, problems]).toEqual([state, []]);
});

test("the TOML of release points is a valid input", () => {
  expect(check_transport_input(transportToml(pointState([firstMeshPoint()])), flowToml, mesh)).toBeUndefined();
});

test("a release point on the mesh gives its particles", () => {
  const result = runTransport(transportToml(pointState([firstMeshPoint()])), flowToml, mesh, 1, TrajectoryDetail.View);
  expect([result.error, result.particle_count]).toEqual([undefined, 2]);
});

test("no release point is an error", () => {
  const error = check_transport_input(transportToml(pointState([])), flowToml, mesh);
  expect(error?.kind).toBe("dfntrans.NoSeedingPoints");
});
