// Interface of the worker (generation of dfngen, flow of fehm and transport
// of dfntrans) for the page.

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

export type WorkerRequest =
  | ({ type: "check" } & GenerationInput)
  | ({ type: "run"; seedIfZero: bigint } & GenerationInput)
  | ({ type: "checkFlow" } & FlowInput)
  | ({ type: "runFlow" } & FlowInput)
  | ({ type: "checkTransport" } & TransportInput)
  | ({ type: "runTransport"; seedIfZero: number } & TransportInput);

export interface GenerationOutput {
  /** Error message; then there are no files */
  error: string | null;
  log: string;
  /** Seed which the generation used (decimal digits) */
  seed: string;
  /** (name, text) of each output file */
  files: [string, string][];
  acceptedCount: number;
  finalCount: number;
  rejectedCount: number;
}

export interface BoundaryFlow {
  name: string;
  /** Mass flow into the network (kg/s); negative for an out-flow */
  massFlow: number;
}

export interface FlowOutput {
  /** Error message; then there are no files */
  error: string | null;
  log: string;
  /** (name, text) of each output file */
  files: [string, string][];
  boundaryFlows: BoundaryFlow[];
  newtonIterations: number;
}

export interface TransportOutput {
  /** Error message; then there are no files */
  error: string | null;
  log: string;
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

export type WorkerResponse =
  | { type: "checked"; error: string | null }
  | { type: "progress"; acceptedCount: number; fraction: number }
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

  /** Returns the error message of the input, or null for a valid input */
  async check(input: GenerationInput): Promise<string | null> {
    const response = await this.request({ type: "check", ...input });
    return response.type === "checked" ? response.error : null;
  }

  async run(
    input: GenerationInput,
    onProgress: (acceptedCount: number, fraction: number) => void,
  ): Promise<GenerationOutput> {
    const seedIfZero = BigInt(1 + Math.floor(Math.random() * 2 ** 32));
    const response = await this.request({ type: "run", seedIfZero, ...input }, onProgress);
    if (response.type !== "result") {
      throw new Error(`unexpected answer of the worker: ${response.type}`);
    }
    return response;
  }

  /** Returns the error message of the flow input, or null for a valid input */
  async checkFlow(input: FlowInput): Promise<string | null> {
    const response = await this.request({ type: "checkFlow", ...input });
    return response.type === "checked" ? response.error : null;
  }

  async runFlow(input: FlowInput): Promise<FlowOutput> {
    const response = await this.request({ type: "runFlow", ...input });
    if (response.type !== "flowResult") {
      throw new Error(`unexpected answer of the worker: ${response.type}`);
    }
    return response;
  }

  /** Returns the error message of the transport input, or null for a valid input */
  async checkTransport(input: TransportInput): Promise<string | null> {
    const response = await this.request({ type: "checkTransport", ...input });
    return response.type === "checked" ? response.error : null;
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
    onProgress?: (acceptedCount: number, fraction: number) => void,
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
        if (response.type === "progress") {
          onProgress?.(response.acceptedCount, response.fraction);
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
