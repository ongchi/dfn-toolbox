// The polygons of the user-defined fractures against the steps of dfngen-rs,
// and the bounding boxes of the regions of the predefined meshes.
import { describe, expect, test } from "vitest";
import { defaultUserFracture, type OrientationConvention, type PlaneOrientationState, type UserFractureState } from "../src/form/state";
import { meshRegionBounds } from "../src/inputFiles";
import { anglesOfNormal, convertOrientation, fractureVertices, planeNormal, userFracturesToVtp } from "../src/userFractures";
import { readMesh } from "./cases";

const TOLERANCE = 1e-12;

function fracture(changes: Partial<UserFractureState>): UserFractureState {
  return { ...defaultUserFracture("box", [0, 0, 0]), ...changes };
}

function expectPoints(actual: number[][], expected: number[][]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((point, index) =>
    point.forEach((value, axis) => expect(Math.abs(value - expected[index][axis])).toBeLessThan(TOLERANCE)),
  );
}

// The rectangle of the test of `Poly::new` in dfngen-rs: radius √2, aspect ratio 2
const RECTANGLE = { numberOfPoints: 4, radius: Math.SQRT2, aspectRatio: 2 };

test("four points with the normal +z give the rectangle of Poly::new", () => {
  expectPoints(fractureVertices(fracture(RECTANGLE), "theta_phi"), [
    [1, 2, 0],
    [-1, 2, 0],
    [-1, -2, 0],
    [1, -2, 0],
  ]);
});

test("beta turns the polygon in its plane as Poly::rotation_2d", () => {
  expectPoints(fractureVertices(fracture({ ...RECTANGLE, beta: 90 }), "theta_phi"), [
    [2, -1, 0],
    [2, 1, 0],
    [-2, 1, 0],
    [-2, -1, 0],
  ]);
});

test("the center moves the polygon", () => {
  const [first] = fractureVertices(fracture({ ...RECTANGLE, center: [10, 20, 30] }), "theta_phi");
  expectPoints([first], [[11, 22, 30]]);
});

test("the normal -z is a half turn about y, as rotation_between", () => {
  const orientation: PlaneOrientationState = { firstAngle: 180, secondAngle: 0 };
  expectPoints(fractureVertices(fracture({ ...RECTANGLE, orientation }), "theta_phi").slice(0, 1), [[-1, 2, 0]]);
});

test("the normal +y puts the polygon in the plane y = 0 with its x side along x", () => {
  const orientation: PlaneOrientationState = { firstAngle: 90, secondAngle: 90 };
  expectPoints(fractureVertices(fracture({ ...RECTANGLE, orientation }), "theta_phi"), [
    [1, 0, -2],
    [-1, 0, -2],
    [-1, 0, 2],
    [1, 0, 2],
  ]);
});

test.each<[OrientationConvention, number, number, number[]]>([
  ["theta_phi", 90, 0, [1, 0, 0]],
  ["trend_plunge", 0, 0, [0, -1, 0]],
  ["trend_plunge", 90, 0, [-1, 0, 0]],
  ["trend_plunge", 17, 90, [0, 0, 1]],
  ["dip_strike", 0, 63, [0, 0, 1]],
  ["dip_strike", 90, 0, [1, 0, 0]],
  ["dip_strike", 90, 90, [0, -1, 0]],
])("the normal of %s %d, %d is the normal of dfngen-rs", (convention, firstAngle, secondAngle, expected) => {
  expectPoints([planeNormal({ firstAngle, secondAngle }, convention)], [expected]);
});

const CONVENTIONS: OrientationConvention[] = ["theta_phi", "trend_plunge", "dip_strike"];

describe.each(CONVENTIONS)("from %s", (from) => {
  test.each(CONVENTIONS)("to %s, the converted angles give the same normal", (to) => {
    for (const orientation of [
      { firstAngle: 35, secondAngle: 120 },
      { firstAngle: 70, secondAngle: -40 },
      { firstAngle: 10, secondAngle: 300 },
    ]) {
      const converted = convertOrientation(orientation, from, to);
      expect(Math.max(...planeNormal(converted, to).map((value, axis) => Math.abs(value - planeNormal(orientation, from)[axis])))).toBeLessThan(1e-7);
    }
  });
});

test.each<[OrientationConvention, PlaneOrientationState]>([
  ["theta_phi", { firstAngle: 90, secondAngle: 0 }],
  ["trend_plunge", { firstAngle: 270, secondAngle: 0 }],
  ["dip_strike", { firstAngle: 90, secondAngle: 0 }],
])("the normal +x in %s has round angles", (convention, expected) => {
  expect(anglesOfNormal([1, 0, 0], convention)).toEqual(expected);
});

test("a vertical normal has the azimuth 0", () => {
  expect(anglesOfNormal([0, 0, 1], "theta_phi")).toEqual({ firstAngle: 0, secondAngle: 0 });
});

test("each vertex is in the plane of the normal", () => {
  const orientation: PlaneOrientationState = { firstAngle: 35, secondAngle: 120 };
  const normal = planeNormal(orientation, "dip_strike");
  for (const vertex of fractureVertices(fracture({ numberOfPoints: 7, radius: 3, beta: 20, orientation }), "dip_strike")) {
    expect(Math.abs(vertex[0] * normal[0] + vertex[1] * normal[1] + vertex[2] * normal[2])).toBeLessThan(TOLERANCE);
  }
});

test("the polygon file has one region array for each region of the mesh", () => {
  const text = userFracturesToVtp([fracture({ region: "east" }), fracture({ region: "west" })], "theta_phi", ["west", "east"]);
  expect(text).toMatch(/Name="region__west" NumberOfComponents="1" format="ascii">\n0 1\n/);
  expect(text).toMatch(/Name="region__east" NumberOfComponents="1" format="ascii">\n1 0\n/);
  expect(text).toMatch(/NumberOfPoints="8" .*NumberOfPolys="2"/);
});

test("the polygon file has the aperture of each fracture", () => {
  const text = userFracturesToVtp([fracture({ aperture: 2e-4 }), fracture({ aperture: 3e-4 })], "theta_phi", ["box"]);
  expect(text).toMatch(/Name="aperture" NumberOfComponents="1" format="ascii">\n0.0002 0.0003\n/);
});

test("a region which is not in the mesh is an error", () => {
  expect(() => userFracturesToVtp([fracture({ region: "north" })], "theta_phi", ["west"])).toThrow(/north/);
});

test("the region boxes of the L-shape mesh are the boxes of their cells", () => {
  expect(meshRegionBounds(readMesh("L-shape.vtu"))).toEqual([
    { name: "west_box", min: [10, 20, 30], max: [15, 25, 35] },
    { name: "east_box", min: [20, 20, 30], max: [25, 25, 35] },
    { name: "other_boxes", min: [10, 20, 30], max: [20, 30, 35] },
  ]);
});

test("the region of the Box mesh is the cube", () => {
  expect(meshRegionBounds(readMesh("Box.vtu"))).toEqual([{ name: "box", min: [0, 0, 0], max: [10, 10, 10] }]);
});
