// State of the flow form: `[flow]` of the workflow file. It follows the input
// format of `../fehm-rs/src/io/input.rs` (see "Input file" of
// ../fehm-rs/README.md): a change of a key there needs a change here, in
// `toml.ts` and in `form.ts`.
import { domainBoundarySurfaceNames } from "../boundarySurfaces";

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
}

export function defaultFlowState(): FlowState {
  return { temperature: 20.0, hasGravity: true, boundaries: [] };
}

/** Names of the boundaries of a mesh: the point data arrays `boundary__<name>` */
export function meshBoundaryNames(vtuText: string): string[] {
  const pointData = /<PointData[^>]*>([\s\S]*?)<\/PointData>/.exec(vtuText)?.[1] ?? "";
  return [...pointData.matchAll(/<DataArray[^>]*Name="boundary__([^"]+)"/g)].map((match) => match[1]);
}

/**
 * The boundaries of the flow and the transport: the boundary arrays of the
 * triangle mesh which are boundary surfaces of the domain mesh, not the mesh
 * surface or a region
 */
export function flowBoundaryNames(triangleMesh: string, domainMesh: string): string[] {
  const surfaceNames = domainBoundarySurfaceNames(domainMesh);
  return meshBoundaryNames(triangleMesh).filter((name) => surfaceNames.includes(name));
}

/**
 * One boundary for each name; a boundary with the same name keeps its values.
 * A used boundary of no name stays at the end: fehm reports it as an error.
 */
export function updateBoundaries(state: FlowState, names: string[]): void {
  const previous = new Map(state.boundaries.map((boundary) => [boundary.name, boundary]));
  const missing = state.boundaries.filter((boundary) => boundary.isUsed && !names.includes(boundary.name));
  state.boundaries = [
    ...names.map((name) => previous.get(name) ?? { name, isUsed: false, pressure: DEFAULT_PRESSURE }),
    ...missing,
  ];
}
