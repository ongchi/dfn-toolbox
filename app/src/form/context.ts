// What the form sections need besides the state.
import type { RegionBounds } from "../inputFiles";

export interface FormContext {
  /** Names of the regions of the domain mesh (`region__<name>` arrays) */
  regionNames: string[];
  /** Names of the predefined domain meshes (`meshes/` of the site) */
  meshNames: string[];
  /** The bounding boxes of the regions of the domain mesh */
  regionBounds: RegionBounds[];
  /** The color of a boundary surface of the domain mesh in the 3D view; null = not a boundary surface */
  boundarySurfaceColor(name: string): string | null;
  /** Call after a change of a value */
  changed(): void;
  /** Call after a change which shows or hides fields */
  rerender(): void;
}
