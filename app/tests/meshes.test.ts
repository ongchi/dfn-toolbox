// The descriptions of the predefined domain meshes.
import { expect, test } from "vitest";
import { meshDescription } from "../src/inputFiles";
import { readMesh } from "./cases";

test("the box mesh has its description on one line", () => {
  expect(meshDescription(readMesh("Box.vtu"))).toBe(
    "A cube of 10 m, from (0, 0, 0) to (10, 10, 10), with the region box. The face at x = 0 is the boundary surface west, the face at x = 10 the boundary surface east.",
  );
});

test("the L-shaped mesh has a description", () => {
  expect(meshDescription(readMesh("L-shape.vtu"))).toMatch(/^An L shape of four boxes of 5 m: .* boundary surface east\.$/);
});

test("a mesh without a description comment has an empty description", () => {
  expect(meshDescription('<?xml version="1.0"?>\n<!-- Cells 0 to 2: hexahedra. -->\n<VTKFile/>')).toBe("");
});
