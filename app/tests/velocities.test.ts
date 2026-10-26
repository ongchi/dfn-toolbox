// The velocity arrays of "Color by": the magnitudes of the flow velocity of
// each triangle, and the mean speed of the transport at each mesh point.
import { expect, test } from "vitest";
import { addArray, vectorMagnitudes } from "../src/flow/polyData";
import { nodeVelocityMagnitudes } from "../src/transport/velocities";

// One triangle with 3 points
const MESH = `<Piece NumberOfPoints="3" NumberOfCells="1">
<PointData>
</PointData>
<CellData>
</CellData>
</Piece>`;

/** A `velocities.vtp` text with these nodes and velocities (3 components each) */
function velocitiesVtp(nodes: number[], velocities: number[]): string {
  return `<PointData>
<DataArray type="Float64" Name="velocity" NumberOfComponents="3" format="ascii">${velocities.join(" ")}</DataArray>
<DataArray type="Int64" Name="node" format="ascii">${nodes.join(" ")}</DataArray>
</PointData>`;
}

test("the magnitude of each vector is its length", () => {
  expect(vectorMagnitudes([3, 4, 0, 0, 0, 2])).toEqual([5, 2]);
});

test("a cell array is added to the cell data", () => {
  expect(addArray(MESH, "cell", "speed", [1.5])).toContain(
    '<CellData>\n<DataArray type="Float64" Name="speed" format="ascii">1.5</DataArray>\n</CellData>',
  );
});

test("an array with a wrong number of values is an error", () => {
  expect(() => addArray(MESH, "point", "speed", [1, 2])).toThrow("2 values for 3 points");
});

test("the transport speed of a point is the mean of its sectors", () => {
  const vtp = velocitiesVtp([0, 0, 2], [1, 0, 0, 3, 0, 0, 0, 2, 0]);
  expect(nodeVelocityMagnitudes(vtp, 3, "seconds")).toEqual([2, 0, 2]);
});

test("the transport speed is in m/s", () => {
  const vtp = velocitiesVtp([0], [0, 0, 86400]);
  expect(nodeVelocityMagnitudes(vtp, 1, "days")).toEqual([1]);
});

test("a node which is not a point of the mesh is an error", () => {
  expect(() => nodeVelocityMagnitudes(velocitiesVtp([3], [1, 0, 0]), 3, "seconds")).toThrow("the node 3");
});
