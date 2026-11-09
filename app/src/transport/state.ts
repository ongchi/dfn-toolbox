// State of the transport form: `[transport]` of the workflow file. It follows
// the input format of `../dfntrans-rs/src/io/input.rs` (see "Input file" of
// ../dfntrans-rs/README.md): a change of a key there needs a change here, in
// `toml.ts` and in `form.ts`. The in-flow and out-flow boundaries are those
// of `[boundaries]` (Domain panel).

/** Name of the flow file in the TOML; the flow is that of the last "Solve flow" */
export const TRANSPORT_FLOW_FILE = "flow.toml";

export type TimeUnit = "seconds" | "minutes" | "hours" | "days" | "years";
export type RoutingRule = "complete_mixing" | "streamline_routing";

/** x, y, z in the coordinates of the mesh */
export type ReleasePoint = [number, number, number];

/** The particles start only at the release points, picked on the fractures of the 3D view (user decision) */
export interface SeedingState {
  points: ReleasePoint[];
  particlesPerPoint: number;
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
    seeding: { points: [], particlesPerPoint: 1 },
  };
}
