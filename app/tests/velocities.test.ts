// The velocity arrays of "Color by": the magnitudes of the flow velocity of
// each triangle, and the mean speed of the transport at each mesh point.
import { expect, test } from "vitest";
import { nodeVelocityMagnitudes } from "../src/transport/velocities";
import { vectorMagnitudes } from "../src/viewerGeometry";

test("the magnitude of each vector is its length", () => {
  expect([...vectorMagnitudes([3, 4, 0, 0, 0, 2])]).toEqual([5, 2]);
});

test("the transport speed of a point is the mean of its sectors", () => {
  const speeds = nodeVelocityMagnitudes(Uint32Array.of(0, 0, 2), Float64Array.of(1, 0, 0, 3, 0, 0, 0, 2, 0), 3, "seconds");
  expect([...speeds]).toEqual([2, 0, 2]);
});

test("the transport speed is in m/s", () => {
  expect([...nodeVelocityMagnitudes(Uint32Array.of(0), Float64Array.of(0, 0, 86400), 1, "days")]).toEqual([1]);
});
