// State of the transport form: `[transport]` of the workflow file. It follows
// the input format of `../dfntrans-rs/src/io/input.rs` (see "Input file" of
// ../dfntrans-rs/README.md): a change of a key there needs a change here, in
// `toml.ts` and in `form.ts`.

/** Name of the flow file in the TOML; the flow is that of the last "Solve flow" */
export const TRANSPORT_FLOW_FILE = "flow.toml";

export type TimeUnit = "seconds" | "minutes" | "hours" | "days" | "years";
export type RoutingRule = "complete_mixing" | "streamline_routing";
export type SeedingMethod = "uniform_per_line" | "equidistant" | "random" | "flux_weighted" | "at_nodes";
export type Axis = "x" | "y" | "z";
export type ControlShape = "none" | "plane" | "cylinder";
export type BoundaryRole = "none" | "inflow" | "outflow";

export interface TransportBoundaryState {
  /** `<name>` of the point data array `boundary__<name>` of the mesh */
  name: string;
  role: BoundaryRole;
}

/** The keys of all methods; the TOML has only the keys of `method` */
export interface SeedingState {
  method: SeedingMethod;
  /** uniform_per_line, equidistant */
  particlesPerLine: number;
  /** uniform_per_line, equidistant */
  isWeightedByFlux: boolean;
  /** random, flux_weighted */
  particleCount: number;
  /** at_nodes */
  particlesPerNode: number;
}

export interface MatrixDiffusionState {
  /** Written into the TOML (`[tdrw]`) only when it is used */
  isUsed: boolean;
  matrixPorosity: number;
  /** m²/s */
  matrixDiffusivity: number;
}

/** The keys of both shapes; the TOML has only the keys of `shape` */
export interface ControlSurfacesState {
  shape: ControlShape;
  /** plane: `direction`; cylinder: `axis` */
  axis: Axis;
  /** m */
  spacing: number;
  /** m, cylinder */
  lengthToWell: number;
  /** m, cylinder */
  wellThickness: number;
}

export interface TransportState {
  /** 0 = a random seed for each run */
  seed: number;
  timeUnit: TimeUnit;
  porosity: number;
  maxTimeSteps: number;
  routing: RoutingRule;
  /** One for each boundary array of the mesh, in the order of the mesh file */
  boundaries: TransportBoundaryState[];
  seeding: SeedingState;
  matrixDiffusion: MatrixDiffusionState;
  controlSurfaces: ControlSurfacesState;
  hasTrajectories: boolean;
  hasAllParticles: boolean;
  hasVelocities: boolean;
}

export function defaultTransportState(): TransportState {
  return {
    seed: 12345,
    timeUnit: "days",
    porosity: 1.0,
    maxTimeSteps: 1000000,
    routing: "complete_mixing",
    boundaries: [],
    seeding: {
      method: "flux_weighted",
      particlesPerLine: 10,
      isWeightedByFlux: true,
      particleCount: 1000,
      particlesPerNode: 1,
    },
    matrixDiffusion: { isUsed: false, matrixPorosity: 0.02, matrixDiffusivity: 1e-13 },
    controlSurfaces: { shape: "none", axis: "x", spacing: 1.0, lengthToWell: 10.0, wellThickness: 0.5 },
    hasTrajectories: false,
    hasAllParticles: false,
    hasVelocities: false,
  };
}

/**
 * One boundary for each name; a boundary with the same name keeps its role.
 * A used boundary of no name stays at the end: dfntrans reports it as an error.
 */
export function updateTransportBoundaries(state: TransportState, names: string[]): void {
  const previous = new Map(state.boundaries.map((boundary) => [boundary.name, boundary]));
  const missing = state.boundaries.filter((boundary) => boundary.role !== "none" && !names.includes(boundary.name));
  state.boundaries = [...names.map((name) => previous.get(name) ?? { name, role: "none" as const }), ...missing];
}
