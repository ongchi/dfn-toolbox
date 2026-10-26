// The mesh file and the user-defined fracture file of the input. The form
// state has their names (the keys `domain` and `user_fractures`); this has
// their text.

export interface InputFile {
  name: string;
  text: string;
}

export interface InputFiles {
  mesh: InputFile | null;
  userFractures: InputFile | null;
}

/** Names of the regions of a mesh: the cell data arrays `region__<name>` */
export function meshRegionNames(vtuText: string): string[] {
  const document = new DOMParser().parseFromString(vtuText, "application/xml");
  const names: string[] = [];
  for (const array of document.querySelectorAll("CellData > DataArray")) {
    const name = array.getAttribute("Name") ?? "";
    if (name.startsWith("region__") && name.length > "region__".length) {
      names.push(name.slice("region__".length));
    }
  }
  return names;
}

