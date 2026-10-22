// Runs the generation (WebAssembly) in a Web Worker, so the page stays
// responsive. Messages: see `generationClient.ts`.
import init, { check_input, run_generation } from "./pkg/dfn_wasm.js";
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
    log: result.log,
    seed: result.seed.toString(),
    files: result.file_names.map((name: string): [string, string] => [name, result.file(name) ?? ""]),
    acceptedCount: result.accepted_count,
    finalCount: result.final_count,
    rejectedCount: result.rejected_count,
  });
  result.free();
}
