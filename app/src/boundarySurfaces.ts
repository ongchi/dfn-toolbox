// The boundary surfaces of the domain mesh: its surface cells (triangles,
// quads) with a value above 0 in the cell array `boundary__<name>`. They are
// faces of the volume cells, thus the wireframe of the domain does not show
// them, and the VTK.wasm bundle has no geometry filter: each surface is
// changed into the text of a PolyData file.
import { dataArrayValues } from "./inputFiles";

// VTK_TRIANGLE and VTK_QUAD
const SURFACE_CELL_TYPES = new Set([5, 9]);

/** The color of surface N is color N modulo the length; not the colors of the other layers of the viewer */
export const DEFAULT_SURFACE_COLORS = ["#2ca02c", "#ff7f0e", "#17becf", "#bcbd22", "#8c564b", "#7f7f7f"];

/** Names of the boundary surfaces of a domain mesh: the cell data arrays `boundary__<name>`, in the order of the file */
export function domainBoundarySurfaceNames(vtuText: string): string[] {
  const cellData = vtuText.match(/<CellData[^>]*>([\s\S]*?)<\/CellData>/)?.[1] ?? "";
  return [...cellData.matchAll(/<DataArray[^>]*Name="boundary__([^"]+)"/g)].map((match) => match[1]);
}

/**
 * The text of a .vtp file with all points of the ASCII .vtu domain mesh and,
 * as polygons, its surface cells of the boundary surface `name`
 */
export function boundarySurfacePolyData(vtuText: string, name: string): string {
  const pointsText = vtuText.match(/<Points>\s*<DataArray[^>]*>([^<]*)<\/DataArray>/)?.[1];
  const pointCount = vtuText.match(/<Piece NumberOfPoints="(\d+)"/)?.[1];
  const connectivity = dataArrayValues(vtuText, "connectivity");
  const offsets = dataArrayValues(vtuText, "offsets");
  const types = dataArrayValues(vtuText, "types");
  const values = dataArrayValues(vtuText, `boundary__${name}`);
  if (
    pointsText === undefined ||
    pointCount === undefined ||
    connectivity === null ||
    offsets === null ||
    types === null ||
    values === null
  ) {
    throw new Error(`the domain mesh has no points, cells or boundary surface ${name}`);
  }
  const polygons = values.flatMap((value, cell) =>
    value > 0 && SURFACE_CELL_TYPES.has(types[cell])
      ? [connectivity.slice(cell === 0 ? 0 : offsets[cell - 1], offsets[cell])]
      : [],
  );
  let end = 0;
  const polygonOffsets = polygons.map((polygon) => (end += polygon.length));
  return `<?xml version="1.0"?>
<VTKFile type="PolyData" version="1.0" byte_order="LittleEndian">
<PolyData>
<Piece NumberOfPoints="${pointCount}" NumberOfVerts="0" NumberOfLines="0" NumberOfStrips="0" NumberOfPolys="${polygons.length}">
<Points>
<DataArray type="Float64" NumberOfComponents="3" format="ascii">${pointsText}</DataArray>
</Points>
<Polys>
<DataArray type="Int64" Name="connectivity" format="ascii">${polygons.map((polygon) => polygon.join(" ")).join("\n")}</DataArray>
<DataArray type="Int64" Name="offsets" format="ascii">${polygonOffsets.join(" ")}</DataArray>
</Polys>
</Piece>
</PolyData>
</VTKFile>
`;
}
