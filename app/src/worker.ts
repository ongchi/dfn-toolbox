// Runs the generation, the flow and the transport (WebAssembly) in a Web
// Worker, so the page stays responsive. Messages: see `generationClient.ts`.
import init, {
  check_flow_input,
  check_input,
  check_transport_input,
  run_flow,
  run_generation,
  run_transport,
} from "./pkg/dfn_wasm.js";
import type { WorkerRequest, WorkerResponse } from "./generationClient";

const PROGRESS_INTERVAL_MS = 50;

const ready = init();

function post(message: WorkerResponse): void {
  self.postMessage(message);
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
  if (request.type === "check") {
    post({ type: "checked", error: check_input(request.toml, request.mesh, request.userFractures) ?? null });
    return;
  }
  if (request.type === "checkFlow") {
    post({ type: "checked", error: check_flow_input(request.toml, request.mesh) ?? null });
    return;
  }
  if (request.type === "runFlow") {
    const result = run_flow(request.toml, request.mesh);
    const flows: Float64Array = result.boundary_flows;
    post({
      type: "flowResult",
      error: result.error ?? null,
      files: result.file_names.map((name: string): [string, string] => [name, result.file(name) ?? ""]),
      boundaryFlows: result.boundary_names.map((name: string, index: number) => ({ name, massFlow: flows[index] })),
      newtonIterations: result.newton_iterations,
    });
    result.free();
    return;
  }
  if (request.type === "checkTransport") {
    post({
      type: "checked",
      error: check_transport_input(request.toml, request.flowToml, request.mesh) ?? null,
    });
    return;
  }
  if (request.type === "runTransport") {
    const result = run_transport(request.toml, request.flowToml, request.mesh, request.seedIfZero);
    post({
      type: "transportResult",
      error: result.error ?? null,
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
    error: result.error ?? null,
    seed: result.seed.toString(),
    files: result.file_names.map((name: string): [string, string] => [name, result.file(name) ?? ""]),
    acceptedCount: result.accepted_count,
    finalCount: result.final_count,
    rejectedCount: result.rejected_count,
  });
  result.free();
}
