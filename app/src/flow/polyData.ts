// The VTK.wasm bundle has no mapper for an UnstructuredGrid (no
// vtkDataSetMapper, no geometry filter). The output of fehm (`pressure.vtu`)
// has only triangles, thus its text is changed into a PolyData file with the
// same points, triangles and arrays.

const PIECE = /<Piece NumberOfPoints="(\d+)" NumberOfCells="(\d+)">/;
const TYPES_ARRAY = /<DataArray[^>]*Name="types"[^>]*>[^<]*<\/DataArray>\n?/;

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
