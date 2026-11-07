// The live run: the order of the steps after "Run" and after a change.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { GenerationInput } from "../src/generationClient";
import { CHANGE_DELAY_MS, LiveRun, networkChangeStep, type ChainRunner, type ChainStep, type StepResult } from "../src/liveRun";

/** A runner whose steps end when the test says so */
class TestRunner implements ChainRunner {
  readonly started: ChainStep[] = [];
  cancelCount = 0;
  private finish: ((result: StepResult) => void) | null = null;

  runStep(step: ChainStep): Promise<StepResult> {
    this.started.push(step);
    return new Promise((resolve) => (this.finish = resolve));
  }

  cancel(): void {
    this.cancelCount += 1;
    this.end("cancelled");
  }

  onStateChange(): void {}

  /** Ends the running step */
  end(result: StepResult = "done"): void {
    const finish = this.finish;
    this.finish = null;
    finish?.(result);
  }
}

let runner: TestRunner;
let live: LiveRun;

beforeEach(() => {
  vi.useFakeTimers();
  runner = new TestRunner();
  live = new LiveRun(runner);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Lets the timers and the promises run */
async function settle(milliseconds = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(milliseconds);
}

/** Ends each step which starts until the chain waits */
async function endAllSteps(): Promise<void> {
  for (let step = 0; step < 10; step++) {
    await settle();
    runner.end();
  }
  await settle();
}

test("Run runs all steps in their order", async () => {
  live.start();
  await endAllSteps();
  expect(runner.started).toEqual(["generation", "userFractures", "mesh", "flow", "transport"]);
});

test("a change of the flow runs the flow and the transport again", async () => {
  live.start();
  await endAllSteps();
  runner.started.length = 0;

  live.changed("flow");
  await settle(CHANGE_DELAY_MS);
  await endAllSteps();

  expect(runner.started).toEqual(["flow", "transport"]);
});

test("the steps run again only after the delay of the last change", async () => {
  live.start();
  await endAllSteps();
  runner.started.length = 0;

  live.changed("transport");
  await settle(CHANGE_DELAY_MS / 2);
  live.changed("transport");
  await settle(CHANGE_DELAY_MS / 2);

  expect(runner.started).toEqual([]);
});

test("a change of the running step cancels it, and the step runs again", async () => {
  live.start();
  await settle();
  runner.end();
  await settle();
  runner.end();
  await settle();
  expect(runner.started.at(-1)).toBe("mesh");

  live.changed("mesh");
  await settle(CHANGE_DELAY_MS);

  expect([runner.cancelCount, runner.started.at(-1)]).toEqual([1, "mesh"]);
});

test("a change of a later step does not cancel the running step", async () => {
  live.start();
  await settle();
  live.changed("transport");
  await settle(CHANGE_DELAY_MS);
  await endAllSteps();

  expect([runner.cancelCount, runner.started]).toEqual([0, ["generation", "userFractures", "mesh", "flow", "transport"]]);
});

test("a failed step stops the chain, and a later change runs from that step", async () => {
  live.start();
  await settle();
  runner.end();
  await settle();
  runner.end();
  await settle();
  runner.end("failed");
  await settle(CHANGE_DELAY_MS);
  expect(runner.started.at(-1)).toBe("mesh");

  live.changed("transport");
  await settle(CHANGE_DELAY_MS);

  expect(runner.started.slice(3)).toEqual(["mesh"]);
});

test("Pause cancels the running step, and the next Run starts with it", async () => {
  live.start();
  await settle();
  runner.end();
  await settle();
  live.stop();
  await settle();
  runner.started.length = 0;

  live.start();
  await settle();

  expect([runner.cancelCount, runner.started]).toEqual([1, ["userFractures"]]);
});

test("a change while the live run is off runs at the next Run", async () => {
  live.start();
  await endAllSteps();
  live.stop();
  live.changed("flow");
  await settle(CHANGE_DELAY_MS);
  runner.started.length = 0;

  live.start();
  await endAllSteps();

  expect(runner.started).toEqual(["flow", "transport"]);
});

test("after Reset the next Run starts from the seed", async () => {
  live.start();
  await endAllSteps();
  live.reset();
  runner.started.length = 0;

  live.start();
  await settle();

  expect(runner.started).toEqual(["generation"]);
});

const NETWORK = `seed = 1
user_fractures = "user_fractures.vtp"

[mesh]
enable = true
slope = 0.5

[[family]]
probability = 1.0
aperture = { distribution = "constant", value = 1e-4 }
`;

function input(toml: string, userFractures = "<VTKFile/>"): GenerationInput {
  return { toml, mesh: "<mesh/>", userFractures };
}

test("no change of the network forms affects no step", () => {
  expect(networkChangeStep(input(NETWORK), input(NETWORK), input(NETWORK))).toBeNull();
});

test("a change of a family runs the generation from the seed", () => {
  const changed = NETWORK.replace("probability = 1.0", "probability = 0.5");
  expect(networkChangeStep(input(changed), input(NETWORK), input(NETWORK))).toBe("generation");
});

test("a change of the user-defined fractures keeps the stochastic fractures", () => {
  expect(networkChangeStep(input(NETWORK, "<other/>"), input(NETWORK), input(NETWORK))).toBe("userFractures");
});

test("a change of the mesh options makes the mesh again", () => {
  const changed = NETWORK.replace("slope = 0.5", "slope = 0.3");
  expect(networkChangeStep(input(changed), input(NETWORK), input(NETWORK))).toBe("mesh");
});

test("a change of a family aperture makes the mesh again", () => {
  const changed = NETWORK.replace("value = 1e-4", "value = 2e-4");
  expect(networkChangeStep(input(changed), input(NETWORK), input(NETWORK))).toBe("mesh");
});

test("without a network each change runs the generation", () => {
  expect(networkChangeStep(input(NETWORK), null, null)).toBe("generation");
});
