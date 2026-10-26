// Conversion between the transport form state and `[transport]` of the
// workflow file, and the dfntrans input file of the transport (dfntrans
// checks the values).
import { float, integer, string, TableReader, tablesToToml, type Table, type TomlTable } from "../form/toml";
import {
  defaultTransportState,
  TRANSPORT_FLOW_FILE,
  type BoundaryRole,
  type RoutingRule,
  type SeedingMethod,
  type SeedingState,
  type TimeUnit,
  type TransportBoundaryState,
  type TransportState,
} from "./state";

const TIME_UNITS: readonly TimeUnit[] = ["seconds", "minutes", "hours", "days", "years"];
const ROUTING_RULES: readonly RoutingRule[] = ["complete_mixing", "streamline_routing"];
const SEEDING_METHODS: readonly SeedingMethod[] = ["uniform_per_line", "equidistant", "random", "flux_weighted", "at_nodes"];

function boundaryNames(state: TransportState, role: BoundaryRole): string {
  const names = state.boundaries.filter((boundary) => boundary.role === role).map((boundary) => string(boundary.name));
  return `[${names.join(", ")}]`;
}

function seedingLines(seeding: SeedingState): string[] {
  const lines = [`method = ${string(seeding.method)}`];
  switch (seeding.method) {
    case "uniform_per_line":
    case "equidistant":
      lines.push(`particles_per_line = ${integer(seeding.particlesPerLine)}`);
      lines.push(`weight_by_flux = ${seeding.isWeightedByFlux}`);
      break;
    case "random":
    case "flux_weighted":
      lines.push(`particle_count = ${integer(seeding.particleCount)}`);
      break;
    case "at_nodes":
      lines.push(`particles_per_node = ${integer(seeding.particlesPerNode)}`);
      break;
  }
  return lines;
}

/** The tables of `[transport]` of the workflow file */
export function transportTables(state: TransportState): TomlTable[] {
  const tables: TomlTable[] = [
    {
      name: "",
      isArray: false,
      lines: [
        `seed = ${integer(state.seed)}`,
        `time_unit = ${string(state.timeUnit)}`,
        `porosity = ${float(state.porosity)}`,
        `max_time_steps = ${integer(state.maxTimeSteps)}`,
        `inflow = ${boundaryNames(state, "inflow")}`,
        `outflow = ${boundaryNames(state, "outflow")}`,
        `routing = ${string(state.routing)}`,
      ],
    },
    { name: "seeding", isArray: false, lines: seedingLines(state.seeding) },
  ];

  const diffusion = state.matrixDiffusion;
  if (diffusion.isUsed) {
    tables.push({
      name: "tdrw",
      isArray: false,
      lines: [
        `matrix_porosity = ${float(diffusion.matrixPorosity)}`,
        `matrix_diffusivity = ${float(diffusion.matrixDiffusivity)}`,
      ],
    });
  }
  return tables;
}

/**
 * The trajectories and the velocities are always on in dfn-web (the 3D view
 * shows them), thus the workflow file has no section for the output; the
 * dfntrans input needs it
 */
const OUTPUT_TABLE: TomlTable = {
  name: "output",
  isArray: false,
  lines: ["trajectories = true", "all_particles = false", "velocities = true"],
};

/** The dfntrans input file of the transport, on the flow of the last "Solve flow" */
export function transportToLibraryToml(state: TransportState): string {
  const [root, ...others] = transportTables(state);
  const flowRoot = { ...root, lines: [`flow = ${string(TRANSPORT_FLOW_FILE)}`, ...root.lines] };
  return tablesToToml([flowRoot, ...others, OUTPUT_TABLE], "");
}

function readSeeding(table: Table, problems: string[]): SeedingState {
  const seeding = defaultTransportState().seeding;
  const reader = new TableReader(table, "[transport.seeding]", problems);
  seeding.method = reader.choice("method", SEEDING_METHODS, seeding.method);
  switch (seeding.method) {
    case "uniform_per_line":
    case "equidistant":
      seeding.particlesPerLine = reader.integer("particles_per_line", seeding.particlesPerLine);
      seeding.isWeightedByFlux = reader.boolean("weight_by_flux", seeding.isWeightedByFlux);
      break;
    case "random":
    case "flux_weighted":
      seeding.particleCount = reader.integer("particle_count", seeding.particleCount);
      break;
    case "at_nodes":
      seeding.particlesPerNode = reader.integer("particles_per_node", seeding.particlesPerNode);
      break;
  }
  reader.checkUnknownKeys();
  return seeding;
}

/**
 * Reads `[transport]` of the workflow file. The boundaries are the names of
 * `inflow` and `outflow`; the mesh of the generation adds its other boundaries.
 */
export function readTransport(table: Table, problems: string[]): TransportState {
  const defaults = defaultTransportState();
  const reader = new TableReader(table, "[transport]", problems);
  const boundaries: TransportBoundaryState[] = [
    ...reader.stringArray("inflow").map((name) => ({ name, role: "inflow" as const })),
    ...reader.stringArray("outflow").map((name) => ({ name, role: "outflow" as const })),
  ];

  const diffusion = defaults.matrixDiffusion;
  if (reader.has("tdrw")) {
    const tdrwReader = new TableReader(reader.subTable("tdrw"), "[transport.tdrw]", problems);
    diffusion.isUsed = true;
    diffusion.matrixPorosity = tdrwReader.float("matrix_porosity", diffusion.matrixPorosity);
    diffusion.matrixDiffusivity = tdrwReader.float("matrix_diffusivity", diffusion.matrixDiffusivity);
    tdrwReader.checkUnknownKeys();
  }

  const state: TransportState = {
    seed: reader.integer("seed", defaults.seed),
    timeUnit: reader.choice("time_unit", TIME_UNITS, defaults.timeUnit),
    porosity: reader.float("porosity", defaults.porosity),
    maxTimeSteps: reader.integer("max_time_steps", defaults.maxTimeSteps),
    routing: reader.choice("routing", ROUTING_RULES, defaults.routing),
    boundaries,
    seeding: readSeeding(reader.subTable("seeding"), problems),
    matrixDiffusion: diffusion,
  };
  reader.checkUnknownKeys();
  return state;
}
