// The fractures of a running generation until a checkpoint
import { expect, test } from "vitest";
import { firstFractures, type FractureBatch } from "../src/generationClient";

/** A batch of fractures with 3 or 4 vertices; each coordinate is the number of its fracture */
function batch(fractureNumbers: number[], vertexCounts: number[]): FractureBatch {
  return {
    points: Float64Array.from(fractureNumbers.flatMap((number, index) => Array(3 * vertexCounts[index]).fill(number))),
    vertexCounts: Int32Array.from(vertexCounts),
    families: Int32Array.from(fractureNumbers.map((number) => number % 2)),
  };
}

test("the first fractures of two batches are one batch, in their order", () => {
  const fractures = firstFractures([batch([1, 2], [3, 4]), batch([3, 4], [4, 3])], 3);

  expect(fractures).toEqual(batch([1, 2, 3], [3, 4, 4]));
});

test("all fractures stay when the count is that of the batches", () => {
  expect(firstFractures([batch([1], [3]), batch([2], [4])], 2)).toEqual(batch([1, 2], [3, 4]));
});
