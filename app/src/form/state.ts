// State of the input form: one field for each key of the input file (see the
// section "Input file" of README.md). This is a second copy of the input
// format of `src/io/input.rs`: a change of a key there needs a change here,
// in `toml.ts` and in the form files.

export type StopCondition = "n_poly" | "p32";

export interface GenerationState {
  stopCondition: StopCondition;
  nPoly: number;
  forceLargeFractures: boolean;
  removeFracturesLessThan: number;
}

export interface FramState {
  enable: boolean;
  relaxed: boolean;
  tripleIntersections: boolean;
  checkUserFractures: boolean;
  writeRejectedFractures: boolean;
  rejectsPerFracture: number;
}

export interface ClustersState {
  keepOnlyLargest: boolean;
  keepIsolatedFractures: boolean;
}

export type LogNormalSampling = "rejection" | "inverse_cdf";

export type RadiusState =
  | { distribution: "log_normal"; logMean: number; sd: number; min: number; max: number; sampling: LogNormalSampling | null }
  | { distribution: "truncated_power_law"; alpha: number; min: number; max: number }
  | { distribution: "exponential"; mean: number; min: number; max: number }
  | { distribution: "constant"; value: number };

export type RadiusDistribution = RadiusState["distribution"];

/** The pair of angles of the orientation, in the names of the input keys */
export type OrientationConvention = "theta_phi" | "trend_plunge" | "dip_strike";

export interface OrientationState {
  convention: OrientationConvention;
  /** theta, trend or dip, in degrees */
  firstAngle: number;
  /** phi, plunge or strike, in degrees */
  secondAngle: number;
  kappa: number;
}

export interface FamilyState {
  numberOfPoints: number;
  probability: number;
  aspectRatio: number;
  /** Name of a region of the mesh; null = whole mesh (no key) */
  region: string | null;
  /** Degrees; null = uniform rotation (no key) */
  beta: number | null;
  /** Written only for the stop condition P32 */
  p32Target: number;
  radius: RadiusState;
  orientation: OrientationState;
}

export interface FormState {
  /** Decimal digits of a u64; "0" = random seed */
  seed: string;
  minFeatureSize: number;
  /** Name of the domain mesh file, as in the `domain` key */
  domain: string;
  /** Name of the user-defined fracture file; null = no key */
  userFractures: string | null;
  generation: GenerationState;
  fram: FramState;
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
    numberOfPoints: 8,
    probability: 1.0,
    aspectRatio: 1.0,
    region: null,
    beta: null,
    p32Target: 0.5,
    radius: defaultRadius("truncated_power_law"),
    orientation: { convention: "theta_phi", firstAngle: 0.0, secondAngle: 0.0, kappa: 8.0 },
  };
}

export function defaultFormState(): FormState {
  return {
    seed: "12345",
    minFeatureSize: 0.1,
    domain: "",
    userFractures: null,
    generation: { stopCondition: "n_poly", nPoly: 100, forceLargeFractures: false, removeFracturesLessThan: 0.0 },
    fram: { ...FRAM_DEFAULTS, enable: true },
    clusters: { keepOnlyLargest: false, keepIsolatedFractures: false },
    families: [defaultFamily()],
  };
}
