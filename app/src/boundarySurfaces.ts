// The boundary surfaces of the domain mesh: its surface cells (triangles,
// quads) with a value above 0 in the cell array `boundary__<name>`. They are
// faces of the volume cells, thus the wireframe of the domain does not show
// them as surfaces.
import { dataArrayValues, pointValues } from "./inputFiles";
import { domainEdges, type CellShapes } from "./viewerGeometry";

// VTK_TRIANGLE and VTK_QUAD
const SURFACE_CELL_TYPES = new Set([5, 9]);

/** Names of the boundary surfaces of a domain mesh: the cell data arrays `boundary__<name>`, in the order of the file */
export function domainBoundarySurfaceNames(vtuText: string): string[] {
  const cellData = vtuText.match(/<CellData[^>]*>([\s\S]*?)<\/CellData>/)?.[1] ?? "";
  return [...cellData.matchAll(/<DataArray[^>]*Name="boundary__([^"]+)"/g)].map((match) => match[1]);
}

/** All points of the ASCII .vtu domain mesh and, as polygons, its surface cells of the boundary surface `name` */
export function boundarySurfaceCells(vtuText: string, name: string): CellShapes {
  const points = pointValues(vtuText);
  const connectivity = dataArrayValues(vtuText, "connectivity");
  const offsets = dataArrayValues(vtuText, "offsets");
  const types = dataArrayValues(vtuText, "types");
  const values = dataArrayValues(vtuText, `boundary__${name}`);
  if (connectivity === null || offsets === null || types === null || values === null) {
    throw new Error(`the domain mesh has no cells or boundary surface ${name}`);
  }
  const polygons = values.flatMap((value, cell) =>
    value > 0 && SURFACE_CELL_TYPES.has(types[cell])
      ? [connectivity.slice(cell === 0 ? 0 : offsets[cell - 1], offsets[cell])]
      : [],
  );
  return { points, vertexCounts: polygons.map((polygon) => polygon.length), connectivity: polygons.flat() };
}

/** The edges of the cells of an ASCII .vtu domain mesh */
export function domainWireframe(vtuText: string): { points: number[]; edges: Uint32Array } {
  const points = pointValues(vtuText);
  const edges = domainEdges(
    dataArrayValues(vtuText, "connectivity") ?? [],
    dataArrayValues(vtuText, "offsets") ?? [],
    dataArrayValues(vtuText, "types") ?? [],
    points.length / 3,
  );
  return { points, edges };
}
