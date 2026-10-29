// The roles of the boundary surfaces of the domain mesh: `[boundaries]` of
// the workflow file, set in the Domain tab. The network keeps only the
// clusters which connect an in-flow and an out-flow surface, the flow has a
// pressure on each of them, and the particles go from the in-flow to the
// out-flow surfaces.
import { dataArrayValues } from "./inputFiles";
import { string, TableReader, type Table, type TomlTable } from "./form/toml";

export type SurfaceRole = "inflow" | "outflow" | "noflow";

/** A surface in no list is a no-flow surface */
export interface BoundaryRoles {
  inflow: string[];
  outflow: string[];
}

/** The first surface in-flow, the second out-flow, the others no-flow */
export function defaultBoundaryRoles(surfaceNames: string[]): BoundaryRoles {
  return { inflow: surfaceNames.slice(0, 1), outflow: surfaceNames.slice(1, 2) };
}

export function roleOf(roles: BoundaryRoles, name: string): SurfaceRole {
  if (roles.inflow.includes(name)) {
    return "inflow";
  }
  return roles.outflow.includes(name) ? "outflow" : "noflow";
}

/** The lists keep the order of `surfaceNames` (the order of the mesh file) */
export function setRole(roles: BoundaryRoles, name: string, role: SurfaceRole, surfaceNames: string[]): void {
  const listOf = (listRole: SurfaceRole) =>
    surfaceNames.filter((surface) => (surface === name ? role : roleOf(roles, surface)) === listRole);
  roles.inflow = listOf("inflow");
  roles.outflow = listOf("outflow");
}

/** The pressure boundaries of the flow: the in-flow and the out-flow surfaces */
export function flowSurfaces(roles: BoundaryRoles): string[] {
  return [...roles.inflow, ...roles.outflow];
}

/**
 * The surfaces of `names` with a point in the triangle mesh: a value above 0
 * in the point array `boundary__<name>`. A surface of a group of two or more
 * surfaces can have no point; fehm and dfntrans reject such a boundary.
 */
export function surfacesWithPoints(triangleMesh: string, names: string[]): string[] {
  return names.filter((name) => dataArrayValues(triangleMesh, `boundary__${name}`)?.some((value) => value > 0));
}

/** A TOML array of names */
export function nameList(names: string[]): string {
  return `[${names.map(string).join(", ")}]`;
}

/** The dfngen key: the clusters which touch an in-flow and an out-flow surface */
export function clustersLine(roles: BoundaryRoles): string {
  return `keep_only_connected_to = [${nameList(roles.inflow)}, ${nameList(roles.outflow)}]`;
}

/** The table of `[boundaries]` of the workflow file */
export function boundariesTables(roles: BoundaryRoles): TomlTable[] {
  return [
    { name: "", isArray: false, lines: [`inflow = ${nameList(roles.inflow)}`, `outflow = ${nameList(roles.outflow)}`] },
  ];
}

/** Reads `[boundaries]` of the workflow file */
export function readBoundaries(table: Table, problems: string[]): BoundaryRoles {
  const reader = new TableReader(table, "[boundaries]", problems);
  const roles = { inflow: reader.stringArray("inflow"), outflow: reader.stringArray("outflow") };
  reader.checkUnknownKeys();
  for (const name of roles.inflow.filter((inflow) => roles.outflow.includes(inflow))) {
    problems.push(`[boundaries]: \`${name}\` cannot be in inflow and outflow`);
  }
  return roles;
}
