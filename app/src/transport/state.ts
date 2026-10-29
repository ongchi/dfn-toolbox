// State of the transport form: `[transport]` of the workflow file. It follows
// the input format of `../dfntrans-rs/src/io/input.rs` (see "Input file" of
// ../dfntrans-rs/README.md): a change of a key there needs a change here, in
// `toml.ts` and in `form.ts`.

/** Name of the flow file in the TOML; the flow is that of the last "Solve flow" */
export const TRANSPORT_FLOW_FILE = "flow.toml";

export type TimeUnit = "seconds" | "minutes" | "hours" | "days" | "years";
export type RoutingRule = "complete_mixing" | "streamline_routing";
export type SeedingMethod = "uniform_per_line" | "equidistant" | "random" | "flux_weighted" | "at_nodes";
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
      method: "uniform_per_line",
      // Few particles: the trajectories have about 1 MB for each particle
      particlesPerLine: 3,
      isWeightedByFlux: true,
      particleCount: 50,
      particlesPerNode: 1,
    },
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
