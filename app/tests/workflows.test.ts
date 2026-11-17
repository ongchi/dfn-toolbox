// The workflow files of tests/data/workflows, and the default forms on each
// predefined mesh (the start of the page), in WebAssembly: each one runs the
// full workflow (network, flow and transport).
import { existsSync } from "node:fs";
import { beforeAll, describe, expect, test } from "vitest";
import { domainBoundarySurfaceNames } from "../src/boundarySurfaces";
import { flowSurfaces, surfacesWithPoints } from "../src/boundaryRoles";
import { FLOW_MESH_FILE } from "../src/flow/state";
import { flowToLibraryToml } from "../src/flow/toml";
import { networkToLibraryToml } from "../src/form/toml";
import { MeshStep, run_generation, TrajectoryDetail, type FlowResult, type TransportResult } from "../src/pkg/dfn_wasm.js";
import { transportToLibraryToml } from "../src/transport/toml";
import { defaultWorkflow, tomlToWorkflow, workflowToToml, type Workflow } from "../src/workflow";
import {
  initWasm,
  meshNames,
  meshPath,
  readMesh,
  readWorkflowFile,
  runFlow,
  runTransport,
  textBoundaries,
  userFracturesFile,
  withInflowReleasePoints,
  workflowNames,
} from "./cases";

// Milliseconds: the network, the flow and the transport of a workflow
const WORKFLOW_TIMEOUT = 60000;

interface WorkflowRun {
  /** The in-flow and out-flow surfaces with a point in the triangle mesh */
  surfacesInMesh: string[];
  flow: FlowResult;
  transport: TransportResult;
}

/** The network, the flow and the transport of a workflow, with release points on the in-flow surfaces */
function runWorkflow(workflow: Workflow): WorkflowRun {
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
  const surfacesInMesh = surfacesWithPoints(textBoundaries(mesh), flowSurfaces(roles));

  const flowToml = flowToLibraryToml(workflow.flow, surfacesInMesh);
  const flow = runFlow(flowToml, mesh);

  const boundaries = {
    inflow: surfacesWithPoints(textBoundaries(mesh), roles.inflow),
    outflow: surfacesWithPoints(textBoundaries(mesh), roles.outflow),
  };
  const transportState = withInflowReleasePoints(workflow.transport, mesh, boundaries.inflow);
  const transport = runTransport(transportToLibraryToml(transportState, boundaries), flowToml, mesh, 1, TrajectoryDetail.Full);
  return { surfacesInMesh, flow, transport };
}

/** The checks of a full workflow: a path from the in-flow to the out-flow surfaces */
function testFullWorkflow(getWorkflow: () => Workflow, getRun: () => WorkflowRun): void {
  test("the mesh has a point on each in-flow and out-flow surface", () => {
    expect(getRun().surfacesInMesh).toEqual(flowSurfaces(getWorkflow().boundaries));
  });

  test("the in-flow is equal to the out-flow", () => {
    const { flow } = getRun();
    expect(flow.error).toBeUndefined();
    const inflow = Math.max(...flow.boundary_flows);
    const netFlow = flow.boundary_flows.reduce((sum, massFlow) => sum + massFlow, 0);
    expect(inflow).toBeGreaterThan(0);
    expect(Math.abs(netFlow)).toBeLessThan(1e-9 * inflow);
  });

  test("particles exit through the out-flow boundary", () => {
    const { transport } = getRun();
    expect(transport.error).toBeUndefined();
    expect(transport.exit_count).toBeGreaterThan(0);
  });
}

beforeAll(() => {
  initWasm();
});

test("there are workflow files", () => {
  expect(workflowNames.length).toBeGreaterThan(0);
});

describe.each(workflowNames)("%s", (workflowName) => {
  let workflow: Workflow;
  let run: WorkflowRun;

  beforeAll(() => {
    workflow = tomlToWorkflow(readWorkflowFile(workflowName));
    run = runWorkflow(workflow);
  }, WORKFLOW_TIMEOUT);

  testFullWorkflow(() => workflow, () => run);

  test("the domain is a predefined mesh", () => {
    expect(existsSync(meshPath(workflow.network.domain))).toBe(true);
  });

  test("the workflow file is read again into the same state", () => {
    const original = tomlToWorkflow(readWorkflowFile(workflowName));
    expect(tomlToWorkflow(workflowToToml(original))).toEqual(original);
  });
});

describe.each(meshNames)("default forms on %s", (meshName) => {
  let workflow: Workflow;
  let run: WorkflowRun;

  beforeAll(() => {
    workflow = defaultWorkflow(meshName, domainBoundarySurfaceNames(readMesh(meshName)));
    run = runWorkflow(workflow);
  }, WORKFLOW_TIMEOUT);

  testFullWorkflow(() => workflow, () => run);
});
