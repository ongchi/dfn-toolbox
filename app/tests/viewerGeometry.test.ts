// The shapes of the 3D view, as arrays.
import { expect, test } from "vitest";
import {
  boundaryEdges,
  boundsDiagonal,
  cellEdges,
  cellTriangles,
  domainEdges,
  localPositions,
  pathTubes,
  scalarBarValues,
  tableColor,
  valueRange,
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

test("the outline has only the edges of one cell", () => {
  const cells = { vertexCounts: [3, 3], connectivity: [0, 1, 2, 2, 1, 3] };
  const pairs = boundaryEdges(cells, 4);
  expect(pairs.length).toBe(2 * 4);
  expect(Array.from({ length: pairs.length / 2 }, (_, index) => [pairs[2 * index], pairs[2 * index + 1]])).not.toContainEqual([1, 2]);
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

test("the color table goes from blue to red", () => {
  expect(tableColor(0)[2]).toBe(1);
  expect(tableColor(0)[0]).toBeCloseTo(0, 2);
  expect(tableColor(1)).toEqual([1, 0, 0]);
});

test("the scalar bar has evenly spaced values from the largest value", () => {
  expect(scalarBarValues(valueRange([0, 4, 2]), 5)).toEqual([4, 3, 2, 1, 0]);
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
