// The shapes of the 3D view as arrays: pure functions, with no WebGL.
import { ShapeUtils, Vector2 } from "three";

/** Polygons or triangles: the points, and the points of each cell */
export interface CellShapes {
  /** x, y, z of each point */
  points: ArrayLike<number>;
  /** Number of points of each cell */
  vertexCounts: ArrayLike<number>;
  /** The point numbers of all cells, one cell after the other */
  connectivity: ArrayLike<number>;
}

/** Triangles of cells */
export interface CellTriangles {
  /** The three point numbers of each triangle */
  corners: Uint32Array;
  /** The cell of each triangle */
  cells: Uint32Array;
}

/** Positions in single precision, relative to an origin: large coordinates keep their precision */
export interface LocalPositions {
  origin: [number, number, number];
  positions: Float32Array;
}

// VTK cell types of the domain mesh, and the edges of each one (positions in the points of the cell)
const VTK_TRIANGLE = 5;
const VTK_QUAD = 9;
const VOLUME_CELL_EDGES = new Map<number, readonly (readonly [number, number])[]>([
  // Tetrahedron
  [10, [[0, 1], [1, 2], [2, 0], [0, 3], [1, 3], [2, 3]]],
  // Voxel
  [11, [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7]]],
  // Hexahedron
  [12, [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]],
  // Wedge
  [13, [[0, 1], [1, 2], [2, 0], [3, 4], [4, 5], [5, 3], [0, 3], [1, 4], [2, 5]]],
  // Pyramid
  [14, [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [1, 4], [2, 4], [3, 4]]],
]);

/** The center of the bounds of the points, and the positions relative to it */
export function localPositions(points: ArrayLike<number>): LocalPositions {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < points.length; index++) {
    min[index % 3] = Math.min(min[index % 3], points[index]);
    max[index % 3] = Math.max(max[index % 3], points[index]);
  }
  const origin: [number, number, number] =
    points.length === 0 ? [0, 0, 0] : [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const positions = new Float32Array(points.length);
  for (let index = 0; index < points.length; index++) {
    positions[index] = points[index] - origin[index % 3];
  }
  return { origin, positions };
}

/** The two largest components of the normal of a polygon select the plane for its triangles */
function polygonPlaneAxes(points: ArrayLike<number>, polygon: ArrayLike<number>): [number, number] {
  const normal = [0, 0, 0];
  for (let index = 0; index < polygon.length; index++) {
    const first = 3 * polygon[index];
    const second = 3 * polygon[(index + 1) % polygon.length];
    normal[0] += (points[first + 1] - points[second + 1]) * (points[first + 2] + points[second + 2]);
    normal[1] += (points[first + 2] - points[second + 2]) * (points[first] + points[second]);
    normal[2] += (points[first] - points[second]) * (points[first + 1] + points[second + 1]);
  }
  const lengths = normal.map(Math.abs);
  if (lengths[0] >= lengths[1] && lengths[0] >= lengths[2]) {
    return [1, 2];
  }
  return lengths[1] >= lengths[2] ? [2, 0] : [0, 1];
}

/** The triangles of each cell; a polygon can be concave */
export function cellTriangles(shapes: CellShapes): CellTriangles {
  const corners: number[] = [];
  const cells: number[] = [];
  let start = 0;
  for (let cell = 0; cell < shapes.vertexCounts.length; cell++) {
    const count = shapes.vertexCounts[cell];
    const polygon = Array.from({ length: count }, (_, index) => shapes.connectivity[start + index]);
    start += count;
    if (count === 3) {
      corners.push(polygon[0], polygon[1], polygon[2]);
      cells.push(cell);
      continue;
    }
    const [firstAxis, secondAxis] = polygonPlaneAxes(shapes.points, polygon);
    const outline = polygon.map(
      (point) => new Vector2(shapes.points[3 * point + firstAxis], shapes.points[3 * point + secondAxis]),
    );
    for (const triangle of ShapeUtils.triangulateShape(outline, [])) {
      corners.push(polygon[triangle[0]], polygon[triangle[1]], polygon[triangle[2]]);
      cells.push(cell);
    }
  }
  return { corners: Uint32Array.from(corners), cells: Uint32Array.from(cells) };
}

/** The edges of each cell, as pairs of point numbers: an edge of two cells is there once */
export function cellEdges(shapes: Omit<CellShapes, "points">, pointCount: number): Uint32Array {
  return edgesUsed(shapes, pointCount, () => true);
}

function edgesUsed(
  shapes: Omit<CellShapes, "points">,
  pointCount: number,
  isSelected: (useCount: number) => boolean,
): Uint32Array {
  const useCounts = new Map<number, number>();
  let start = 0;
  for (let cell = 0; cell < shapes.vertexCounts.length; cell++) {
    const count = shapes.vertexCounts[cell];
    for (let index = 0; index < count; index++) {
      const first = shapes.connectivity[start + index];
      const second = shapes.connectivity[start + (index + 1) % count];
      const key = Math.min(first, second) * pointCount + Math.max(first, second);
      useCounts.set(key, (useCounts.get(key) ?? 0) + 1);
    }
    start += count;
  }
  const pairs: number[] = [];
  for (const [key, useCount] of useCounts) {
    if (isSelected(useCount)) {
      pairs.push(Math.floor(key / pointCount), key % pointCount);
    }
  }
  return Uint32Array.from(pairs);
}

/** The edges of the cells of the domain mesh, as pairs of point numbers; each edge is there once */
export function domainEdges(
  connectivity: ArrayLike<number>,
  offsets: ArrayLike<number>,
  types: ArrayLike<number>,
  pointCount: number,
): Uint32Array {
  const keys = new Set<number>();
  for (let cell = 0; cell < types.length; cell++) {
    const start = cell === 0 ? 0 : offsets[cell - 1];
    const count = offsets[cell] - start;
    const type = types[cell];
    const pairs =
      type === VTK_TRIANGLE || type === VTK_QUAD
        ? Array.from({ length: count }, (_, index): [number, number] => [index, (index + 1) % count])
        : (VOLUME_CELL_EDGES.get(type) ?? []);
    for (const [firstPosition, secondPosition] of pairs) {
      const first = connectivity[start + firstPosition];
      const second = connectivity[start + secondPosition];
      keys.add(Math.min(first, second) * pointCount + Math.max(first, second));
    }
  }
  return Uint32Array.from([...keys].flatMap((key) => [Math.floor(key / pointCount), key % pointCount]));
}

/** The coefficients of x⁰ to x⁵ of the polynomial of each color of `tableColor` */
const TURBO_RED = [0.13572138, 4.6153926, -42.66032258, 132.13108234, -152.94239396, 59.28637943];
const TURBO_GREEN = [0.09140261, 2.19418839, 4.84296658, -14.18503333, 4.27729857, 2.82956604];
const TURBO_BLUE = [0.1066733, 12.64194608, -60.58204836, 110.36276771, -89.90310912, 27.34824973];

/** The red, green and blue (0 to 1) of the color table at `fraction` (0 to 1): the polynomial approximation of Turbo (Google) */
export function tableColor(fraction: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, fraction));
  const component = (coefficients: number[]) =>
    Math.min(1, Math.max(0, coefficients.reduceRight((sum, coefficient) => sum * x + coefficient, 0)));
  return [component(TURBO_RED), component(TURBO_GREEN), component(TURBO_BLUE)];
}

/** The smallest and the largest value; [0, 0] without values */
export function valueRange(values: ArrayLike<number>): [number, number] {
  if (values.length === 0) {
    return [0, 0];
  }
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < values.length; index++) {
    min = Math.min(min, values[index]);
    max = Math.max(max, values[index]);
  }
  return [min, max];
}

/** The values of the lowest and the highest color */
export interface ColorRange {
  min: number;
  max: number;
  isLog: boolean;
}

/** The range of the values. A log scale uses the positive values; without one the scale is linear. */
export function colorRange(values: ArrayLike<number>, isLogRequested: boolean): ColorRange {
  const [min, max] = valueRange(values);
  const smallestPositive = isLogRequested ? smallestPositiveValue(values) : null;
  return smallestPositive === null ? { min, max, isLog: false } : { min: smallestPositive, max, isLog: true };
}

/** The smallest value above 0; null if there is none */
export function smallestPositiveValue(values: ArrayLike<number>): number | null {
  let smallest = Infinity;
  for (let index = 0; index < values.length; index++) {
    if (values[index] > 0) {
      smallest = Math.min(smallest, values[index]);
    }
  }
  return smallest === Infinity ? null : smallest;
}

/** The place (0 to 1) of a value in the color table; a value at or below the range has the lowest color */
export function colorFraction(value: number, { min, max, isLog }: ColorRange): number {
  if (value <= min || max <= min) {
    return 0;
  }
  return isLog ? Math.log(value / min) / Math.log(max / min) : (value - min) / (max - min);
}

/** A tick of a scalar bar: its place (0 to 1) and its label */
export interface ScalarBarTick {
  fraction: number;
  text: string;
}

/** The ticks of a scalar bar, from the smallest value; the labels are the values / 10^`factorExponent` */
export interface ScalarBarTicks {
  /** null: the labels are the values */
  factorExponent: number | null;
  ticks: ScalarBarTick[];
}

/** A linear scale shows a power of 10 in the title from this exponent (absolute) of its largest tick */
const SMALLEST_FACTOR_EXPONENT = 3;
/** Rounding of the multiples of a step at the ends of the range */
const STEP_TOLERANCE = 1e-9;
const SUPERSCRIPT_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";

/** 10ⁿ as text: `10⁻⁸`; `1` and `10` for 10⁰ and 10¹ */
export function powerOfTenText(exponent: number): string {
  if (exponent === 0 || exponent === 1) {
    return String(10 ** exponent);
  }
  const digits = [...String(Math.abs(exponent))].map((digit) => SUPERSCRIPT_DIGITS[Number(digit)]).join("");
  return `10${exponent < 0 ? "⁻" : ""}${digits}`;
}

/** The title of a scalar bar: `name (×10⁻² unit)`, without the parts which it does not have */
export function scalarBarTitle(name: string, unit: string | null, factorExponent: number | null): string {
  const parts = [factorExponent === null ? "" : `×${powerOfTenText(factorExponent)}`, unit ?? ""].filter((part) => part !== "");
  return parts.length === 0 ? name : `${name} (${parts.join(" ")})`;
}

/** A value with 3 significant digits, without trailing zeros */
function shortText(value: number): string {
  return String(Number(value.toPrecision(3)));
}

/** The multiples of `step` in [min, max] */
function multiples(min: number, max: number, step: number): number[] {
  const first = Math.ceil(min / step - STEP_TOLERANCE);
  const last = Math.floor(max / step + STEP_TOLERANCE);
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => (first + index) * step);
}

/** The ticks of the smallest and the largest value */
function endTicks(range: ColorRange): ScalarBarTicks {
  return {
    factorExponent: null,
    ticks: [
      { fraction: 0, text: shortText(range.min) },
      { fraction: 1, text: shortText(range.max) },
    ],
  };
}

/** Linear scale: the multiples of the smallest step 1, 2 or 5 × 10^k with at most `maximumCount` of them */
function linearTicks(range: ColorRange, maximumCount: number): ScalarBarTicks {
  const { min, max } = range;
  for (let stepExponent = Math.floor(Math.log10((max - min) / maximumCount)); ; stepExponent++) {
    for (const mantissa of [1, 2, 5]) {
      const step = mantissa * 10 ** stepExponent;
      const values = multiples(min, max, step);
      if (values.length > maximumCount) {
        continue;
      }
      if (values.length < 2) {
        return endTicks(range);
      }
      const largestExponent = Math.floor(Math.log10(Math.max(...values.map(Math.abs))));
      const factorExponent = Math.abs(largestExponent) >= SMALLEST_FACTOR_EXPONENT ? largestExponent : null;
      const shift = factorExponent ?? 0;
      const decimals = Math.max(0, shift - stepExponent);
      return {
        factorExponent,
        ticks: values.map((value) => ({ fraction: colorFraction(value, range), text: (value / 10 ** shift).toFixed(decimals) })),
      };
    }
  }
}

/** Log scale: the powers of 10 (every n-th of them for more than `maximumCount`); in less than one decade 1, 2 and 5 × 10^k */
function logTicks(range: ColorRange, maximumCount: number): ScalarBarTicks {
  const { min, max } = range;
  const lowest = Math.ceil(Math.log10(min) - STEP_TOLERANCE);
  const highest = Math.floor(Math.log10(max) + STEP_TOLERANCE);
  if (highest > lowest) {
    const every = Math.ceil((highest - lowest + 1) / maximumCount);
    const exponents = multiples(lowest, highest, every);
    if (exponents.length >= 2) {
      return {
        factorExponent: null,
        ticks: exponents.map((exponent) => ({ fraction: colorFraction(10 ** exponent, range), text: powerOfTenText(exponent) })),
      };
    }
  }
  const ticks: ScalarBarTick[] = [];
  for (let exponent = Math.floor(Math.log10(min)); exponent <= highest; exponent++) {
    for (const mantissa of [1, 2, 5]) {
      const value = mantissa * 10 ** exponent;
      if (value >= min * (1 - STEP_TOLERANCE) && value <= max * (1 + STEP_TOLERANCE)) {
        const text = exponent === 0 || exponent === 1 ? String(value) : `${mantissa === 1 ? "" : `${mantissa}×`}${powerOfTenText(exponent)}`;
        ticks.push({ fraction: colorFraction(value, range), text });
      }
    }
  }
  return ticks.length >= 2 ? { factorExponent: null, ticks } : endTicks(range);
}

/** The ticks of a scalar bar: round values at their place (at most `maximumCount`); one value: one tick */
export function scalarBarTicks(range: ColorRange, maximumCount: number): ScalarBarTicks {
  if (!(range.max > range.min)) {
    return { factorExponent: null, ticks: [{ fraction: 0, text: shortText(range.min) }] };
  }
  return range.isLog ? logTicks(range, maximumCount) : linearTicks(range, maximumCount);
}

/** A merged tube around each path */
export interface TubeArrays {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

function subtract(a: number[], b: number[]): number[] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: number[], b: number[]): number[] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalized(vector: number[]): number[] | null {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  return length === 0 ? null : vector.map((component) => component / length);
}

/** The points of a path with no two equal points after each other */
function distinctPathPoints(points: ArrayLike<number>, firstPoint: number, count: number): number[][] {
  const path: number[][] = [];
  for (let index = firstPoint; index < firstPoint + count; index++) {
    const point = [points[3 * index], points[3 * index + 1], points[3 * index + 2]];
    const last = path.at(-1);
    if (last === undefined || subtract(point, last).some((component) => component !== 0)) {
      path.push(point);
    }
  }
  return path;
}

/** A vector at a right angle to `direction` */
function perpendicular(direction: number[]): number[] {
  const axis = Math.abs(direction[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return normalized(cross(direction, axis)) ?? [0, 0, 1];
}

/**
 * The tubes of paths. `points` are relative to an origin. The ring of the sides
 * at each point keeps its turn from the last point, thus a tube does not twist.
 */
export function pathTubes(points: ArrayLike<number>, pointCounts: ArrayLike<number>, radius: number, sideCount: number): TubeArrays {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let firstPoint = 0;
  for (let pathIndex = 0; pathIndex < pointCounts.length; pathIndex++) {
    const path = distinctPathPoints(points, firstPoint, pointCounts[pathIndex]);
    firstPoint += pointCounts[pathIndex];
    if (path.length < 2) {
      continue;
    }
    const firstVertex = positions.length / 3;
    let side = perpendicular(normalized(subtract(path[1], path[0])) ?? [1, 0, 0]);
    path.forEach((point, index) => {
      const previous = path[Math.max(0, index - 1)];
      const next = path[Math.min(path.length - 1, index + 1)];
      const direction = normalized(subtract(next, previous)) ?? [1, 0, 0];
      side = normalized(cross(cross(direction, side), direction)) ?? perpendicular(direction);
      const other = cross(direction, side);
      for (let corner = 0; corner < sideCount; corner++) {
        const angle = (2 * Math.PI * corner) / sideCount;
        const normal = [0, 1, 2].map((axis) => Math.cos(angle) * side[axis] + Math.sin(angle) * other[axis]);
        positions.push(...normal.map((component, axis) => point[axis] + radius * component));
        normals.push(...normal);
      }
    });
    for (let ring = 0; ring + 1 < path.length; ring++) {
      for (let corner = 0; corner < sideCount; corner++) {
        const a = firstVertex + ring * sideCount + corner;
        const b = firstVertex + ring * sideCount + (corner + 1) % sideCount;
        indices.push(a, b, a + sideCount, b, b + sideCount, a + sideCount);
      }
    }
  }
  return { positions: Float32Array.from(positions), normals: Float32Array.from(normals), indices: Uint32Array.from(indices) };
}

/** The diagonal of the bounds of the points; 0 without points */
export function boundsDiagonal(points: ArrayLike<number>): number {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < points.length; index++) {
    min[index % 3] = Math.min(min[index % 3], points[index]);
    max[index % 3] = Math.max(max[index % 3], points[index]);
  }
  return points.length === 0 ? 0 : Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
}

/** The length of each 3D vector of a list of components (x, y, z of each vector one after the other) */
export function vectorMagnitudes(components: ArrayLike<number>): Float64Array {
  const magnitudes = new Float64Array(Math.floor(components.length / 3));
  for (let index = 0; index < magnitudes.length; index++) {
    magnitudes[index] = Math.hypot(components[3 * index], components[3 * index + 1], components[3 * index + 2]);
  }
  return magnitudes;
}

/** Largest move of the pointer (pixels) between down and up which is a click, not a camera move */
const CLICK_DISTANCE = 4;

/** True if the pointer went up near the place where it went down: a click, not a drag */
export function isClick(down: { x: number; y: number }, up: { x: number; y: number }): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) <= CLICK_DISTANCE;
}

/**
 * The position of a point of the view in normalized device coordinates
 * (-1 to 1, y up), from its position in the client area of the canvas
 */
export function deviceCoordinates(
  client: { x: number; y: number },
  canvas: { left: number; top: number; width: number; height: number },
): [number, number] {
  return [((client.x - canvas.left) / canvas.width) * 2 - 1, 1 - ((client.y - canvas.top) / canvas.height) * 2];
}
