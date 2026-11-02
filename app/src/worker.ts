// Runs the generation, the flow and the transport (WebAssembly) in a Web
// Worker, so the page stays responsive. Messages: see `generationClient.ts`.
import { toToolError, type ToolError } from "./errors";
import type { FractureBatch, NetworkShapes, ShapeArrays, WorkerRequest, WorkerResponse } from "./generationClient";
import init, {
  mesh_generation,
  run_flow,
  resume_generation,
  run_generation,
  run_transport,
  MeshStep,
  RestartMode,
  TrajectoryDetail,
  type ErrorReport,
  type GenerationResult,
  type ViewShapes,
} from "./pkg/dfn_wasm.js";

const PROGRESS_INTERVAL_MS = 50;
// A stop of the worker loses the fractures after the last checkpoint
const CHECKPOINT_INTERVAL_MS = 5000;

const ready = init();

function post(message: WorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, { transfer });
}

/** Collects the accepted fractures between two progress messages */
class FractureCollector {
  private points: number[] = [];
  private vertexCounts: number[] = [];
  private families: number[] = [];

  add(vertices: Float64Array, family: number): void {
    for (const value of vertices) {
      this.points.push(value);
    }
    this.vertexCounts.push(vertices.length / 3);
    this.families.push(family);
  }

  /** The collected fractures; the collector is then empty */
  take(): FractureBatch {
    const batch = {
      points: Float64Array.from(this.points),
      vertexCounts: Int32Array.from(this.vertexCounts),
      families: Int32Array.from(this.families),
    };
    this.points = [];
    this.vertexCounts = [];
    this.families = [];
    return batch;
  }
}

/** The error of a result as a plain object; the WebAssembly object is freed */
function toolError(report: ErrorReport | undefined): ToolError | null {
  if (report === undefined) {
    return null;
  }
  const error = toToolError(report);
  report.free();
  return error;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  await ready;
  try {
    handle(event.data);
  } catch (error) {
    // A panic of the WebAssembly module: a bug, not a bad input
    post({ type: "crashed", message: `internal error of dfngen: ${String(error)}` });
  }
};

/** The arrays of a layer of the view; the WebAssembly object is freed */
function shapeArrays(shapes: ViewShapes): ShapeArrays {
  const arrays: ShapeArrays = {
    points: shapes.points,
    vertexCounts: shapes.vertex_counts,
    connectivity: shapes.connectivity,
    cellArrays: shapes.cell_array_names.map((name: string): [string, Float64Array] => [
      name,
      shapes.cell_array(name) ?? new Float64Array(),
    ]),
  };
  shapes.free();
  return arrays;
}

function optionalShapeArrays(shapes: ViewShapes | undefined): ShapeArrays | null {
  return shapes === undefined ? null : shapeArrays(shapes);
}

/** The buffers of a layer of the view, for a message with no copy */
function shapeBuffers(shapes: ShapeArrays | null): ArrayBuffer[] {
  if (shapes === null) {
    return [];
  }
  const arrays = [shapes.points, shapes.vertexCounts, shapes.connectivity, ...shapes.cellArrays.map(([, values]) => values)];
  return arrays.map((array) => array.buffer as ArrayBuffer);
}

/** The layers of the view of a generation; null with an error */
function networkShapes(result: GenerationResult): NetworkShapes | null {
  const fractures = result.fracture_shapes;
  if (fractures === undefined) {
    return null;
  }
  return {
    fractures: shapeArrays(fractures),
    removed: optionalShapeArrays(result.removed_shapes),
    rejected: optionalShapeArrays(result.rejected_shapes),
    mesh: optionalShapeArrays(result.mesh_shapes),
  };
}

/** Posts the result of a generation; the WebAssembly object is freed */
function postGenerationResult(result: GenerationResult): void {
  const shapes = networkShapes(result);
  const buffers = [shapes?.fractures ?? null, shapes?.removed ?? null, shapes?.rejected ?? null, shapes?.mesh ?? null].flatMap(shapeBuffers);
  post(
    {
      type: "result",
      error: toolError(result.error),
      seed: result.seed.toString(),
      files: result.file_names.map((name: string): [string, string] => [name, result.file(name) ?? ""]),
      acceptedCount: result.accepted_count,
      finalCount: result.final_count,
      rejectedCount: result.rejected_count,
      isWithoutConnectingCluster: result.is_without_connecting_cluster,
      shapes,
    },
    buffers,
  );
  result.free();
}

function handle(request: WorkerRequest): void {
  if (request.type === "runMeshing") {
    postGenerationResult(
      mesh_generation(
        request.network.toml,
        request.current.toml,
        request.network.mesh,
        request.network.userFractures,
        request.current.userFractures,
        BigInt(request.seed),
        request.checkpoint ?? undefined,
      ),
    );
    return;
  }
  if (request.type === "runFlow") {
    const result = run_flow(request.toml, request.mesh);
    const flows: Float64Array = result.boundary_flows;
    const pressures: Float64Array = result.pressures;
    const darcyVelocities: Float64Array = result.darcy_velocities;
    post(
      {
        type: "flowResult",
        error: toolError(result.error),
        files: result.file_names.map((name: string): [string, string] => [name, result.file(name) ?? ""]),
        boundaryFlows: result.boundary_names.map((name: string, index: number) => ({ name, massFlow: flows[index] })),
        newtonIterations: result.newton_iterations,
        pressures,
        darcyVelocities,
      },
      [pressures.buffer as ArrayBuffer, darcyVelocities.buffer as ArrayBuffer],
    );
    result.free();
    return;
  }
  if (request.type === "runTransport") {
    const result = run_transport(request.toml, request.flowToml, request.mesh, request.seedIfZero, TrajectoryDetail.View);
    const pathPoints: Float64Array = result.path_points;
    const pathVelocities: Float64Array = result.path_velocities;
    const pathPointCounts: Uint32Array = result.path_point_counts;
    const sectorNodes: Uint32Array = result.sector_nodes;
    const sectorVelocities: Float64Array = result.sector_velocities;
    post(
      {
        type: "transportResult",
        error: toolError(result.error),
        seed: result.seed,
        files: result.file_names.map((name: string): [string, string] => [name, result.file(name) ?? ""]),
        particleCount: result.particle_count,
        exitCount: result.exit_count,
        inflowVolumeFlux: result.inflow_volume_flux,
        outflowVolumeFlux: result.outflow_volume_flux,
        pathPoints,
        pathVelocities,
        pathPointCounts,
        sectorNodes,
        sectorVelocities,
      },
      [pathPoints, pathVelocities, pathPointCounts, sectorNodes, sectorVelocities].map((array) => array.buffer as ArrayBuffer),
    );
    result.free();
    return;
  }

  let lastProgressTime = 0;
  let lastCheckpointTime = performance.now();
  const fractures = new FractureCollector();
  /** Returns true to ask for a checkpoint after the fracture */
  const onProgress = (acceptedCount: number, fraction: number, vertices: Float64Array, family: number): boolean => {
    fractures.add(vertices, family);
    const now = performance.now();
    // The last checkpoint has all of the insertion: a stop during the mesh keeps the fractures
    const isCheckpointDue = now - lastCheckpointTime >= CHECKPOINT_INTERVAL_MS || fraction >= 1;
    // The page gets all fractures of a checkpoint before it
    if (now - lastProgressTime >= PROGRESS_INTERVAL_MS || isCheckpointDue) {
      lastProgressTime = now;
      const batch = fractures.take();
      post({ type: "progress", acceptedCount, fraction, fractures: batch }, [
        batch.points.buffer,
        batch.vertexCounts.buffer,
        batch.families.buffer,
      ]);
    }
    if (isCheckpointDue) {
      lastCheckpointTime = now;
    }
    return isCheckpointDue;
  };
  const onCheckpoint = (checkpoint: Uint8Array, acceptedCount: number) => {
    post({ type: "checkpoint", checkpoint, acceptedCount }, [checkpoint.buffer]);
  };
  postGenerationResult(
    request.restart === null
      ? run_generation(
          request.toml,
          request.mesh,
          request.userFractures,
          request.seedIfZero,
          MeshStep.Skip,
          onProgress,
          onCheckpoint,
        )
      : resume_generation(
          request.toml,
          request.mesh,
          request.userFractures,
          request.restart.checkpoint,
          request.restart.mode === "continue" ? RestartMode.Continue : RestartMode.Finish,
          MeshStep.Skip,
          onProgress,
          onCheckpoint,
        ),
  );
}
