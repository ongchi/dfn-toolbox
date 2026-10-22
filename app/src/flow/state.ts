// State of the flow form: the input file of fehm (see "Input file" of
// ../fehm-rs/README.md). This is a second copy of the input format of
// `../fehm-rs/src/io/input.rs`: a change of a key there needs a change here,
// in `toml.ts` and in `form.ts`.

/** Name of the mesh file in the TOML; the mesh is that of the last generation */
export const FLOW_MESH_FILE = "dfn_mesh.vtu";

const DEFAULT_PRESSURE = 10.0;

export interface FlowBoundaryState {
  /** `<name>` of the point data array `boundary__<name>` of the mesh */
  name: string;
  /** Written into the TOML only when it is used */
  isUsed: boolean;
  /** MPa */
  pressure: number;
}

export interface FlowState {
  /** °C */
  temperature: number;
  hasGravity: boolean;
  /** One for each boundary array of the mesh, in the order of the mesh file */
  boundaries: FlowBoundaryState[];
  /** null = no key (default of fehm) */
  tolerance: number | null;
  /** null = no key (default of fehm) */
  maxIterations: number | null;
}

export function defaultFlowState(): FlowState {
  return { temperature: 20.0, hasGravity: true, boundaries: [], tolerance: null, maxIterations: null };
}

/** Names of the boundaries of a mesh: the point data arrays `boundary__<name>` */
export function meshBoundaryNames(vtuText: string): string[] {
  const pointData = /<PointData[^>]*>([\s\S]*?)<\/PointData>/.exec(vtuText)?.[1] ?? "";
  return [...pointData.matchAll(/<DataArray[^>]*Name="boundary__([^"]+)"/g)].map((match) => match[1]);
}

/** One boundary for each name; a boundary with the same name keeps its values */
export function updateBoundaries(state: FlowState, names: string[]): void {
  const previous = new Map(state.boundaries.map((boundary) => [boundary.name, boundary]));
  state.boundaries = names.map(
    (name) => previous.get(name) ?? { name, isUsed: false, pressure: DEFAULT_PRESSURE },
  );
}
