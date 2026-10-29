// Conversion between the flow form state and `[flow]` of the workflow file,
// and the fehm input file of the flow (fehm checks the values).
import { flowSurfaces, type BoundaryRoles } from "../boundaryRoles";
import { float, inlineTable, key, string, TableReader, type Table, type TomlTable } from "../form/toml";
import { defaultFlowState, FLOW_MESH_FILE, pressureOf, type FlowState } from "./state";

/** The tables of `[flow]` of the workflow file: a pressure for each in-flow and out-flow surface */
export function flowTables(state: FlowState, roles: BoundaryRoles): TomlTable[] {
  const pressures = flowSurfaces(roles).map((name): [string, string] => [key(name), float(pressureOf(state, name))]);
  return [
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
}

/**
 * The fehm input file of the flow, on the mesh of the last generation.
 * `boundaryNames`: the in-flow and out-flow surfaces with a point in the mesh.
 */
export function flowToLibraryToml(state: FlowState, boundaryNames: string[]): string {
  const lines = [
    `mesh = ${string(FLOW_MESH_FILE)}`,
    `temperature = ${float(state.temperature)}`,
    `gravity = ${state.hasGravity}`,
  ];
  for (const name of boundaryNames) {
    lines.push("", "[[boundary]]", `name = ${string(name)}`, `pressure = ${float(pressureOf(state, name))}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Reads `[flow]` of the workflow file. `pressure` must have one pressure for
 * each in-flow and out-flow surface of `[boundaries]`, and no other.
 */
export function readFlow(table: Table, roles: BoundaryRoles, problems: string[]): FlowState {
  const defaults = defaultFlowState();
  const reader = new TableReader(table, "[flow]", problems);
  const pressureTable = reader.subTable("pressure");
  const pressureReader = new TableReader(pressureTable, "[flow]: pressure", problems);
  const surfaces = flowSurfaces(roles);
  const pressures: Record<string, number> = {};
  for (const name of surfaces) {
    pressures[name] = pressureReader.float(name, pressureOf(defaults, name));
  }
  for (const name of Object.keys(pressureTable).filter((candidate) => !surfaces.includes(candidate))) {
    problems.push(`[flow]: pressure: \`${name}\` is not an in-flow or out-flow surface of [boundaries]`);
  }
  const state: FlowState = {
    temperature: reader.float("temperature", defaults.temperature),
    hasGravity: reader.boolean("gravity", defaults.hasGravity),
    pressures,
  };
  reader.checkUnknownKeys();
  return state;
}
