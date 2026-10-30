// Interface of the worker (generation of dfngen, flow of fehm and transport
// of dfntrans) for the page.
import type { ToolError } from "./errors";

export interface GenerationInput {
  toml: string;
  mesh: string;
  userFractures: string | undefined;
}

export interface FlowInput {
  /** The TOML of fehm */
  toml: string;
  /** The triangle mesh of the generation (dfn_mesh.vtu) */
  mesh: string;
}

export interface TransportInput {
  /** The TOML of dfntrans */
  toml: string;
  /** The TOML of fehm of the last flow run */
  flowToml: string;
  /** The triangle mesh of the generation (dfn_mesh.vtu) */
  mesh: string;
}

/** A restart of a stopped generation from its checkpoint */
export interface Restart {
  /** The bytes of the checkpoint */
  checkpoint: Uint8Array;
  /** "continue": insertion until the stop condition; "finish": the network of the fractures of the checkpoint */
  mode: "continue" | "finish";
}

export type WorkerRequest =
  | ({ type: "run"; seedIfZero: bigint; restart: Restart | null } & GenerationInput)
  | ({ type: "runFlow" } & FlowInput)
  | ({ type: "runTransport"; seedIfZero: number } & TransportInput);

export interface GenerationOutput {
  /** The error of the library; then there are no files */
  error: ToolError | null;
  /** Seed which the generation used (decimal digits) */
  seed: string;
  /** (name, text) of each output file */
  files: [string, string][];
  acceptedCount: number;
  finalCount: number;
  rejectedCount: number;
  /** No cluster connects an in-flow and an out-flow surface: the generation kept all clusters */
  isWithoutConnectingCluster: boolean;
}

export interface BoundaryFlow {
  name: string;
  /** Mass flow into the network (kg/s); negative for an out-flow */
  massFlow: number;
}

export interface FlowOutput {
  /** The error of the library; then there are no files */
  error: ToolError | null;
  /** (name, text) of each output file */
  files: [string, string][];
  boundaryFlows: BoundaryFlow[];
  newtonIterations: number;
}

export interface TransportOutput {
  /** The error of the library; then there are no files */
  error: ToolError | null;
  /** Seed which the run used */
  seed: number;
  /** (name, text) of each output file */
  files: [string, string][];
  particleCount: number;
  exitCount: number;
  /** m³/s */
  inflowVolumeFlux: number;
  /** m³/s */
  outflowVolumeFlux: number;
}

/** The fractures which the generation accepted since the last progress message */
export interface FractureBatch {
  /** x, y, z of each vertex of each fracture, in the coordinates of the mesh file */
  points: Float64Array;
  /** Number of vertices of each fracture */
  vertexCounts: Int32Array;
  /** Family number of each fracture (from 1) */
  families: Int32Array;
}

/** The first `count` fractures of the batches, in their order, as one batch */
export function firstFractures(batches: FractureBatch[], count: number): FractureBatch {
  const vertexCounts = Int32Array.from(batches.flatMap((batch) => [...batch.vertexCounts])).slice(0, count);
  const families = Int32Array.from(batches.flatMap((batch) => [...batch.families])).slice(0, count);
  const pointCount = vertexCounts.reduce((sum, vertexCount) => sum + vertexCount, 0);
  const points = new Float64Array(3 * pointCount);
  let offset = 0;
  for (const batch of batches) {
    const length = Math.min(batch.points.length, points.length - offset);
    points.set(batch.points.subarray(0, length), offset);
    offset += length;
  }
  return { points, vertexCounts, families };
}

/** The checkpoint of a generation after `acceptedCount` accepted stochastic fractures */
export interface GenerationCheckpoint {
  checkpoint: Uint8Array;
  acceptedCount: number;
}

export interface GenerationCallbacks {
  onProgress: (acceptedCount: number, fraction: number, fractures: FractureBatch) => void;
  /** The worker sent all accepted fractures until the checkpoint before it */
  onCheckpoint: (checkpoint: GenerationCheckpoint) => void;
}

/** A message of the worker during a run */
type WorkerNotice =
  | { type: "progress"; acceptedCount: number; fraction: number; fractures: FractureBatch }
  | ({ type: "checkpoint" } & GenerationCheckpoint);

export type WorkerResponse =
  | WorkerNotice
  /** The WebAssembly module failed (a panic); the worker must be replaced */
  | { type: "crashed"; message: string }
  | ({ type: "result" } & GenerationOutput)
  | ({ type: "flowResult" } & FlowOutput)
  | ({ type: "transportResult" } & TransportOutput);

export class CancelledError extends Error {
  constructor() {
    super("The generation was cancelled");
  }
}

/** One request at a time. `cancel` stops the worker and starts a new one. */
export class GenerationClient {
  private worker = GenerationClient.startWorker();
  private rejectPending: ((error: Error) => void) | null = null;

  private static startWorker(): Worker {
    return new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  }

  /** A generation; with `restart`, from the checkpoint of a stopped generation of the same input */
  async run(
    input: GenerationInput,
    callbacks: GenerationCallbacks,
    restart: Restart | null = null,
  ): Promise<GenerationOutput> {
    const seedIfZero = BigInt(1 + Math.floor(Math.random() * 2 ** 32));
    const response = await this.request({ type: "run", seedIfZero, restart, ...input }, (notice) => {
      if (notice.type === "progress") {
        callbacks.onProgress(notice.acceptedCount, notice.fraction, notice.fractures);
      } else {
        callbacks.onCheckpoint({ checkpoint: notice.checkpoint, acceptedCount: notice.acceptedCount });
      }
    });
    if (response.type !== "result") {
      throw new Error(`unexpected answer of the worker: ${response.type}`);
    }
    return response;
  }

  async runFlow(input: FlowInput): Promise<FlowOutput> {
    const response = await this.request({ type: "runFlow", ...input });
    if (response.type !== "flowResult") {
      throw new Error(`unexpected answer of the worker: ${response.type}`);
    }
    return response;
  }

  async runTransport(input: TransportInput): Promise<TransportOutput> {
    // dfntrans has a u32 seed
    const seedIfZero = 1 + Math.floor(Math.random() * (2 ** 32 - 1));
    const response = await this.request({ type: "runTransport", seedIfZero, ...input });
    if (response.type !== "transportResult") {
      throw new Error(`unexpected answer of the worker: ${response.type}`);
    }
    return response;
  }

  cancel(): void {
    this.restartWorker();
    this.rejectPending?.(new CancelledError());
    this.rejectPending = null;
  }

  private restartWorker(): void {
    this.worker.terminate();
    this.worker = GenerationClient.startWorker();
  }

  private request(
    message: WorkerRequest,
    onNotice?: (notice: WorkerNotice) => void,
  ): Promise<WorkerResponse> {
    if (this.rejectPending) {
      return Promise.reject(new Error("the worker is busy"));
    }
    return new Promise((resolve, reject) => {
      this.rejectPending = reject;
      this.worker.onerror = (event) => {
        this.rejectPending = null;
        reject(new Error(event.message || "the worker stopped with an error"));
      };
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const response = event.data;
        if (response.type === "progress" || response.type === "checkpoint") {
          onNotice?.(response);
          return;
        }
        this.rejectPending = null;
        if (response.type === "crashed") {
          this.restartWorker();
          reject(new Error(response.message));
          return;
        }
        resolve(response);
      };
      this.worker.postMessage(message);
    });
  }
}
