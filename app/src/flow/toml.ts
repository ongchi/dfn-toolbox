// Conversion between the flow form state and `[flow]` of the workflow file,
// and the fehm input file of the flow (fehm checks the values).
import { float, inlineTable, integer, key, string, TableReader, type Table, type TomlTable } from "../form/toml";
import { defaultFlowState, FLOW_MESH_FILE, type FlowState } from "./state";

/** The tables of `[flow]` of the workflow file */
export function flowTables(state: FlowState): TomlTable[] {
  const pressures = state.boundaries
    .filter((boundary) => boundary.isUsed)
    .map((boundary): [string, string] => [key(boundary.name), float(boundary.pressure)]);
  const tables: TomlTable[] = [
    {
      name: "",
      isArray: false,
      lines: [
        `temperature = ${float(state.temperature)}`,
        `gravity = ${state.hasGravity}`,
        `pressure = ${pressures.length === 0 ? "{}" : inlineTable(pressures)}`,
      ],
    },
  ];
  const solverLines: string[] = [];
  if (state.tolerance !== null) {
    solverLines.push(`tolerance = ${float(state.tolerance)}`);
  }
  if (state.maxIterations !== null) {
    solverLines.push(`max_iterations = ${integer(state.maxIterations)}`);
  }
  if (solverLines.length > 0) {
    tables.push({ name: "solver", isArray: false, lines: solverLines });
  }
  return tables;
}

/** The fehm input file of the flow, on the mesh of the last generation */
export function flowToLibraryToml(state: FlowState): string {
  const lines = [
    `mesh = ${string(FLOW_MESH_FILE)}`,
    `temperature = ${float(state.temperature)}`,
    `gravity = ${state.hasGravity}`,
  ];
  for (const boundary of state.boundaries.filter((candidate) => candidate.isUsed)) {
    lines.push("", "[[boundary]]", `name = ${string(boundary.name)}`, `pressure = ${float(boundary.pressure)}`);
  }
  if (state.tolerance !== null || state.maxIterations !== null) {
    lines.push("", "[solver]");
    if (state.tolerance !== null) {
      lines.push(`tolerance = ${float(state.tolerance)}`);
    }
    if (state.maxIterations !== null) {
      lines.push(`max_iterations = ${integer(state.maxIterations)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Reads `[flow]` of the workflow file. The boundaries are the names of
 * `pressure`, all used; the mesh of the generation adds its other boundaries.
 */
export function readFlow(table: Table, problems: string[]): FlowState {
  const defaults = defaultFlowState();
  const reader = new TableReader(table, "[flow]", problems);
  const pressureTable = reader.subTable("pressure");
  const pressureReader = new TableReader(pressureTable, "[flow]: pressure", problems);
  const boundaries = Object.keys(pressureTable).map((name) => ({
    name,
    isUsed: true,
    pressure: pressureReader.float(name, 0),
  }));
  const solverReader = new TableReader(reader.subTable("solver", true), "[flow.solver]", problems);
  const state: FlowState = {
    temperature: reader.float("temperature", defaults.temperature),
    hasGravity: reader.boolean("gravity", defaults.hasGravity),
    boundaries,
    tolerance: solverReader.optionalFloat("tolerance"),
    maxIterations: solverReader.optionalInteger("max_iterations"),
  };
  solverReader.checkUnknownKeys();
  reader.checkUnknownKeys();
  return state;
}
