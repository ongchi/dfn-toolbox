// The user-defined fractures of the form as the polygon file of dfngen
// (`user_fractures`). dfngen-rs reads user-defined fractures only as
// polygons, thus each fracture is made here in the same way as dfngen-rs
// makes a stochastic fracture (`FractureFamily::create_poly`), with fixed
// values in place of the random ones.

import type { OrientationConvention, PlaneOrientationState, UserFractureState } from "./form/state";

/** The name of the polygon file in the dfngen input */
export const USER_FRACTURES_FILE = "user_fractures.vtp";

type Vector = [number, number, number];

const DEGREES = Math.PI / 180;

/** Below this length, the cross product of two unit vectors is zero (`f64::EPSILON` of nalgebra) */
const PARALLEL_TOLERANCE = Number.EPSILON;

function dot(a: Vector, b: Vector): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vector, b: Vector): Vector {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function length(vector: Vector): number {
  return Math.sqrt(dot(vector, vector));
}

function scale(vector: Vector, factor: number): Vector {
  return [vector[0] * factor, vector[1] * factor, vector[2] * factor];
}

/**
 * The unit normal of a plane from its pair of angles. Ports of
 * `Fisher::new_with_theta_phi`, `normal_from_trend_plunge` and
 * `normal_from_dip_strike` (dfngen-rs `distribution/fisher.rs`, `geometry.rs`).
 */
export function planeNormal(orientation: PlaneOrientationState): Vector {
  const first = orientation.firstAngle * DEGREES;
  const second = orientation.secondAngle * DEGREES;
  const normals: Record<OrientationConvention, () => Vector> = {
    theta_phi: () => [Math.sin(first) * Math.cos(second), Math.sin(first) * Math.sin(second), Math.cos(first)],
    trend_plunge: () => [-Math.sin(first) * Math.cos(second), -Math.cos(first) * Math.cos(second), Math.sin(second)],
    dip_strike: () => [Math.sin(first) * Math.cos(second), -Math.sin(first) * Math.sin(second), Math.cos(first)],
  };
  const normal = normals[orientation.convention]();
  return scale(normal, 1 / length(normal));
}

/** Rotation of `vector` about the unit vector `axis` by `angle` (radians), Rodrigues' formula */
function rotateAbout(vector: Vector, axis: Vector, angle: number): Vector {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const across = cross(axis, vector);
  const along = dot(axis, vector) * (1 - cosine);
  return [0, 1, 2].map((index) => vector[index] * cosine + across[index] * sine + axis[index] * along) as Vector;
}

/**
 * Rotation which turns +z to the unit vector `to`. Port of `rotation_between`
 * (dfngen-rs `geometry.rs`, with `Rotation3::rotation_between` of nalgebra):
 * the opposite vector is a half turn about z × x.
 */
function rotationFromZ(to: Vector): (vector: Vector) => Vector {
  const from: Vector = [0, 0, 1];
  const axis = cross(from, to);
  const sine = length(axis);
  if (sine > PARALLEL_TOLERANCE) {
    const unitAxis = scale(axis, 1 / sine);
    const angle = Math.atan2(sine, dot(from, to));
    return (vector) => rotateAbout(vector, unitAxis, angle);
  }
  if (dot(from, to) > 0) {
    return (vector) => vector;
  }
  const halfTurnAxis = scale(cross(from, [1, 0, 0]), 1 / length(cross(from, [1, 0, 0])));
  return (vector) => rotateAbout(vector, halfTurnAxis, Math.PI);
}

/**
 * The vertices of a user-defined fracture, in the coordinates of the mesh.
 * The steps of `FractureFamily::create_poly` (dfngen-rs
 * `fracture/fracture_family.rs`): `Poly::new` (a regular polygon, y scaled by
 * the aspect ratio), `rotation_2d(beta)`, the rotation from +z to the
 * normal, and the translation to the center.
 */
export function fractureVertices(fracture: UserFractureState): Vector[] {
  const angleStep = (2 * Math.PI) / fracture.numberOfPoints;
  const beta = fracture.beta * DEGREES;
  const rotate = rotationFromZ(planeNormal(fracture.orientation));
  return Array.from({ length: fracture.numberOfPoints }, (_, index): Vector => {
    // `Poly::new`: the first vertex is half a step from the x axis
    const angle = angleStep * (index + 0.5);
    const x = fracture.radius * Math.cos(angle);
    const y = fracture.radius * fracture.aspectRatio * Math.sin(angle);
    // `Poly::rotation_2d`
    const turned: Vector = [x * Math.cos(beta) + y * Math.sin(beta), -x * Math.sin(beta) + y * Math.cos(beta), 0];
    const [rotatedX, rotatedY, rotatedZ] = rotate(turned);
    return [rotatedX + fracture.center[0], rotatedY + fracture.center[1], rotatedZ + fracture.center[2]];
  });
}

function dataArray(name: string, type: string, components: number, values: (number | string)[]): string {
  return [
    `<DataArray type="${type}" Name="${name}" NumberOfComponents="${components}" format="ascii">`,
    values.join(" "),
    "</DataArray>",
  ].join("\n");
}

/**
 * The polygon file of the fractures (ASCII VTK PolyData, as dfngen-rs reads
 * it): one polygon cell for each fracture, and one cell array
 * `region__<name>` for each region of the mesh (1 for the region of the
 * fracture). The region of each fracture must be one of `regionNames`.
 */
export function userFracturesToVtp(fractures: UserFractureState[], regionNames: string[]): string {
  const unknown = fractures.find((fracture) => !regionNames.includes(fracture.region));
  if (unknown !== undefined) {
    throw new Error(`the region ${unknown.region} of a user-defined fracture is not in the domain mesh`);
  }
  const vertices = fractures.map(fractureVertices);
  const points = vertices.flat();
  const offsets = vertices.map((_, index) => vertices.slice(0, index + 1).reduce((sum, polygon) => sum + polygon.length, 0));
  return [
    '<?xml version="1.0"?>',
    '<VTKFile type="PolyData" version="1.0" byte_order="LittleEndian">',
    "<PolyData>",
    `<Piece NumberOfPoints="${points.length}" NumberOfVerts="0" NumberOfLines="0" NumberOfStrips="0" NumberOfPolys="${fractures.length}">`,
    "<CellData>",
    ...regionNames.map((name) =>
      dataArray(
        `region__${name}`,
        "Int32",
        1,
        fractures.map((fracture) => (fracture.region === name ? 1 : 0)),
      ),
    ),
    "</CellData>",
    "<Points>",
    dataArray("points", "Float64", 3, points.flat()),
    "</Points>",
    "<Polys>",
    dataArray("connectivity", "Int64", 1, points.map((_, index) => index)),
    dataArray("offsets", "Int64", 1, offsets),
    "</Polys>",
    "</Piece>",
    "</PolyData>",
    "</VTKFile>",
    "",
  ].join("\n");
}
