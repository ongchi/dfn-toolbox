// The VTK.wasm bundle has no mapper for an UnstructuredGrid (no
// vtkDataSetMapper, no geometry filter). The output of fehm (`pressure.vtu`)
// has only triangles, thus its text is changed into a PolyData file with the
// same points, triangles and arrays.

const PIECE = /<Piece NumberOfPoints="(\d+)" NumberOfCells="(\d+)">/;
const TYPES_ARRAY = /<DataArray[^>]*Name="types"[^>]*>[^<]*<\/DataArray>\n?/;

/**
 * The text of the ASCII .vtu file `meshVtu` with the point array `name` of
 * `sourceVtu` added to its <PointData>. Both files must have the same points
 * in the same order (fehm reads the points of `pressure.vtu` from the mesh).
 */
export function addPointArray(meshVtu: string, sourceVtu: string, name: string): string {
  const meshPointCount = meshVtu.match(PIECE)?.[1];
  const sourcePointCount = sourceVtu.match(PIECE)?.[1];
  if (meshPointCount === undefined || meshPointCount !== sourcePointCount) {
    throw new Error(`the files have not the same number of points: ${meshPointCount} and ${sourcePointCount}`);
  }
  const array = sourceVtu.match(new RegExp(`<DataArray[^>]*Name="${name}"[^>]*>[^<]*</DataArray>\\n?`))?.[0];
  if (array === undefined) {
    throw new Error(`the file has no array ${name}`);
  }
  if (!meshVtu.includes("</PointData>")) {
    throw new Error("the mesh has no <PointData>");
  }
  return meshVtu.replace("</PointData>", `${array}</PointData>`);
}

/** The text of an ASCII .vtu file with only triangles, as the text of a .vtp file */
export function triangleGridToPolyData(vtuText: string): string {
  if (!PIECE.test(vtuText)) {
    throw new Error("the file has no <Piece> with NumberOfPoints and NumberOfCells");
  }
  return vtuText
    .replace('type="UnstructuredGrid"', 'type="PolyData"')
    .replace("<UnstructuredGrid>", "<PolyData>")
    .replace("</UnstructuredGrid>", "</PolyData>")
    .replace(
      PIECE,
      '<Piece NumberOfPoints="$1" NumberOfVerts="0" NumberOfLines="0" NumberOfStrips="0" NumberOfPolys="$2">',
    )
    .replace("<Cells>", "<Polys>")
    .replace("</Cells>", "</Polys>")
    .replace(TYPES_ARRAY, "");
}

/** The length of each 3D vector of a list of components (x, y, z of each vector one after the other) */
export function vectorMagnitudes(components: number[]): number[] {
  const magnitudes: number[] = [];
  for (let index = 0; index + 2 < components.length; index += 3) {
    magnitudes.push(Math.hypot(components[index], components[index + 1], components[index + 2]));
  }
  return magnitudes;
}

/** The text of the ASCII .vtu file `meshVtu` with a new array `name`: one value for each cell or each point */
export function addArray(meshVtu: string, association: "cell" | "point", name: string, values: number[]): string {
  const piece = meshVtu.match(PIECE);
  if (piece === null) {
    throw new Error("the mesh has no <Piece> with NumberOfPoints and NumberOfCells");
  }
  const count = Number(association === "cell" ? piece[2] : piece[1]);
  if (values.length !== count) {
    throw new Error(`the array ${name} has ${values.length} values for ${count} ${association}s`);
  }
  const end = association === "cell" ? "</CellData>" : "</PointData>";
  if (!meshVtu.includes(end)) {
    throw new Error(`the mesh has no ${association} data`);
  }
  const array = `<DataArray type="Float64" Name="${name}" format="ascii">${values.join(" ")}</DataArray>\n`;
  return meshVtu.replace(end, `${array}${end}`);
}

/** The number of points of an ASCII .vtu file */
export function pointCount(vtuText: string): number {
  const piece = vtuText.match(PIECE);
  if (piece === null) {
    throw new Error("the mesh has no <Piece> with NumberOfPoints and NumberOfCells");
  }
  return Number(piece[1]);
}
