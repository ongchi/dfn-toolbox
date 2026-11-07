// The live run: one "Run" button runs the steps of the chain, and a change of
// a setting runs the steps again from the first step which the change
// affects (user decision). The results of the steps before it stay: they are
// the initial condition of the new run.
import { parse, stringify } from "smol-toml";
import type { GenerationInput } from "./generationClient";

/**
 * The steps of the chain, in their order. "generation": the fractures from
 * the seed; "userFractures": the fractures from the last checkpoint, with the
 * user-defined fractures of the form (the stochastic fractures stay).
 */
export const CHAIN_STEPS = ["generation", "userFractures", "mesh", "flow", "transport"] as const;
export type ChainStep = (typeof CHAIN_STEPS)[number];

/** "failed": the step showed an error; the chain waits for a change */
export type StepResult = "done" | "failed" | "cancelled";

export interface ChainRunner {
  /** Runs one step with the values of the forms now */
  runStep(step: ChainStep): Promise<StepResult>;
  /** Cancels the running step: its `runStep` gives "cancelled" */
  cancel(): void;
  /** The live run went on or off, or a step started or ended */
  onStateChange(): void;
}

/** The time after the last change before the steps run again: a user who types makes many changes */
export const CHANGE_DELAY_MS = 500;

function stepIndex(step: ChainStep): number {
  return CHAIN_STEPS.indexOf(step);
}

/** The earlier of two steps; null is after all steps */
export function earlierStep(first: ChainStep | null, second: ChainStep | null): ChainStep | null {
  if (first === null || second === null) {
    return first ?? second;
  }
  return stepIndex(first) <= stepIndex(second) ? first : second;
}

/** The TOML of the dfngen input without the values of the mesh: the mesh options and the family apertures */
function fractureToml(toml: string): string {
  const table = parse(toml);
  delete table.mesh;
  for (const family of Array.isArray(table.family) ? table.family : []) {
    if (typeof family === "object" && family !== null) {
      delete (family as Record<string, unknown>).aperture;
    }
  }
  return stringify(table);
}

/** True if two inputs give the same stochastic fractures: they can differ in the mesh values and the user-defined fractures */
export function isSameFractureInput(first: GenerationInput, second: GenerationInput): boolean {
  return first.mesh === second.mesh && fractureToml(first.toml) === fractureToml(second.toml);
}

/**
 * The first step which a change of the network forms affects; null for no
 * change. `network`: the input of the last generation; `meshed`: the input of
 * the last mesh.
 */
export function networkChangeStep(
  current: GenerationInput,
  network: GenerationInput | null,
  meshed: GenerationInput | null,
): ChainStep | null {
  if (network === null || !isSameFractureInput(current, network)) {
    return "generation";
  }
  if (current.userFractures !== network.userFractures) {
    return "userFractures";
  }
  if (meshed === null || current.toml !== meshed.toml || current.userFractures !== meshed.userFractures) {
    return "mesh";
  }
  return null;
}

/** One chain at a time; a change cancels a running step which it affects */
export class LiveRun {
  private isLiveOn = false;
  /** The first step whose values changed since it last started; null: all results are current */
  private firstStaleStep: ChainStep | null = CHAIN_STEPS[0];
  private runningStep: ChainStep | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private isChainRunning = false;

  constructor(
    private readonly runner: ChainRunner,
    private readonly delayMs = CHANGE_DELAY_MS,
  ) {}

  get isOn(): boolean {
    return this.isLiveOn;
  }

  /** The running step; null between the steps and when the chain waits */
  get currentStep(): ChainStep | null {
    return this.runningStep;
  }

  /** The first step which must run again; null: all results are current */
  get staleStep(): ChainStep | null {
    return this.firstStaleStep;
  }

  /** No chain runs and none waits for its delay */
  get isIdle(): boolean {
    return !this.isChainRunning && this.timer === null;
  }

  /** "Run": the steps run now from the first stale step, and again after each change */
  start(): void {
    this.isLiveOn = true;
    this.runner.onStateChange();
    this.schedule(0);
  }

  /** "Pause": cancels the running step; the results before it stay */
  stop(): void {
    this.isLiveOn = false;
    this.clearTimer();
    if (this.runningStep !== null) {
      this.runner.cancel();
    }
    this.runner.onStateChange();
  }

  /** "Reset": stops, and the next run starts from the seed */
  reset(): void {
    this.stop();
    this.firstStaleStep = CHAIN_STEPS[0];
  }

  /** A value of a step changed */
  changed(step: ChainStep): void {
    this.firstStaleStep = earlierStep(this.firstStaleStep, step);
    if (!this.isLiveOn) {
      return;
    }
    if (this.runningStep !== null && stepIndex(this.runningStep) >= stepIndex(step)) {
      this.runner.cancel();
    }
    this.schedule(this.delayMs);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(delayMs: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runChain().finally(() => this.runner.onStateChange());
    }, delayMs);
    this.runner.onStateChange();
  }

  /** Runs the steps from the first stale step; a running chain sees the new stale step itself */
  private async runChain(): Promise<void> {
    if (this.isChainRunning) {
      return;
    }
    this.isChainRunning = true;
    try {
      while (this.isLiveOn && this.firstStaleStep !== null) {
        const isStopped = await this.runStepsFrom(this.firstStaleStep);
        if (isStopped) {
          return;
        }
      }
    } finally {
      this.isChainRunning = false;
    }
  }

  /** Runs the steps from `first`; true if the chain must wait (a cancel, an error or "Pause") */
  private async runStepsFrom(first: ChainStep): Promise<boolean> {
    for (const step of CHAIN_STEPS.slice(stepIndex(first))) {
      if (!this.isLiveOn) {
        return true;
      }
      if (this.firstStaleStep === step) {
        this.firstStaleStep = null;
      }
      this.runningStep = step;
      this.runner.onStateChange();
      const result = await this.runner.runStep(step);
      this.runningStep = null;
      if (result !== "done") {
        // The step runs again at the next run
        this.firstStaleStep = earlierStep(this.firstStaleStep, step);
        this.runner.onStateChange();
        return true;
      }
      if (this.firstStaleStep !== null && stepIndex(this.firstStaleStep) <= stepIndex(step)) {
        return false;
      }
    }
    this.runner.onStateChange();
    return false;
  }
}
