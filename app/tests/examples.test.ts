// The workflow examples of ../examples in WebAssembly: each one is a valid
// workflow file and runs the full workflow (network, flow and transport).
import { existsSync } from "node:fs";
import { beforeAll, describe, expect, test } from "vitest";
import { flowSurfaces, surfacesWithPoints } from "../src/boundaryRoles";
import { FLOW_MESH_FILE } from "../src/flow/state";
import { flowToLibraryToml } from "../src/flow/toml";
import { networkToLibraryToml } from "../src/form/toml";
import { MeshStep, run_flow, run_generation, run_transport, TrajectoryDetail, type FlowResult, type TransportResult } from "../src/pkg/dfn_wasm.js";
import { transportToLibraryToml } from "../src/transport/toml";
import { tomlToWorkflow, workflowToToml, type Workflow } from "../src/workflow";
import { exampleNames, initWasm, meshPath, readExample, readMesh, userFracturesFile } from "./cases";

// Milliseconds: the network, the flow and the transport of an example
const WORKFLOW_TIMEOUT = 60000;

beforeAll(() => {
  initWasm();
});

test("there are examples", () => {
  expect(exampleNames.length).toBeGreaterThan(0);
});

describe.each(exampleNames)("%s", (exampleName) => {
  let workflow: Workflow;
  let surfacesInMesh: string[] = [];
  let flow: FlowResult;
  let transport: TransportResult;

  beforeAll(() => {
    const example = readExample(exampleName);
    workflow = tomlToWorkflow(example.toml);
    const network = workflow.network;
    const roles = workflow.boundaries;
    const generation = run_generation(
      networkToLibraryToml(network, roles),
      readMesh(network.domain),
      userFracturesFile(network),
      1n,
      MeshStep.Make,
      () => {},
    );
    expect(generation.error).toBeUndefined();
    const mesh = generation.file(FLOW_MESH_FILE) ?? "";
    surfacesInMesh = surfacesWithPoints(mesh, flowSurfaces(roles));

    const flowToml = flowToLibraryToml(workflow.flow, surfacesInMesh);
    flow = run_flow(flowToml, mesh);

    const boundaries = {
      inflow: surfacesWithPoints(mesh, roles.inflow),
      outflow: surfacesWithPoints(mesh, roles.outflow),
    };
    transport = run_transport(transportToLibraryToml(workflow.transport, boundaries), flowToml, mesh, 1, TrajectoryDetail.Full);
  }, WORKFLOW_TIMEOUT);

  test("the domain is a predefined mesh", () => {
    expect(existsSync(meshPath(workflow.network.domain))).toBe(true);
  });

  test("the workflow file is read again into the same state", () => {
    const original = tomlToWorkflow(readExample(exampleName).toml);
    expect(tomlToWorkflow(workflowToToml(original))).toEqual(original);
  });

  test("the mesh has a point on each in-flow and out-flow surface", () => {
    expect(surfacesInMesh).toEqual(flowSurfaces(workflow.boundaries));
  });

  test("the in-flow is equal to the out-flow", () => {
    expect(flow.error).toBeUndefined();
    const inflow = Math.max(...flow.boundary_flows);
    const netFlow = flow.boundary_flows.reduce((sum, massFlow) => sum + massFlow, 0);
    expect(inflow).toBeGreaterThan(0);
    expect(Math.abs(netFlow)).toBeLessThan(1e-9 * inflow);
  });

  test("particles exit through the out-flow boundary", () => {
    expect(transport.error).toBeUndefined();
    expect(transport.exit_count).toBeGreaterThan(0);
  });
});
