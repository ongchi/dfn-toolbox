// The arrays of the 3D view have the numbers of the output files, for each example.
import { beforeAll, describe, expect, test } from "vitest";
import { flowSurfaces, surfacesWithPoints } from "../src/boundaryRoles";
import { FLOW_MESH_FILE } from "../src/flow/state";
import { flowToLibraryToml } from "../src/flow/toml";
import { networkToLibraryToml } from "../src/form/toml";
import { dataArrayValues } from "../src/inputFiles";
import {
  FileOutput,
  FlowMesh,
  MeshStep,
  run_flow,
  run_generation,
  TrajectoryDetail,
  type FlowResult,
  type GenerationResult,
  type TransportResult,
  type ViewShapes,
} from "../src/pkg/dfn_wasm.js";
import { transportToLibraryToml } from "../src/transport/toml";
import { tomlToWorkflow } from "../src/workflow";
import { exampleNames, initWasm, readExample, readMesh, runFlow, runTransport, textBoundaries, userFracturesFile } from "./cases";

// Milliseconds: the network, the flow and the transport of an example
const WORKFLOW_TIMEOUT = 60000;

/** The numbers of <Points> of a VTK text */
function pointValues(text: string): number[] {
  const values = text.match(/<Points>\s*<DataArray[^>]*>([^<]*)<\/DataArray>/)?.[1] ?? "";
  return values.trim().split(/\s+/).filter((word) => word !== "").map(Number);
}

function fileArray(text: string, name: string): number[] {
  const values = dataArrayValues(text, name);
  if (values === null) {
    throw new Error(`the file has no array ${name}`);
  }
  return values;
}

function expectSameCells(shapes: ViewShapes, text: string): void {
  expect([...shapes.points]).toEqual(pointValues(text));
  expect([...shapes.connectivity]).toEqual(fileArray(text, "connectivity"));
  let end = 0;
  expect([...shapes.vertex_counts].map((count) => (end += count))).toEqual(fileArray(text, "offsets"));
}

function expectSameCellArrays(shapes: ViewShapes, text: string): void {
  expect(shapes.cell_array_names.length).toBeGreaterThan(0);
  for (const name of shapes.cell_array_names) {
    expect([...(shapes.cell_array(name) ?? [])], name).toEqual(fileArray(text, name));
  }
}

beforeAll(initWasm);

test("there are examples", () => {
  expect(exampleNames.length).toBeGreaterThan(0);
});

describe.each(exampleNames)("%s", (exampleName) => {
  let generation: GenerationResult;
  let flow: FlowResult;
  let transport: TransportResult;
  let flowToml: string;

  beforeAll(() => {
    const workflow = tomlToWorkflow(readExample(exampleName).toml);
    const network = workflow.network;
    const roles = workflow.boundaries;
    generation = run_generation(
      networkToLibraryToml(network, roles),
      readMesh(network.domain),
      userFracturesFile(network),
      1n,
      MeshStep.Make,
      () => {},
    );
    const mesh = generation.file(FLOW_MESH_FILE) ?? "";
    flowToml = flowToLibraryToml(workflow.flow, surfacesWithPoints(textBoundaries(mesh), flowSurfaces(roles)));
    flow = runFlow(flowToml, mesh);
    const boundaries = {
      inflow: surfacesWithPoints(textBoundaries(mesh), roles.inflow),
      outflow: surfacesWithPoints(textBoundaries(mesh), roles.outflow),
    };
    const transportToml = transportToLibraryToml(workflow.transport, boundaries);
    transport = runTransport(transportToml, flowToml, mesh, 1, TrajectoryDetail.View);
  }, WORKFLOW_TIMEOUT);

  test("the fractures are those of the file", () => {
    const shapes = generation.fracture_shapes;
    const text = generation.file("fractures.vtp") ?? "";
    expect(shapes).toBeDefined();
    expectSameCells(shapes as ViewShapes, text);
    expectSameCellArrays(shapes as ViewShapes, text);
  });

  test("the removed and rejected fractures are those of the files", () => {
    const layers: [ViewShapes | undefined, string][] = [
      [generation.removed_shapes, "fractures_removed.vtp"],
      [generation.rejected_shapes, "fractures_rejected.vtp"],
    ];
    for (const [shapes, name] of layers) {
      const text = generation.file(name);
      expect(shapes === undefined, name).toBe(text === undefined);
      if (shapes !== undefined) {
        expectSameCells(shapes, text ?? "");
      }
    }
  });

  test("the triangle mesh is that of the file", () => {
    const shapes = generation.mesh_shapes;
    const text = generation.file(FLOW_MESH_FILE) ?? "";
    expect(shapes).toBeDefined();
    expectSameCells(shapes as ViewShapes, text);
    expectSameCellArrays(shapes as ViewShapes, text);
  });

  test("the pressures and velocities are those of the file", () => {
    const text = flow.file("pressure.vtu") ?? "";
    expect([...flow.pressures]).toEqual(fileArray(text, "pressure"));
    expect([...flow.darcy_velocities]).toEqual(fileArray(text, "darcy_velocity"));
  });

  test("the paths are those of the file", () => {
    const text = transport.file("trajectories.vtp") ?? "";
    expect([...transport.path_points]).toEqual(pointValues(text));
    expect([...transport.path_velocities]).toEqual(fileArray(text, "velocity"));
    let end = 0;
    expect([...transport.path_point_counts].map((count) => (end += count))).toEqual(fileArray(text, "offsets"));
  });

  test("the mesh arrays give exactly the pressures of the mesh file", () => {
    const shapes = generation.mesh_shapes as ViewShapes;
    const cellArray = (name: string) => shapes.cell_array(name) ?? new Float64Array();
    const mesh = new FlowMesh(shapes.points, shapes.connectivity, cellArray("fracture_id"), cellArray("aperture"), cellArray("permeability"));
    for (const name of generation.mesh_boundary_names) {
      mesh.add_boundary(name, generation.mesh_boundary_nodes(name) ?? new Uint32Array());
    }
    const fromArrays = run_flow(flowToml, mesh, FileOutput.Skip);
    expect(fromArrays.error).toBeUndefined();
    expect(fromArrays.file_names).toEqual([]);
    expect([...fromArrays.pressures]).toEqual([...flow.pressures]);
    expect(generation.mesh_boundary_names.length).toBeGreaterThan(0);
  });

  test("the sector velocities are those of the file", () => {
    const text = transport.file("velocities.vtp") ?? "";
    expect([...transport.sector_nodes]).toEqual(fileArray(text, "node"));
    expect([...transport.sector_velocities]).toEqual(fileArray(text, "velocity"));
  });
});
