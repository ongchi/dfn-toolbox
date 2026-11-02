// Moving particles on the triangle mesh, for the view of the flow. They show the
// direction and the speed of the flow with the Darcy velocity of each triangle.
// Their paths are only for the view: they are not the routing of dfntrans.
import { boundsDiagonal } from "./viewerGeometry";

/** The flow on the triangle mesh */
export interface FlowField {
  /** x, y, z of each point */
  points: ArrayLike<number>;
  /** The three point numbers of each triangle */
  triangles: ArrayLike<number>;
  /** x, y, z of the velocity of each triangle */
  velocities: ArrayLike<number>;
}

/** Points of one trail */
export const TRAIL_POINT_COUNT = 12;
/** Seconds between two points of a trail */
const TRAIL_INTERVAL = 0.04;
/** The fastest particle goes this part of the diagonal of the mesh in one second */
const LARGEST_SPEED_PART = 0.08;
/** The slowest shown speed is this part of the largest speed */
const SMALLEST_SPEED_PART = 1e-6;
/** The display speed of the slowest shown flow is this part of the largest display speed */
const SMALLEST_DISPLAY_PART = 0.1;
/** Seconds of the life of a particle */
const SHORTEST_LIFE = 2;
const LONGEST_LIFE = 6;
/** Seconds of the fade at the start and at the end of a life */
const FADE_TIME = 0.5;
/** The edges which a particle crosses in one step, at most: then the step ends */
const MAX_EDGE_CROSSINGS = 16;

/** Display speed (per second) of each triangle: log scale of the speed; 0 for a triangle with no flow */
export function displaySpeeds(velocities: ArrayLike<number>, diagonal: number): Float64Array {
  const speeds = new Float64Array(velocities.length / 3);
  let largest = 0;
  for (let index = 0; index < speeds.length; index++) {
    speeds[index] = Math.hypot(velocities[3 * index], velocities[3 * index + 1], velocities[3 * index + 2]);
    largest = Math.max(largest, speeds[index]);
  }
  const smallest = largest * SMALLEST_SPEED_PART;
  const logRange = Math.log(largest / smallest);
  return speeds.map((speed) => {
    if (largest === 0 || speed <= smallest) {
      return 0;
    }
    const part = Math.log(speed / smallest) / logRange;
    return LARGEST_SPEED_PART * diagonal * (SMALLEST_DISPLAY_PART + (1 - SMALLEST_DISPLAY_PART) * part);
  });
}

/** Triangle mesh with what a particle needs: the edges in the plane of each triangle, and the neighbors */
class ParticleMesh {
  /** x, y, z of the unit normal of each of the 3 edges of each triangle, in the plane, to the outside */
  readonly edgeNormals: Float64Array;
  /** The value of (normal · point) on each edge */
  readonly edgeOffsets: Float64Array;
  /** The same edge in other triangles, for edge e (3 × triangle + 0 to 2): `neighborEdges[neighborStarts[e] .. neighborStarts[e + 1]]` */
  readonly neighborStarts: Uint32Array;
  readonly neighborEdges: Uint32Array;
  readonly areas: Float64Array;

  constructor(private readonly field: FlowField) {
    const triangleCount = field.triangles.length / 3;
    this.edgeNormals = new Float64Array(9 * triangleCount);
    this.edgeOffsets = new Float64Array(3 * triangleCount);
    this.areas = new Float64Array(triangleCount);
    for (let triangle = 0; triangle < triangleCount; triangle++) {
      this.addTriangleEdges(triangle);
    }
    const edgesOfKey = new Map<number, number[]>();
    const pointCount = field.points.length / 3;
    for (let edge = 0; edge < 3 * triangleCount; edge++) {
      const key = this.edgeKey(edge, pointCount);
      const list = edgesOfKey.get(key);
      if (list) {
        list.push(edge);
      } else {
        edgesOfKey.set(key, [edge]);
      }
    }
    this.neighborStarts = new Uint32Array(3 * triangleCount + 1);
    const neighborEdges: number[] = [];
    for (let edge = 0; edge < 3 * triangleCount; edge++) {
      for (const other of edgesOfKey.get(this.edgeKey(edge, pointCount)) ?? []) {
        if (other !== edge) {
          neighborEdges.push(other);
        }
      }
      this.neighborStarts[edge + 1] = neighborEdges.length;
    }
    this.neighborEdges = Uint32Array.from(neighborEdges);
  }

  private cornerPoint(edge: number): number {
    return this.field.triangles[edge];
  }

  /** The two points of edge `edge` of the list of all edges */
  private edgePoints(edge: number): [number, number] {
    const triangle = Math.floor(edge / 3);
    return [this.cornerPoint(edge), this.cornerPoint(3 * triangle + ((edge + 1) % 3))];
  }

  private edgeKey(edge: number, pointCount: number): number {
    const [first, second] = this.edgePoints(edge);
    return Math.min(first, second) * pointCount + Math.max(first, second);
  }

  private coordinates(point: number): [number, number, number] {
    const { points } = this.field;
    return [points[3 * point], points[3 * point + 1], points[3 * point + 2]];
  }

  private addTriangleEdges(triangle: number): void {
    const corners = [0, 1, 2].map((corner) => this.coordinates(this.cornerPoint(3 * triangle + corner)));
    const [a, b, c] = corners;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    this.areas[triangle] = Math.hypot(normal[0], normal[1], normal[2]) / 2;
    for (let edge = 0; edge < 3; edge++) {
      const from = corners[edge];
      const to = corners[(edge + 1) % 3];
      const along = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
      const outward = [
        along[1] * normal[2] - along[2] * normal[1],
        along[2] * normal[0] - along[0] * normal[2],
        along[0] * normal[1] - along[1] * normal[0],
      ];
      const length = Math.hypot(outward[0], outward[1], outward[2]) || 1;
      const position = 9 * triangle + 3 * edge;
      for (let axis = 0; axis < 3; axis++) {
        this.edgeNormals[position + axis] = outward[axis] / length;
      }
      this.edgeOffsets[3 * triangle + edge] =
        (outward[0] * from[0] + outward[1] * from[1] + outward[2] * from[2]) / length;
    }
  }
}

/** The particles and their trails; `random` gives numbers from 0 to below 1 */
export class FlowParticles {
  private readonly mesh: ParticleMesh;
  private readonly speeds: Float64Array;
  /** The velocity of each triangle for the view: x, y, z */
  private readonly displayVelocities: Float64Array;
  /** The sum of the start weights up to each triangle */
  private readonly startWeights: Float64Array;
  private readonly triangles: Uint32Array;
  private readonly ages: Float64Array;
  private readonly lives: Float64Array;
  /** x, y, z of each point of each trail; a ring */
  private readonly trails: Float64Array;
  /** The position of the newest point of the rings */
  private newestPoint = 0;
  private timeToNextPoint = TRAIL_INTERVAL;
  /** x, y, z of each particle */
  private readonly positions: Float64Array;
  readonly particleCount: number;

  constructor(
    private readonly field: FlowField,
    requestedCount: number,
    private readonly random: () => number,
  ) {
    this.mesh = new ParticleMesh(field);
    this.speeds = displaySpeeds(field.velocities, boundsDiagonal(field.points));
    this.displayVelocities = new Float64Array(field.velocities.length);
    this.speeds.forEach((speed, triangle) => {
      const position = 3 * triangle;
      const scale = speed / Math.hypot(field.velocities[position], field.velocities[position + 1], field.velocities[position + 2]);
      for (let axis = 0; axis < 3 && speed > 0; axis++) {
        this.displayVelocities[position + axis] = scale * field.velocities[position + axis];
      }
    });
    let sum = 0;
    this.startWeights = this.speeds.map((speed, triangle) => (sum += speed * this.mesh.areas[triangle]));
    this.particleCount = sum > 0 ? requestedCount : 0;
    this.triangles = new Uint32Array(this.particleCount);
    this.ages = new Float64Array(this.particleCount);
    this.lives = new Float64Array(this.particleCount);
    this.positions = new Float64Array(3 * this.particleCount);
    this.trails = new Float64Array(3 * this.particleCount * TRAIL_POINT_COUNT);
    for (let particle = 0; particle < this.particleCount; particle++) {
      this.restart(particle);
      // A different part of the life for each particle: they do not restart together
      this.ages[particle] = this.random() * this.lives[particle];
    }
  }

  /** All trail points of a particle are at its new position */
  private restart(particle: number): void {
    const { field } = this;
    const triangle = this.randomStartTriangle();
    const first = this.random();
    const second = this.random();
    const isFolded = first + second > 1;
    const a = isFolded ? 1 - first : first;
    const b = isFolded ? 1 - second : second;
    for (let axis = 0; axis < 3; axis++) {
      const corner = (index: number) => field.points[3 * field.triangles[3 * triangle + index] + axis];
      this.positions[3 * particle + axis] = corner(0) + a * (corner(1) - corner(0)) + b * (corner(2) - corner(0));
    }
    this.triangles[particle] = triangle;
    this.ages[particle] = 0;
    this.lives[particle] = SHORTEST_LIFE + this.random() * (LONGEST_LIFE - SHORTEST_LIFE);
    const start = 3 * particle * TRAIL_POINT_COUNT;
    for (let point = 0; point < TRAIL_POINT_COUNT; point++) {
      this.trails.set(this.positions.subarray(3 * particle, 3 * particle + 3), start + 3 * point);
    }
  }

  private randomStartTriangle(): number {
    const target = this.random() * this.startWeights[this.startWeights.length - 1];
    let low = 0;
    let high = this.startWeights.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (this.startWeights[middle] > target) {
        high = middle;
      } else {
        low = middle + 1;
      }
    }
    return low;
  }

  /** The time (seconds) to the first edge in the direction of the flow, and the edge (0 to 2) */
  private firstEdge(particle: number, triangle: number): { time: number; edge: number } {
    let time = Infinity;
    let edge = 0;
    const { edgeNormals, edgeOffsets } = this.mesh;
    for (let candidate = 0; candidate < 3; candidate++) {
      const normal = 9 * triangle + 3 * candidate;
      let rate = 0;
      let distance = edgeOffsets[3 * triangle + candidate];
      for (let axis = 0; axis < 3; axis++) {
        rate += edgeNormals[normal + axis] * this.displayVelocities[3 * triangle + axis];
        distance -= edgeNormals[normal + axis] * this.positions[3 * particle + axis];
      }
      if (rate > 0) {
        const edgeTime = Math.max(0, distance) / rate;
        if (edgeTime < time) {
          time = edgeTime;
          edge = candidate;
        }
      }
    }
    return { time, edge };
  }

  /**
   * The next triangle at an edge: one with its flow away from the edge (also in
   * another fracture), at random with a weight of its speed; null if there is none.
   */
  private nextTriangle(triangle: number, edge: number): number | null {
    const { neighborStarts, neighborEdges, edgeNormals } = this.mesh;
    const start = neighborStarts[3 * triangle + edge];
    const end = neighborStarts[3 * triangle + edge + 1];
    let weightSum = 0;
    let selected: number | null = null;
    for (let index = start; index < end; index++) {
      const otherEdge = neighborEdges[index];
      const other = Math.floor(otherEdge / 3);
      let rate = 0;
      for (let axis = 0; axis < 3; axis++) {
        rate += edgeNormals[3 * otherEdge + axis] * this.displayVelocities[3 * other + axis];
      }
      if (rate >= 0 || this.speeds[other] === 0) {
        continue;
      }
      weightSum += this.speeds[other];
      if (this.random() * weightSum < this.speeds[other]) {
        selected = other;
      }
    }
    return selected;
  }

  private moveParticle(particle: number, seconds: number): void {
    let remaining = seconds;
    for (let crossing = 0; crossing < MAX_EDGE_CROSSINGS; crossing++) {
      const triangle = this.triangles[particle];
      const { time, edge } = this.firstEdge(particle, triangle);
      const step = Math.min(time, remaining);
      for (let axis = 0; axis < 3; axis++) {
        this.positions[3 * particle + axis] += step * this.displayVelocities[3 * triangle + axis];
      }
      remaining -= step;
      if (remaining <= 0) {
        return;
      }
      const next = this.nextTriangle(triangle, edge);
      if (next === null) {
        this.restart(particle);
        return;
      }
      this.triangles[particle] = next;
    }
  }

  /** Moves all particles; a particle at the end of its life, or with no way forward, starts again */
  advance(seconds: number): void {
    for (let particle = 0; particle < this.particleCount; particle++) {
      this.ages[particle] += seconds;
      if (this.ages[particle] >= this.lives[particle]) {
        this.restart(particle);
      } else {
        this.moveParticle(particle, seconds);
      }
    }
    this.timeToNextPoint -= seconds;
    if (this.timeToNextPoint <= 0) {
      this.timeToNextPoint = TRAIL_INTERVAL;
      this.newestPoint = (this.newestPoint + 1) % TRAIL_POINT_COUNT;
    }
    for (let particle = 0; particle < this.particleCount; particle++) {
      const target = 3 * (particle * TRAIL_POINT_COUNT + this.newestPoint);
      this.trails.set(this.positions.subarray(3 * particle, 3 * particle + 3), target);
    }
  }

  /** The number of line segments of `writeTrails` */
  get segmentCount(): number {
    return this.particleCount * (TRAIL_POINT_COUNT - 1);
  }

  /**
   * Writes the line segments of the trails: x, y, z of both ends, relative to
   * `origin`, and the opacity at both ends (`opacities`).
   */
  writeTrails(origin: readonly [number, number, number], positions: Float32Array, opacities: Float32Array): void {
    let output = 0;
    for (let particle = 0; particle < this.particleCount; particle++) {
      const age = this.ages[particle];
      const fade = Math.min(1, age / FADE_TIME, (this.lives[particle] - age) / FADE_TIME);
      const start = particle * TRAIL_POINT_COUNT;
      for (let step = 0; step + 1 < TRAIL_POINT_COUNT; step++) {
        const newer = start + (this.newestPoint - step + TRAIL_POINT_COUNT) % TRAIL_POINT_COUNT;
        const older = start + (this.newestPoint - step - 1 + TRAIL_POINT_COUNT) % TRAIL_POINT_COUNT;
        for (let axis = 0; axis < 3; axis++) {
          positions[6 * output + axis] = this.trails[3 * newer + axis] - origin[axis];
          positions[6 * output + 3 + axis] = this.trails[3 * older + axis] - origin[axis];
        }
        opacities[2 * output] = fade * (1 - step / (TRAIL_POINT_COUNT - 1));
        opacities[2 * output + 1] = fade * (1 - (step + 1) / (TRAIL_POINT_COUNT - 1));
        output += 1;
      }
    }
  }

  /** x, y, z of a particle */
  position(particle: number): [number, number, number] {
    const start = 3 * particle;
    return [this.positions[start], this.positions[start + 1], this.positions[start + 2]];
  }

  /** The triangle of a particle */
  triangle(particle: number): number {
    return this.triangles[particle];
  }
}
