// The TOML text of the fehm input file from the flow form. Only writing: the
// flow input always comes from the form (fehm checks the values).
import { float, integer, string } from "../form/toml";
import { FLOW_MESH_FILE, type FlowState } from "./state";

export function flowStateToToml(state: FlowState): string {
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
