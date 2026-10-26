// The boundary surfaces of the predefined domain meshes, as PolyData text for the viewer.
import { expect, test } from "vitest";
import { boundarySurfacePolyData, domainBoundarySurfaceNames } from "../src/boundarySurfaces";
import { dataArrayValues } from "../src/inputFiles";
import { readMesh } from "./cases";

test("the box mesh has the boundary surfaces west and east", () => {
  expect(domainBoundarySurfaceNames(readMesh("Box.vtu"))).toEqual(["west", "east"]);
});

test("the L-shaped mesh has the boundary surfaces north and east", () => {
  expect(domainBoundarySurfaceNames(readMesh("L-shape.vtu"))).toEqual(["north", "east"]);
});

test("the surface west of the box is its quad at x = 0", () => {
  const polyData = boundarySurfacePolyData(readMesh("Box.vtu"), "west");
  expect(dataArrayValues(polyData, "connectivity")).toEqual([0, 3, 7, 4]);
});

test("the surface of a boundary has one polygon for each of its surface cells", () => {
  const polyData = boundarySurfacePolyData(readMesh("L-shape.vtu"), "east");
  expect(polyData).toContain('NumberOfPolys="1"');
  expect(dataArrayValues(polyData, "offsets")).toEqual([4]);
});

test("the surface keeps all points of the mesh", () => {
  expect(boundarySurfacePolyData(readMesh("L-shape.vtu"), "north")).toContain('NumberOfPoints="20"');
});

test("a missing boundary surface is an error", () => {
  expect(() => boundarySurfacePolyData(readMesh("Box.vtu"), "south")).toThrow("south");
});
