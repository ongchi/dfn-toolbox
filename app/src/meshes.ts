// The predefined domain meshes of ../meshes (copied by build-wasm.sh).
import type { InputFile } from "./inputFiles";

const MESHES_URL = new URL(`${import.meta.env.BASE_URL}meshes/`, window.location.href);

export async function listMeshes(): Promise<string[]> {
  const response = await fetch(new URL("index.json", MESHES_URL));
  if (!response.ok) {
    throw new Error(`cannot load the list of domain meshes (HTTP ${response.status})`);
  }
  return response.json();
}

/** The name of a predefined mesh for the user: its file name without `.vtu` */
export function meshDisplayName(fileName: string): string {
  return fileName.replace(/\.vtu$/, "");
}

export async function loadMesh(name: string): Promise<InputFile> {
  const url = new URL(name, MESHES_URL);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`cannot load the domain shape ${meshDisplayName(name)} (HTTP ${response.status})`);
  }
  return { name, text: await response.text() };
}
