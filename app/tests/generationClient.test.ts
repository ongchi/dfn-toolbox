// The fractures of a running generation until a checkpoint
import { expect, test, vi } from "vitest";
import { firstFractures, GenerationClient, type FractureBatch } from "../src/generationClient";

/**
 * A batch of fractures with one polygon of 3 or 4 vertices, or no polygon
 * (vertex count 0); each coordinate is the number of its fracture
 */
function batch(fractureNumbers: number[], vertexCounts: number[]): FractureBatch {
  const polygons = fractureNumbers.flatMap((_, index) => (vertexCounts[index] === 0 ? [] : [index]));
  return {
    points: Float64Array.from(fractureNumbers.flatMap((number, index) => Array(3 * vertexCounts[index]).fill(number))),
    vertexCounts: Int32Array.from(polygons.map((index) => vertexCounts[index])),
    families: Int32Array.from(polygons.map((index) => fractureNumbers[index] % 2)),
    partCounts: Int32Array.from(vertexCounts.map((count) => (count === 0 ? 0 : 1))),
  };
}

test("the first fractures of two batches are one batch, in their order", () => {
  const fractures = firstFractures([batch([1, 2], [3, 4]), batch([3, 4], [4, 3])], 3);

  expect(fractures).toEqual(batch([1, 2, 3], [3, 4, 4]));
});

test("a fracture with no part in the domain counts as a fracture", () => {
  const fractures = firstFractures([batch([1, 2], [3, 0]), batch([3, 4], [4, 3])], 3);

  expect(fractures).toEqual(batch([1, 2, 3], [3, 0, 4]));
});

test("a fracture with two parts gives both polygons", () => {
  const twoParts: FractureBatch = {
    points: Float64Array.from(Array(3 * 7).fill(1)),
    vertexCounts: Int32Array.from([3, 4]),
    families: Int32Array.from([1, 1]),
    partCounts: Int32Array.from([2]),
  };

  expect(firstFractures([twoParts, batch([2], [3])], 1)).toEqual(twoParts);
});

test("all fractures stay when the count is that of the batches", () => {
  expect(firstFractures([batch([1], [3]), batch([2], [4])], 2)).toEqual(batch([1, 2], [3, 4]));
});

test("a transport result replaces the worker, which gives its memory back", async () => {
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    isTerminated = false;
    constructor() {
      workers.push(this);
    }
    postMessage(): void {
      this.onmessage?.({ data: { type: "transportResult" } });
    }
    terminate(): void {
      this.isTerminated = true;
    }
  }
  vi.stubGlobal("Worker", FakeWorker);

  const mesh = {
    points: new Float64Array(),
    triangles: new Uint32Array(),
    fractureIds: new Float64Array(),
    apertures: new Float64Array(),
    permeabilities: new Float64Array(),
    boundaries: [],
  };
  await new GenerationClient().runTransport({ toml: "", flowToml: "", mesh });
  vi.unstubAllGlobals();

  expect(workers.map((worker) => worker.isTerminated)).toEqual([true, false]);
});
