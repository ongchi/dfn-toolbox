// The shapes of the regions of the predefined domain meshes for the 3D view.
import { expect, test } from "vitest";
import { regionOuterFaces } from "../src/regions";
import { readMesh } from "./cases";

// One hexahedron (cell 0) and a tetrahedron on its face x = 1 (cell 1), both in the region "both"; only the
// hexahedron is in the region "hexahedron". The fourth point of the tetrahedron is at x = 2.
const TWO_CELLS = `<VTKFile type="UnstructuredGrid"><UnstructuredGrid><Piece NumberOfPoints="9" NumberOfCells="2">
<CellData>
<DataArray type="Int32" Name="region__both" format="ascii">1 1</DataArray>
<DataArray type="Int32" Name="region__hexahedron" format="ascii">1 0</DataArray>
</CellData>
<Points><DataArray type="Float64" NumberOfComponents="3" format="ascii">
0 0 0 1 0 0 1 1 0 0 1 0 0 0 1 1 0 1 1 1 1 0 1 1 2 0.5 0.5
</DataArray></Points>
<Cells>
<DataArray type="Int64" Name="connectivity" format="ascii">0 1 2 3 4 5 6 7 1 2 6 8</DataArray>
<DataArray type="Int64" Name="offsets" format="ascii">8 12</DataArray>
<DataArray type="UInt8" Name="types" format="ascii">12 10</DataArray>
</Cells>
</Piece></UnstructuredGrid></VTKFile>`;

test("the region of one box has its 6 faces", () => {
  expect(regionOuterFaces(readMesh("L-shape.vtu"), "north_box").vertexCounts).toEqual([4, 4, 4, 4, 4, 4]);
});

test("the common face of two boxes of a region is not an outer face", () => {
  expect(regionOuterFaces(readMesh("L-shape.vtu"), "other_boxes").vertexCounts.length).toBe(10);
});

test("the region of the Box mesh is the cube", () => {
  expect(regionOuterFaces(readMesh("Box.vtu"), "box").vertexCounts.length).toBe(6);
});

test("a triangle of a tetrahedron is not a common face of a quad of a hexahedron", () => {
  // The triangle 1 2 6 is on the quad 1 2 6 5, but it is another face: 6 quads and 4 triangles
  expect(regionOuterFaces(TWO_CELLS, "both").vertexCounts.length).toBe(10);
});

test("only the cells of the region give faces", () => {
  expect(regionOuterFaces(TWO_CELLS, "hexahedron").vertexCounts).toEqual([4, 4, 4, 4, 4, 4]);
});

test("the shape keeps all points of the mesh", () => {
  expect(regionOuterFaces(TWO_CELLS, "both").points.length).toBe(3 * 9);
});

test("a missing region is an error", () => {
  expect(() => regionOuterFaces(TWO_CELLS, "west_box")).toThrow(/west_box/);
});
