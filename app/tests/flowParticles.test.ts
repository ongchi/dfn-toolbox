// The moving particles of the flow view.
import { expect, test } from "vitest";
import { displaySpeeds, FlowParticles, TRAIL_POINT_COUNT, type FlowField } from "../src/flowParticles";

/** A fixed list of random numbers, used again from its start */
function fixedRandom(values: number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length];
}

/** Two triangles of the square 0 to 1 in the plane z = 0, with one velocity */
function squareField(velocity: [number, number, number]): FlowField {
  return {
    points: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
    triangles: [0, 1, 2, 0, 2, 3],
    velocities: [...velocity, ...velocity],
  };
}

test("a particle follows the direction of the velocity", () => {
  const particles = new FlowParticles(squareField([1, 0, 0]), 1, fixedRandom([0.1, 0.2, 0.2, 0.01, 0]));
  const [x, y, z] = particles.position(0);
  particles.advance(0.1);
  const [newX, newY, newZ] = particles.position(0);
  expect(newX).toBeGreaterThan(x);
  expect([newY, newZ]).toEqual([y, z]);
});

test("a particle crosses the edge into the next triangle", () => {
  // Start near the diagonal in the lower triangle, flow to +y: it goes into the upper triangle
  const particles = new FlowParticles(squareField([0, 1, 0]), 1, fixedRandom([0.1, 0.05, 0.9, 0.5, 0]));
  expect(particles.triangle(0)).toBe(0);
  for (let step = 0; step < 30 && particles.triangle(0) === 0; step++) {
    particles.advance(0.05);
  }
  expect(particles.triangle(0)).toBe(1);
});

test("a particle changes fracture at an intersection", () => {
  // Fracture A in z = 0 ends at x = 1 at the edge of fracture B in the plane x = 1, with the flow to +z there
  const field: FlowField = {
    points: [0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1],
    triangles: [0, 1, 2, 1, 3, 4, 1, 4, 2],
    velocities: [1, 0, 0, 0, 0, 1, 0, 0, 1],
  };
  const particles = new FlowParticles(field, 1, fixedRandom([0, 0.4, 0.4, 0.01, 0]));
  expect(particles.triangle(0)).toBe(0);
  for (let step = 0; step < 40 && particles.triangle(0) === 0; step++) {
    particles.advance(0.05);
  }
  expect(particles.triangle(0)).toBeGreaterThan(0);
  expect(particles.position(0)[0]).toBeCloseTo(1);
});

test("a particle at a dead end starts again", () => {
  const random = fixedRandom([0.5, 0.45, 0.45, 0.01, 0.2, 0.2, 0.3, 0.9]);
  const particles = new FlowParticles(squareField([1, 0, 0]), 1, random);
  let isRestarted = false;
  let lastX = particles.position(0)[0];
  for (let step = 0; step < 200 && !isRestarted; step++) {
    particles.advance(0.05);
    isRestarted = particles.position(0)[0] < lastX;
    lastX = particles.position(0)[0];
  }
  expect(isRestarted).toBe(true);
  expect(lastX).toBeLessThanOrEqual(1);
});

test("a mesh with no flow has no particles", () => {
  expect(new FlowParticles(squareField([0, 0, 0]), 10, Math.random).particleCount).toBe(0);
});

test("the display speeds use a log scale: small speeds stay visible", () => {
  const [fast, slow, none] = displaySpeeds([1, 0, 0, 1e-3, 0, 0, 0, 0, 0], 10);
  expect(slow / fast).toBeGreaterThan(0.5);
  expect(none).toBe(0);
});

test("the trails fade to their old end and stay relative to the origin", () => {
  const particles = new FlowParticles(squareField([1, 0, 0]), 1, fixedRandom([0.1, 0.2, 0.2, 0.01, 0.5]));
  for (let step = 0; step < 30; step++) {
    particles.advance(0.04);
  }
  const positions = new Float32Array(6 * particles.segmentCount);
  const opacities = new Float32Array(2 * particles.segmentCount);
  particles.writeTrails([0.5, 0.5, 0], positions, opacities);
  expect(particles.segmentCount).toBe(TRAIL_POINT_COUNT - 1);
  expect(opacities.at(-1)).toBe(0);
  expect(opacities[0]).toBeGreaterThan(opacities[opacities.length - 2]);
  expect(positions[0]).toBeCloseTo(particles.position(0)[0] - 0.5);
});
