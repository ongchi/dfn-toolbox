// The descriptions of the predefined domain meshes.
import { expect, test } from "vitest";
import { meshDescription } from "../src/inputFiles";
import { readMesh } from "./cases";

test("the box mesh has its description on one line", () => {
  expect(meshDescription(readMesh("Box.vtu"))).toBe(
    "A cube of 10 m, from (0, 0, 0) to (10, 10, 10), with the region box. Each face is a boundary surface: west (x = 0), east (x = 10), south (y = 0), north (y = 10), bottom (z = 0) and top (z = 10).",
  );
});

test("the L-shaped mesh has a description", () => {
  expect(meshDescription(readMesh("L-shape.vtu"))).toMatch(/^An L shape of four boxes of 5 m: .* top \(z = 35\)\.$/);
});

test("a mesh without a description comment has an empty description", () => {
  expect(meshDescription('<?xml version="1.0"?>\n<!-- Cells 0 to 2: hexahedra. -->\n<VTKFile/>')).toBe("");
});
