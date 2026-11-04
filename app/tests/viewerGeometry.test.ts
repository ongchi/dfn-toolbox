// The shapes of the 3D view, as arrays.
import { expect, test } from "vitest";
import {
  boundsDiagonal,
  cellEdges,
  cellTriangles,
  colorFraction,
  colorRange,
  domainEdges,
  localPositions,
  pathTubes,
  powerOfTenText,
  scalarBarTicks,
  scalarBarTitle,
  tableColor,
} from "../src/viewerGeometry";

test("the positions are relative to the center of their bounds", () => {
  const { origin, positions } = localPositions([1000000, 0, 5, 1000002, 4, 5]);
  expect(origin).toEqual([1000001, 2, 5]);
  expect([...positions]).toEqual([-1, -2, 0, 1, 2, 0]);
});

test("a triangle stays one triangle", () => {
  const { corners, cells } = cellTriangles({ points: [0, 0, 0, 1, 0, 0, 0, 1, 0], vertexCounts: [3], connectivity: [0, 1, 2] });
  expect([[...corners], [...cells]]).toEqual([[0, 1, 2], [0]]);
});

test("a polygon with n points in a tilted plane has n - 2 triangles of its cell", () => {
  const points = [0, 0, 0, 2, 0, 2, 2, 2, 2, 0, 2, 0];
  const { cells } = cellTriangles({ points, vertexCounts: [3, 4], connectivity: [0, 1, 2, 0, 1, 2, 3] });
  expect([...cells]).toEqual([0, 1, 1]);
});

test("the triangles of a concave polygon stay in the polygon", () => {
  // An L shape in the plane z = 0: the corner (1, 1) goes in
  const points = [0, 0, 0, 2, 0, 0, 2, 1, 0, 1, 1, 0, 1, 2, 0, 0, 2, 0];
  const { corners } = cellTriangles({ points, vertexCounts: [6], connectivity: [0, 1, 2, 3, 4, 5] });
  const areas = [0, 3, 6, 9].map((start) => {
    const [a, b, c] = [corners[start], corners[start + 1], corners[start + 2]];
    const value = (point: number, axis: number) => points[3 * point + axis];
    return Math.abs((value(b, 0) - value(a, 0)) * (value(c, 1) - value(a, 1)) - (value(c, 0) - value(a, 0)) * (value(b, 1) - value(a, 1))) / 2;
  });
  expect(areas.reduce((sum, area) => sum + area)).toBeCloseTo(3);
});

test("an edge of two cells is one line", () => {
  const cells = { vertexCounts: [3, 3], connectivity: [0, 1, 2, 2, 1, 3] };
  expect(cellEdges(cells, 4).length).toBe(2 * 5);
});

test.each([
  [10, 4, 6],
  [11, 8, 12],
  [12, 8, 12],
  [13, 6, 9],
  [14, 5, 8],
  [9, 4, 4],
  [5, 3, 3],
])("a cell of VTK type %i has its edges", (type, pointCount, edgeCount) => {
  const connectivity = Array.from({ length: pointCount }, (_, index) => index);
  expect(domainEdges(connectivity, [pointCount], [type], pointCount).length).toBe(2 * edgeCount);
});

test("the color table is Turbo: dark ends, blue, green in the middle, red", () => {
  expect(Math.max(...tableColor(0))).toBeLessThan(0.2);
  const [lowRed, lowGreen, lowBlue] = tableColor(0.1);
  const [middleRed, middleGreen, middleBlue] = tableColor(0.5);
  const [highRed, highGreen, highBlue] = tableColor(1);
  expect(lowBlue).toBeGreaterThan(Math.max(lowRed, lowGreen));
  expect(middleGreen).toBeGreaterThan(Math.max(middleRed, middleBlue));
  expect(highRed).toBeGreaterThan(Math.max(highGreen, highBlue));
  expect(highRed).toBeLessThan(0.6);
});

test("the colors stay in the range 0 to 1", () => {
  const components = Array.from({ length: 1001 }, (_, index) => tableColor(index / 1000)).flat();
  expect(Math.min(...components)).toBeGreaterThanOrEqual(0);
  expect(Math.max(...components)).toBeLessThanOrEqual(1);
});

const tickTexts = (values: number[], isLog: boolean) => scalarBarTicks(colorRange(values, isLog), 5).ticks.map(({ text }) => text);

test("a linear scale has round ticks at their places", () => {
  expect(scalarBarTicks(colorRange([0, 4.5], false), 5).ticks).toEqual([
    { fraction: 0, text: "0" },
    { fraction: 1 / 4.5, text: "1" },
    { fraction: 2 / 4.5, text: "2" },
    { fraction: 3 / 4.5, text: "3" },
    { fraction: 4 / 4.5, text: "4" },
  ]);
});

test("the labels of a linear scale have the decimals of the step", () => {
  expect(tickTexts([10.0, 10.1], false)).toEqual(["10.00", "10.05", "10.10"]);
});

test("small values of a linear scale share a power of 10 in the title", () => {
  const { factorExponent, ticks } = scalarBarTicks(colorRange([1.1e-8, 3.97e-4], false), 5);
  expect([factorExponent, ticks.map(({ text }) => text)]).toEqual([-4, ["1", "2", "3"]]);
});

test("values from 0.001 to 0.1 have no shared power", () => {
  expect(tickTexts([1e-8, 0.0397], false)).toEqual(["0.01", "0.02", "0.03"]);
});

test("a log scale has a tick at each power of 10", () => {
  expect(tickTexts([1.1e-6, 3.97e-2], true)).toEqual(["10⁻⁵", "10⁻⁴", "10⁻³", "10⁻²"]);
});

test("a log scale of many powers of 10 has a tick at every second one", () => {
  expect(tickTexts([1.1e-8, 3.97e-2], true)).toEqual(["10⁻⁶", "10⁻⁴", "10⁻²"]);
});

test("a log scale within one decade has ticks 1, 2 and 5 times a power of 10", () => {
  expect(tickTexts([1.5e-3, 9e-3], true)).toEqual(["2×10⁻³", "5×10⁻³"]);
});

test("one value gives one tick", () => {
  expect(scalarBarTicks(colorRange([7, 7], false), 5).ticks).toEqual([{ fraction: 0, text: "7" }]);
});

test("the title has the power of 10 before the unit", () => {
  expect([scalarBarTitle("flow velocity", "m/s", -4), scalarBarTitle("aperture", null, -4), scalarBarTitle("pressure", "MPa", null)]).toEqual([
    "flow velocity (×10⁻⁴ m/s)",
    "aperture (×10⁻⁴)",
    "pressure (MPa)",
  ]);
});

test("the powers 0 and 1 are 1 and 10", () => {
  expect([0, 1, 2, -12].map(powerOfTenText)).toEqual(["1", "10", "10²", "10⁻¹²"]);
});

test("a linear scale places a value in proportion", () => {
  expect(colorFraction(3, colorRange([2, 3, 4], false))).toBe(0.5);
});

test("a log scale places a value by its order of magnitude", () => {
  expect(colorFraction(10, colorRange([1, 100], true))).toBeCloseTo(0.5);
});

test("a log scale starts at the smallest positive value", () => {
  expect(colorRange([-1, 0, 2, 8], true)).toEqual({ min: 2, max: 8, isLog: true });
});

test.each([0, -3])("the value %d has the lowest color on a log scale", (value) => {
  expect(colorFraction(value, colorRange([value, 1, 10], true))).toBe(0);
});

test("equal values have the lowest color", () => {
  expect(colorFraction(5, colorRange([5, 5], true))).toBe(0);
});

test("an array with no positive value has a linear scale", () => {
  expect(colorRange([-2, 0], true)).toEqual({ min: -2, max: 0, isLog: false });
});

test("a tube has a ring of points at each path point", () => {
  const { positions, indices } = pathTubes([0, 0, 0, 1, 0, 0, 1, 1, 0], [3], 0.1, 8);
  expect(positions.length).toBe(3 * 3 * 8);
  expect(indices.length).toBe(2 * 8 * 6);
});

test("each point of a straight tube is at the radius from the path", () => {
  const { positions } = pathTubes([0, 0, 0, 2, 0, 0], [2], 0.5, 6);
  for (let index = 0; index < positions.length; index += 3) {
    expect(Math.hypot(positions[index + 1], positions[index + 2])).toBeCloseTo(0.5);
  }
});

test("a path of one repeated point has no tube", () => {
  expect(pathTubes([1, 1, 1, 1, 1, 1], [2], 0.1, 8).positions.length).toBe(0);
});

test("the diagonal of the bounds", () => {
  expect(boundsDiagonal([0, 0, 0, 3, 4, 0])).toBe(5);
});
