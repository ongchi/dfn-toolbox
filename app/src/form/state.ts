// State of the network form: one field for each key of `[network]` of the
// workflow file (see `workflow.ts`). It follows the input
// format of `../dfngen-rs/src/io/input.rs`, with the boundary lines and the
// mesh always on: a change of a key there needs a change here, in `toml.ts`
// and in the form files.

export type StopCondition = "n_poly" | "p32";

export interface GenerationState {
  stopCondition: StopCondition;
  nPoly: number;
}

export interface FramState {
  enable: boolean;
  relaxed: boolean;
  tripleIntersections: boolean;
  checkUserFractures: boolean;
  writeRejectedFractures: boolean;
  rejectsPerFracture: number;
}

export type ApertureState =
  | { distribution: "constant"; value: number }
  | { distribution: "log_normal"; logMean: number; sd: number }
  | { distribution: "correlated"; alpha: number; beta: number }
  | { distribution: "semi_correlated"; alpha: number; beta: number; sd: number };

export type ApertureDistribution = ApertureState["distribution"];

/** Always on: the flow needs the mesh */
export interface MeshState {
  maxSizeFactor: number;
  slope: number;
}

export interface ClustersState {
  keepOnlyLargest: boolean;
}

export type LogNormalSampling = "rejection" | "inverse_cdf";

export type RadiusState =
  | { distribution: "log_normal"; logMean: number; sd: number; min: number; max: number; sampling: LogNormalSampling | null }
  | { distribution: "truncated_power_law"; alpha: number; min: number; max: number }
  | { distribution: "exponential"; mean: number; min: number; max: number }
  | { distribution: "constant"; value: number };

export type RadiusDistribution = RadiusState["distribution"];

/** The pair of angles of each orientation (`orientation_option` of `[network]`), in the names of the input keys */
export type OrientationConvention = "theta_phi" | "trend_plunge" | "dip_strike";

/** The orientation of a plane: the pair of angles of its normal, in the convention of the page */
export interface PlaneOrientationState {
  /** theta, trend or dip, in degrees */
  firstAngle: number;
  /** phi, plunge or strike, in degrees */
  secondAngle: number;
}

/** The orientation of a family: the mean normal and the Fisher concentration */
export interface OrientationState extends PlaneOrientationState {
  kappa: number;
}

export interface FamilyState {
  probability: number;
  aspectRatio: number;
  /** Name of a region of the mesh; null = whole mesh (no key) */
  region: string | null;
  /** Degrees; null = uniform rotation (no key) */
  beta: number | null;
  /** Written only for the stop condition P32 */
  p32Target: number;
  /** Necessary: the mesh is always on */
  aperture: ApertureState;
  radius: RadiusState;
  orientation: OrientationState;
}

/**
 * One user-defined fracture (`[[network.user_fracture]]`): a polygon made as
 * a stochastic fracture of dfngen-rs, with fixed values (see `userFractures.ts`)
 */
export interface UserFractureState {
  /** Name of a region of the mesh; necessary */
  region: string;
  /** x, y, z in the coordinates of the mesh; in the bounding box of the region */
  center: [number, number, number];
  radius: number;
  aspectRatio: number;
  /** Rotation in the plane of the fracture, in degrees */
  beta: number;
  /** Aperture (m), above 0; necessary: the mesh is always on */
  aperture: number;
  orientation: PlaneOrientationState;
}

export interface FormState {
  /** Decimal digits of a u64; "0" = random seed */
  seed: string;
  minFeatureSize: number;
  /** Name of the domain mesh file, as in the `domain` key */
  domain: string;
  /** The pair of angles of all families and user-defined fractures (settings dialog) */
  orientationConvention: OrientationConvention;
  /** The number of points of each family and user-defined fracture (settings dialog); 3 or more, 4 = rectangle */
  numberOfPoints: number;
  userFractures: UserFractureState[];
  generation: GenerationState;
  fram: FramState;
  mesh: MeshState;
  clusters: ClustersState;
  families: FamilyState[];
}

export const ORIENTATION_KEYS: Record<OrientationConvention, [string, string]> = {
  theta_phi: ["theta", "phi"],
  trend_plunge: ["trend", "plunge"],
  dip_strike: ["dip", "strike"],
};

/** Default values of `[fram]`, as in `FramSection::default` */
export const FRAM_DEFAULTS: FramState = {
  enable: false,
  relaxed: false,
  tripleIntersections: false,
  checkUserFractures: false,
  writeRejectedFractures: false,
  rejectsPerFracture: 10,
};

/** Default values of `[network.mesh]` (necessary keys in the dfngen input) */
export const MESH_DEFAULTS: MeshState = {
  maxSizeFactor: 10.0,
  slope: 0.5,
};

export function defaultAperture(distribution: ApertureDistribution): ApertureState {
  switch (distribution) {
    case "constant":
      return { distribution, value: 1e-4 };
    case "log_normal":
      return { distribution, logMean: -9.0, sd: 0.5 };
    case "correlated":
      return { distribution, alpha: 1e-4, beta: 0.5 };
    case "semi_correlated":
      return { distribution, alpha: 1e-4, beta: 0.5, sd: 0.5 };
  }
}

export function defaultRadius(distribution: RadiusDistribution): RadiusState {
  switch (distribution) {
    case "log_normal":
      return { distribution, logMean: 0.5, sd: 0.5, min: 1.0, max: 5.0, sampling: null };
    case "truncated_power_law":
      return { distribution, alpha: 2.5, min: 1.0, max: 5.0 };
    case "exponential":
      return { distribution, mean: 2.0, min: 1.0, max: 5.0 };
    case "constant":
      return { distribution, value: 2.0 };
  }
}

export function defaultFamily(): FamilyState {
  return {
    probability: 1.0,
    aspectRatio: 1.0,
    region: null,
    beta: null,
    p32Target: 0.5,
    aperture: defaultAperture("constant"),
    radius: defaultRadius("truncated_power_law"),
    orientation: { firstAngle: 0.0, secondAngle: 0.0, kappa: 8.0 },
  };
}

/** A new user-defined fracture: a square of 1 m with the normal +z */
export function defaultUserFracture(region: string, center: [number, number, number]): UserFractureState {
  return {
    region,
    center,
    radius: 1.0,
    aspectRatio: 1.0,
    beta: 0.0,
    aperture: 1e-4,
    orientation: { firstAngle: 0.0, secondAngle: 0.0 },
  };
}

export function defaultFormState(): FormState {
  return {
    seed: "12345",
    minFeatureSize: 0.1,
    domain: "",
    orientationConvention: "theta_phi",
    numberOfPoints: 8,
    userFractures: [],
    generation: { stopCondition: "n_poly", nPoly: 100 },
    fram: { ...FRAM_DEFAULTS },
    mesh: { ...MESH_DEFAULTS },
    clusters: { keepOnlyLargest: false },
    families: [defaultFamily()],
  };
}
