// Conversion between the transport form state and `[transport]` of the
// workflow file, and the dfntrans input file of the transport (dfntrans
// checks the values).
import { nameList, type BoundaryRoles } from "../boundaryRoles";
import { float, integer, string, TableReader, tablesToToml, type Table, type TomlTable } from "../form/toml";
import {
  defaultTransportState,
  TRANSPORT_FLOW_FILE,
  type RoutingRule,
  type SeedingState,
  type TimeUnit,
  type TransportState,
} from "./state";

const TIME_UNITS: readonly TimeUnit[] = ["seconds", "minutes", "hours", "days", "years"];
const ROUTING_RULES: readonly RoutingRule[] = ["complete_mixing", "streamline_routing"];

function seedingLines(seeding: SeedingState): string[] {
  return [
    `points = [${seeding.points.map((point) => `[${point.map(float).join(", ")}]`).join(", ")}]`,
    `particles_per_point = ${integer(seeding.particlesPerPoint)}`,
  ];
}

/** The tables of `[transport]` of the workflow file */
export function transportTables(state: TransportState): TomlTable[] {
  return [
    {
      name: "",
      isArray: false,
      lines: [
        `seed = ${integer(state.seed)}`,
        `time_unit = ${string(state.timeUnit)}`,
        `porosity = ${float(state.porosity)}`,
        `max_time_steps = ${integer(state.maxTimeSteps)}`,
        `routing = ${string(state.routing)}`,
      ],
    },
    { name: "seeding", isArray: false, lines: seedingLines(state.seeding) },
  ];
}

/**
 * The trajectories and the velocities are always on in dfn-toolbox (the 3D view
 * shows them), thus the workflow file has no section for the output; the
 * dfntrans input needs it
 */
const OUTPUT_TABLE: TomlTable = {
  name: "output",
  isArray: false,
  lines: ["trajectories = true", "all_particles = false", "velocities = true"],
};

/**
 * The dfntrans input file of the transport, on the flow of the last "Solve
 * flow". `boundaries`: the in-flow and out-flow surfaces with a point in the mesh.
 */
export function transportToLibraryToml(state: TransportState, boundaries: BoundaryRoles): string {
  const [root, seeding] = transportTables(state);
  const flowRoot = {
    ...root,
    lines: [
      `flow = ${string(TRANSPORT_FLOW_FILE)}`,
      ...root.lines,
      `inflow = ${nameList(boundaries.inflow)}`,
      `outflow = ${nameList(boundaries.outflow)}`,
    ],
  };
  // The workflow file has only one seeding method: dfntrans needs its name
  const librarySeeding = { ...seeding, lines: ['method = "points"', ...seeding.lines] };
  return tablesToToml([flowRoot, librarySeeding, OUTPUT_TABLE], "");
}

function readSeeding(table: Table, problems: string[]): SeedingState {
  const seeding = defaultTransportState().seeding;
  const reader = new TableReader(table, "[transport.seeding]", problems);
  seeding.points = reader.points("points");
  seeding.particlesPerPoint = reader.integer("particles_per_point", seeding.particlesPerPoint);
  reader.checkUnknownKeys();
  return seeding;
}

/** Reads `[transport]` of the workflow file */
export function readTransport(table: Table, problems: string[]): TransportState {
  const defaults = defaultTransportState();
  const reader = new TableReader(table, "[transport]", problems);
  const state: TransportState = {
    seed: reader.integer("seed", defaults.seed),
    timeUnit: reader.choice("time_unit", TIME_UNITS, defaults.timeUnit),
    porosity: reader.float("porosity", defaults.porosity),
    maxTimeSteps: reader.integer("max_time_steps", defaults.maxTimeSteps),
    routing: reader.choice("routing", ROUTING_RULES, defaults.routing),
    seeding: readSeeding(reader.subTable("seeding"), problems),
  };
  reader.checkUnknownKeys();
  return state;
}
