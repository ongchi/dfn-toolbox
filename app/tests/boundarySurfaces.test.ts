// The boundary surfaces of the predefined domain meshes, as PolyData text for the viewer.
import { expect, test } from "vitest";
import { boundarySurfaceCells, domainBoundarySurfaceNames, domainWireframe } from "../src/boundarySurfaces";
import { readMesh } from "./cases";

test("the box mesh has a boundary surface for each face, west and east first", () => {
  expect(domainBoundarySurfaceNames(readMesh("Box.vtu"))).toEqual(["west", "east", "south", "north", "bottom", "top"]);
});

test("the L-shaped mesh has a boundary surface for each plane of its faces, north and east first", () => {
  expect(domainBoundarySurfaceNames(readMesh("L-shape.vtu"))).toEqual([
    "north",
    "east",
    "west",
    "south",
    "inner_east",
    "inner_north",
    "bottom",
    "top",
  ]);
});

test("the faces of the L-shaped mesh on one plane are one surface", () => {
  const polygonCount = (name: string) => boundarySurfaceCells(readMesh("L-shape.vtu"), name).vertexCounts.length;
  expect(["west", "south", "inner_north", "bottom", "top"].map(polygonCount)).toEqual([2, 3, 2, 4, 4]);
});

test("the surface west of the box is its quad at x = 0", () => {
  expect(boundarySurfaceCells(readMesh("Box.vtu"), "west").connectivity).toEqual([0, 3, 7, 4]);
});

test("the surface of a boundary has one polygon for each of its surface cells", () => {
  expect(boundarySurfaceCells(readMesh("L-shape.vtu"), "east").vertexCounts).toEqual([4]);
});

test("the surface keeps all points of the mesh", () => {
  expect(boundarySurfaceCells(readMesh("L-shape.vtu"), "north").points.length).toBe(3 * 20);
});

test("a missing boundary surface is an error", () => {
  expect(() => boundarySurfaceCells(readMesh("Box.vtu"), "nowhere")).toThrow("nowhere");
});

test("the wireframe of the box has the 12 edges of its cube once", () => {
  expect(domainWireframe(readMesh("Box.vtu")).edges.length).toBe(2 * 12);
});
