// The shape of a region of the domain mesh for the 3D view: the outer faces
// of its volume cells (the cells with a value above 0 in the cell array
// `region__<name>`).
import { dataArrayValues, pointValues } from "./inputFiles";
import type { CellShapes } from "./viewerGeometry";

// The faces of each VTK volume cell type, as positions in the points of the cell
const VOLUME_CELL_FACES = new Map<number, readonly (readonly number[])[]>([
  // Tetrahedron
  [10, [[0, 1, 3], [1, 2, 3], [2, 0, 3], [0, 2, 1]]],
  // Voxel
  [11, [[0, 4, 6, 2], [1, 3, 7, 5], [0, 1, 5, 4], [2, 6, 7, 3], [0, 2, 3, 1], [4, 5, 7, 6]]],
  // Hexahedron
  [12, [[0, 4, 7, 3], [1, 2, 6, 5], [0, 1, 5, 4], [3, 7, 6, 2], [0, 3, 2, 1], [4, 5, 6, 7]]],
  // Wedge
  [13, [[0, 1, 2], [3, 5, 4], [0, 3, 4, 1], [1, 4, 5, 2], [2, 5, 3, 0]]],
  // Pyramid
  [14, [[0, 3, 2, 1], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]]],
]);

/**
 * All points of the ASCII .vtu domain mesh and, as polygons, the outer faces
 * of the region `name`: each face of a volume cell of the region which no
 * other cell of the region has (the same points, in any order).
 */
export function regionOuterFaces(vtuText: string, name: string): CellShapes {
  const points = pointValues(vtuText);
  const connectivity = dataArrayValues(vtuText, "connectivity");
  const offsets = dataArrayValues(vtuText, "offsets");
  const types = dataArrayValues(vtuText, "types");
  const values = dataArrayValues(vtuText, `region__${name}`);
  if (connectivity === null || offsets === null || types === null || values === null) {
    throw new Error(`the domain mesh has no cells or region ${name}`);
  }
  // The faces by their sorted point numbers, with the number of cells which have them
  const faces = new Map<string, { polygon: number[]; useCount: number }>();
  values.forEach((value, cell) => {
    const cellFaces = VOLUME_CELL_FACES.get(types[cell]);
    if (value <= 0 || cellFaces === undefined) {
      return;
    }
    const cellPoints = connectivity.slice(cell === 0 ? 0 : offsets[cell - 1], offsets[cell]);
    for (const positions of cellFaces) {
      const polygon = positions.map((position) => cellPoints[position]);
      const key = [...polygon].sort((first, second) => first - second).join(" ");
      const face = faces.get(key);
      if (face) {
        face.useCount += 1;
      } else {
        faces.set(key, { polygon, useCount: 1 });
      }
    }
  });
  const outerFaces = [...faces.values()].filter((face) => face.useCount === 1).map((face) => face.polygon);
  return { points, vertexCounts: outerFaces.map((polygon) => polygon.length), connectivity: outerFaces.flat() };
}
