// State of the transport form: `[transport]` of the workflow file. It follows
// the input format of `../dfntrans-rs/src/io/input.rs` (see "Input file" of
// ../dfntrans-rs/README.md): a change of a key there needs a change here, in
// `toml.ts` and in `form.ts`. The in-flow and out-flow boundaries are those
// of `[boundaries]` (Domain tab).

/** Name of the flow file in the TOML; the flow is that of the last "Solve flow" */
export const TRANSPORT_FLOW_FILE = "flow.toml";

export type TimeUnit = "seconds" | "minutes" | "hours" | "days" | "years";
export type RoutingRule = "complete_mixing" | "streamline_routing";
export type SeedingMethod = "uniform_per_line" | "equidistant" | "random" | "flux_weighted" | "at_nodes";

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
  seeding: SeedingState;
}

export function defaultTransportState(): TransportState {
  return {
    seed: 12345,
    timeUnit: "days",
    porosity: 1.0,
    maxTimeSteps: 1000000,
    routing: "complete_mixing",
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
