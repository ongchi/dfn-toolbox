// Interface of the generation worker for the page.

export interface GenerationInput {
  toml: string;
  mesh: string;
  userFractures: string | undefined;
}

export type WorkerRequest =
  | ({ type: "check" } & GenerationInput)
  | ({ type: "run"; seedIfZero: bigint } & GenerationInput);

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

export type WorkerResponse =
  | { type: "checked"; error: string | null }
  | { type: "progress"; acceptedCount: number; fraction: number }
  /** The WebAssembly module failed (a panic); the worker must be replaced */
  | { type: "crashed"; message: string }
  | ({ type: "result" } & GenerationOutput);

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
