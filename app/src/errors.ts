// The errors of dfngen, fehm and dfntrans (`ErrorReport` of dfn-wasm) as
// text for the user: the words of the forms (panel, section, field), in place
// of the input keys and file names of the libraries. A kind which the user
// cannot cause (the file format, a defect) is an internal error.
import type { ErrorReport } from "./pkg/dfn_wasm.js";

/** An error of a library, as the worker sends it to the page */
export interface ToolError {
  /** `<library>.<variant>`, for example `dfngen.Family.NumberOfPoints` */
  kind: string;
  /** The text of the library */
  message: string;
  /** The values of the error (family, region, boundary, …), as text */
  fields: Record<string, string>;
}

/** The plain object of an `ErrorReport` (it can go from the worker to the page) */
export function toToolError(report: ErrorReport): ToolError {
  const names: string[] = report.field_names;
  const values: string[] = report.field_values;
  return {
    kind: report.kind,
    message: report.message,
    fields: Object.fromEntries(names.map((name, index) => [name, values[index]])),
  };
}

type Fields = Record<string, string>;

const FAMILY = (fields: Fields) => `Family ${fields.family} (Fractures panel)`;
const USER_FRACTURE = (fields: Fields) => `Fracture ${fields.fracture} (Fractures panel)`;
const MESH_SECTION = "Fractures panel, Advanced, Triangle mesh for the flow";
const APERTURE_VALUES =
  "the aperture values are not valid. The aperture and the factor α must be above 0, and the standard deviation must not be negative.";

/** The text of each kind which the user can cause */
const TEXTS: Record<string, (fields: Fields) => string> = {
  "dfngen.MinFeatureSize": () => "Minimum feature size (Settings, Fracture shape) must be greater than 0.",
  "dfngen.Family.UnknownRegion": (f) => `${FAMILY(f)}: the domain has no region ${f.region}. Choose another region.`,
  "dfngen.Family.EmptyRegion": (f) =>
    `${FAMILY(f)}: the region ${f.region} has no cell in the domain. Choose another region.`,
  // One value for all fractures (settings dialog): the family is the first one which dfngen checks
  "dfngen.Family.NumberOfPoints": () => "Number of points (Settings, Fracture shape) must be 3 or more.",
  "dfngen.Family.AspectRatio": (f) => `${FAMILY(f)}: Aspect ratio must be greater than 0.`,
  "dfngen.Family.OrientationPair": (f) => `${FAMILY(f)}: the orientation must have one pair of angles.`,
  "dfngen.Family.P32TargetMissing": (f) =>
    `${FAMILY(f)}: set a P32 target. The stop condition "P32 target of each family" needs one for each family.`,
  "dfngen.Family.P32TargetNotAllowed": (f) =>
    `${FAMILY(f)}: the stop condition "Number of fractures" uses no P32 target. Remove the target.`,
  "dfngen.Family.Aperture": (f) => `${FAMILY(f)}: ${APERTURE_VALUES}`,
  "dfngen.FamilyRadius.LogNormalSigma": (f) =>
    `${FAMILY(f)}: the standard deviation of the radius must be greater than 0.`,
  "dfngen.FamilyRadius.LogNormalRange": (f) =>
    `${FAMILY(f)}: the radius range is too far from the mean of ln(r). Move the minimum and the maximum nearer to the mean.`,
  "dfngen.FamilyRadius.LogNormalInefficient": (f) =>
    `${FAMILY(f)}: too many radii are outside the range. Set Sampling to "Inverse CDF".`,
  "dfngen.FamilyRadius.ExponentialMean": (f) => `${FAMILY(f)}: the mean of the radius must be greater than 0.`,
  "dfngen.FamilyRadius.ExponentialRange": (f) =>
    `${FAMILY(f)}: the minimum and the maximum radius are not valid for the exponential distribution.`,
  "dfngen.FamilyRadius.Inefficient": (f) =>
    `${FAMILY(f)}: too many radii are smaller than the minimum radius. Increase the minimum radius.`,
  "dfngen.InefficientSampling": () =>
    "Too many radii are smaller than the minimum radius. Increase the minimum radius of the families (Fractures panel).",
  "dfngen.UserFracture.UnknownRegion": (f) =>
    `${USER_FRACTURE(f)}: the domain has no region ${f.region}. Choose another region.`,
  "dfngen.UserFracture.EmptyRegion": (f) =>
    `${USER_FRACTURE(f)}: the region ${f.region} has no cell in the domain. Choose another region.`,
  "dfngen.UserFracture.Aperture": (f) => `${USER_FRACTURE(f)}: Aperture must be greater than 0.`,
  "dfngen.ClustersNeedBoundarySurfaces": () =>
    "The domain shape has no boundary surfaces: the network keeps only the clusters which connect an in-flow and an out-flow surface. Choose another domain shape (Domain panel).",
  // dfn-toolbox gives dfngen the in-flow surfaces as group 1, the out-flow surfaces as group 2
  "dfngen.EmptyClusterSurfaceGroup": (f) =>
    `Set at least one ${f.group === "1" ? "in-flow" : "out-flow"} surface (Domain panel, Boundary surfaces).`,
  "dfngen.UnknownClusterSurface": (f) =>
    `The domain has no boundary surface ${f.name}. Choose the roles of the surfaces again (Domain panel).`,
  "dfngen.MeshMaxSizeFactor": () => `Maximum size factor (${MESH_SECTION}) must be 1 or more.`,
  "dfngen.MeshSlope": () => `Slope (${MESH_SECTION}) must be greater than 0.`,
  "dfngen.NoFractureDefined": () =>
    "There is no fracture. Add a fracture family or a user-defined fracture (Fractures panel).",
  "dfngen.NoIntersectingFractures": () =>
    "No fractures intersect. Increase the number of fractures or their size (Fractures panel), or decrease Minimum feature size.",
  "dfngen.Mesh": (f) => `The triangle mesh of the network failed. Try another seed (Fractures panel, General). Details: ${f.message}`,
  "dfngen.CheckpointInputChanged": () =>
    "The input changed during the run: the network needs a new generation. Click “Reset”, then “Run”.",

  "fehm.TemperatureRange": (f) => `Temperature (Flow panel, Fluid) must be ${f.min} to ${f.max} °C.`,
  "fehm.NoBoundaryDefined": () =>
    "The network has no point on an in-flow or out-flow surface. Change the roles of the surfaces (Domain panel), or generate another network.",
  "fehm.PressureRange": (f) => `The pressure of the boundary ${f.boundary} (Flow panel) must be ${f.min} to ${f.max} MPa.`,
  "fehm.UnknownBoundary": (f) =>
    `The boundary ${f.boundary} is not in the network. Generate the network again.`,
  "fehm.EmptyBoundary": (f) =>
    `The boundary ${f.boundary} has no point in the network. Change its role (Domain panel), or generate another network.`,
  "fehm.BoundaryWithoutEffect": (f) =>
    `Each point of the boundary ${f.boundary} is on an earlier boundary with another pressure. Change its role (Domain panel).`,
  "fehm.SolverTolerance": () => "The tolerance of the flow solver must be above 0 and below 1.",
  "fehm.SolverMaxIterations": () => "The maximum iterations of the flow solver must be 1 or more.",
  "fehm.DegenerateTriangle": () => "The network has a triangle with no area. Generate another network.",
  "fehm.NoBoundary": (f) =>
    `The fractures ${f.fractures} have no connection to an in-flow or out-flow surface, thus their pressure has no unique value. Change the roles of the surfaces (Domain panel), or generate another network.`,
  "fehm.NoConvergence": (f) =>
    `The flow did not converge in ${f.iterations} iterations. Check the pressures (Flow panel), or generate another network.`,

  "dfntrans.Porosity": () => "Porosity (Transport panel) must be above 0 and at most 1.",
  "dfntrans.MaxTimeSteps": () => "Maximum time steps (Transport panel) must be 1 or more.",
  "dfntrans.InflowOutflowMissing": () =>
    "The network needs a point on an in-flow and on an out-flow surface. Change the roles of the surfaces (Domain panel), or generate another network.",
  "dfntrans.BoundaryInInflowAndOutflow": (f) => `The boundary ${f.boundary} cannot be in-flow and out-flow.`,
  "dfntrans.ParticleCount": () => "The number of particles (Transport panel, Seeding) must be 1 or more.",
  "dfntrans.NoSeedingPoints": () =>
    "The seeding has no release point. Click “Pick points” (Transport panel, Seeding), then click on a fracture.",
  "dfntrans.MatrixPorosity": () => "The matrix porosity must be above 0 and at most 1.",
  "dfntrans.MatrixDiffusivity": () => "The matrix diffusivity must be above 0.",
  "dfntrans.EmptyInflowOutflow": () =>
    "The in-flow or the out-flow surfaces have no point in the network. Change the roles of the surfaces (Domain panel).",
  "dfntrans.UnknownBoundary": (f) =>
    `The boundary ${f.boundary} is not in the network. Change its role (Domain panel), or generate the network again.`,
  "dfntrans.NoSeededParticle": () =>
    "The seeding places no particle. Check the in-flow surfaces (Domain panel) and the seeding (Transport panel).",
  "dfntrans.NoCellForSeeding": () =>
    "Each cell has a point on the out-flow surfaces, thus the seeding cannot place a particle. Change the roles of the surfaces (Domain panel).",
  "dfntrans.SeedingPointOutsideMesh": (f) =>
    `Release point ${f.index} ${f.point} is not on the triangle mesh. Remove it (Transport panel, Seeding) and click on a fracture again.`,
  "dfntrans.NoInflowFlux": (f) =>
    `The flow into the network at the in-flow surfaces is ${f.volume_flux} m³/s, not above 0. Change the pressures (Flow panel): the in-flow pressure must be higher.`,
};

/** The text of an error for the user */
export function toolErrorText(error: ToolError): string {
  const text = TEXTS[error.kind];
  return text === undefined ? `Internal error: ${error.message}` : text({ ...error.fields, message: error.message });
}
