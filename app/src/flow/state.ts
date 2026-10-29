// State of the flow form: `[flow]` of the workflow file. It follows the input
// format of `../fehm-rs/src/io/input.rs` (see "Input file" of
// ../fehm-rs/README.md): a change of a key there needs a change here, in
// `toml.ts` and in `form.ts`. The pressure boundaries are the in-flow and the
// out-flow surfaces of `[boundaries]` (Domain tab).

/** Name of the mesh file in the TOML; the mesh is that of the last generation */
export const FLOW_MESH_FILE = "dfn_mesh.vtu";

const DEFAULT_PRESSURE = 10.0;

export interface FlowState {
  /** °C */
  temperature: number;
  hasGravity: boolean;
  /**
   * MPa, by boundary surface name. A surface which gets no role keeps its
   * pressure; only the in-flow and out-flow surfaces go into the TOML.
   */
  pressures: Record<string, number>;
}

export function defaultFlowState(): FlowState {
  return { temperature: 20.0, hasGravity: true, pressures: {} };
}

/** The pressure of a boundary surface: the given one, else the default */
export function pressureOf(state: FlowState, name: string): number {
  return state.pressures[name] ?? DEFAULT_PRESSURE;
}
