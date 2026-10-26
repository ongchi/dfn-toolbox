// The mesh file of the input. The form state has its name (the key
// `domain`); this has its text.

export interface InputFile {
  name: string;
  text: string;
}

export interface InputFiles {
  mesh: InputFile | null;
}

/** The bounding box of the cells of a region of the mesh */
export interface RegionBounds {
  name: string;
  min: [number, number, number];
  max: [number, number, number];
}

/** Names of the regions of a mesh: the data arrays `region__<name>`, in the order of the file */
export function meshRegionNames(vtuText: string): string[] {
  return [...vtuText.matchAll(/<DataArray[^>]*Name="region__([^"]+)"/g)].map((match) => match[1]);
}

/** The numbers of the ASCII data array with this name; null if there is none */
export function dataArrayValues(vtuText: string, name: string): number[] | null {
  const match = vtuText.match(new RegExp(`<DataArray[^>]*Name="${name}"[^>]*>([^<]*)</DataArray>`));
  return match === null ? null : match[1].trim().split(/\s+/).filter((word) => word !== "").map(Number);
}

/**
 * The bounding box of the cells of each region of an ASCII .vtu mesh (the
 * cells with a value above 0 in `region__<name>`), in the order of the file.
 * A region with no cell is not in the list.
 */
export function meshRegionBounds(vtuText: string): RegionBounds[] {
  // The array of <Points> can have any name
  const pointsText = vtuText.match(/<Points>\s*<DataArray[^>]*>([^<]*)<\/DataArray>/)?.[1] ?? "";
  const points = pointsText.trim().split(/\s+/).filter((word) => word !== "").map(Number);
  const connectivity = dataArrayValues(vtuText, "connectivity") ?? [];
  const offsets = dataArrayValues(vtuText, "offsets") ?? [];
  return meshRegionNames(vtuText).flatMap((name): RegionBounds[] => {
    const values = dataArrayValues(vtuText, `region__${name}`) ?? [];
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    values.forEach((value, cell) => {
      if (value <= 0) {
        return;
      }
      for (const point of connectivity.slice(cell === 0 ? 0 : offsets[cell - 1], offsets[cell])) {
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis], points[3 * point + axis]);
          max[axis] = Math.max(max[axis], points[3 * point + axis]);
        }
      }
    });
    return min[0] <= max[0] ? [{ name, min, max }] : [];
  });
}
