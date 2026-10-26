// The polygons of the user-defined fractures against the steps of dfngen-rs,
// and the bounding boxes of the regions of the predefined meshes.
import { expect, test } from "vitest";
import { defaultUserFracture, type PlaneOrientationState, type UserFractureState } from "../src/form/state";
import { meshRegionBounds } from "../src/inputFiles";
import { fractureVertices, planeNormal, userFracturesToVtp } from "../src/userFractures";
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
  expectPoints(fractureVertices(fracture(RECTANGLE)), [
    [1, 2, 0],
    [-1, 2, 0],
    [-1, -2, 0],
    [1, -2, 0],
  ]);
});

test("beta turns the polygon in its plane as Poly::rotation_2d", () => {
  expectPoints(fractureVertices(fracture({ ...RECTANGLE, beta: 90 })), [
    [2, -1, 0],
    [2, 1, 0],
    [-2, 1, 0],
    [-2, -1, 0],
  ]);
});

test("the center moves the polygon", () => {
  const [first] = fractureVertices(fracture({ ...RECTANGLE, center: [10, 20, 30] }));
  expectPoints([first], [[11, 22, 30]]);
});

test("the normal -z is a half turn about y, as rotation_between", () => {
  const orientation: PlaneOrientationState = { convention: "theta_phi", firstAngle: 180, secondAngle: 0 };
  expectPoints(fractureVertices(fracture({ ...RECTANGLE, orientation })).slice(0, 1), [[-1, 2, 0]]);
});

test("the normal +y puts the polygon in the plane y = 0 with its x side along x", () => {
  const orientation: PlaneOrientationState = { convention: "theta_phi", firstAngle: 90, secondAngle: 90 };
  expectPoints(fractureVertices(fracture({ ...RECTANGLE, orientation })), [
    [1, 0, -2],
    [-1, 0, -2],
    [-1, 0, 2],
    [1, 0, 2],
  ]);
});

test.each<[PlaneOrientationState, number[]]>([
  [{ convention: "theta_phi", firstAngle: 90, secondAngle: 0 }, [1, 0, 0]],
  [{ convention: "trend_plunge", firstAngle: 0, secondAngle: 0 }, [0, -1, 0]],
  [{ convention: "trend_plunge", firstAngle: 90, secondAngle: 0 }, [-1, 0, 0]],
  [{ convention: "trend_plunge", firstAngle: 17, secondAngle: 90 }, [0, 0, 1]],
  [{ convention: "dip_strike", firstAngle: 0, secondAngle: 63 }, [0, 0, 1]],
  [{ convention: "dip_strike", firstAngle: 90, secondAngle: 0 }, [1, 0, 0]],
  [{ convention: "dip_strike", firstAngle: 90, secondAngle: 90 }, [0, -1, 0]],
])("the normal of %o is the normal of dfngen-rs", (orientation, expected) => {
  expectPoints([planeNormal(orientation)], [expected]);
});

test("each vertex is in the plane of the normal", () => {
  const orientation: PlaneOrientationState = { convention: "dip_strike", firstAngle: 35, secondAngle: 120 };
  const normal = planeNormal(orientation);
  for (const vertex of fractureVertices(fracture({ numberOfPoints: 7, radius: 3, beta: 20, orientation }))) {
    expect(Math.abs(vertex[0] * normal[0] + vertex[1] * normal[1] + vertex[2] * normal[2])).toBeLessThan(TOLERANCE);
  }
});

test("the polygon file has one region array for each region of the mesh", () => {
  const text = userFracturesToVtp([fracture({ region: "east" }), fracture({ region: "west" })], ["west", "east"]);
  expect(text).toMatch(/Name="region__west" NumberOfComponents="1" format="ascii">\n0 1\n/);
  expect(text).toMatch(/Name="region__east" NumberOfComponents="1" format="ascii">\n1 0\n/);
  expect(text).toMatch(/NumberOfPoints="8" .*NumberOfPolys="2"/);
});

test("the polygon file has the aperture of each fracture", () => {
  const text = userFracturesToVtp([fracture({ aperture: 2e-4 }), fracture({ aperture: 3e-4 })], ["box"]);
  expect(text).toMatch(/Name="aperture" NumberOfComponents="1" format="ascii">\n0.0002 0.0003\n/);
});

test("a region which is not in the mesh is an error", () => {
  expect(() => userFracturesToVtp([fracture({ region: "north" })], ["west"])).toThrow(/north/);
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
