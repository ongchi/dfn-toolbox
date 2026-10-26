// Runs the generation, the flow and the transport (WebAssembly) in a Web
// Worker, so the page stays responsive. Messages: see `generationClient.ts`.
import { toToolError, type ToolError } from "./errors";
import type { WorkerRequest, WorkerResponse } from "./generationClient";
import init, {
  run_flow,
  run_generation,
  run_transport,
  type ErrorReport,
} from "./pkg/dfn_wasm.js";

const PROGRESS_INTERVAL_MS = 50;

const ready = init();

function post(message: WorkerResponse): void {
  self.postMessage(message);
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

function handle(request: WorkerRequest): void {
  if (request.type === "runFlow") {
    const result = run_flow(request.toml, request.mesh);
    const flows: Float64Array = result.boundary_flows;
    post({
      type: "flowResult",
      error: toolError(result.error),
      files: result.file_names.map((name: string): [string, string] => [name, result.file(name) ?? ""]),
      boundaryFlows: result.boundary_names.map((name: string, index: number) => ({ name, massFlow: flows[index] })),
      newtonIterations: result.newton_iterations,
    });
    result.free();
    return;
  }
  if (request.type === "runTransport") {
    const result = run_transport(request.toml, request.flowToml, request.mesh, request.seedIfZero);
    post({
      type: "transportResult",
      error: toolError(result.error),
      seed: result.seed,
      files: result.file_names.map((name: string): [string, string] => [name, result.file(name) ?? ""]),
      particleCount: result.particle_count,
      exitCount: result.exit_count,
      inflowVolumeFlux: result.inflow_volume_flux,
      outflowVolumeFlux: result.outflow_volume_flux,
    });
    result.free();
    return;
  }

  let lastProgressTime = 0;
  const result = run_generation(
    request.toml,
    request.mesh,
    request.userFractures,
    request.seedIfZero,
    (acceptedCount: number, fraction: number) => {
      const now = performance.now();
      if (now - lastProgressTime >= PROGRESS_INTERVAL_MS || fraction >= 1) {
        lastProgressTime = now;
        post({ type: "progress", acceptedCount, fraction });
      }
    },
  );
  post({
    type: "result",
    error: toolError(result.error),
    seed: result.seed.toString(),
    files: result.file_names.map((name: string): [string, string] => [name, result.file(name) ?? ""]),
    acceptedCount: result.accepted_count,
    finalCount: result.final_count,
    rejectedCount: result.rejected_count,
  });
  result.free();
}
