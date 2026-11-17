// What the form sections need besides the state.
import type { RegionBounds } from "../inputFiles";
import type { HighlightItem } from "./fields";

export interface FormContext {
  /** Names of the regions of the domain mesh (`region__<name>` arrays) */
  regionNames: string[];
  /** Names of the predefined domain meshes (`meshes/` of the site) */
  meshNames: string[];
  /** The bounding boxes of the regions of the domain mesh */
  regionBounds: RegionBounds[];
  /** The largest side of the bounding box of the domain mesh (m); 0 without a mesh */
  domainSize: number;
  /** Highlights a boundary surface or a region in the 3D view; null = none */
  highlight(item: HighlightItem | null): void;
  /** Call after a change of a value */
  changed(): void;
  /** Call after a change which shows or hides fields */
  rerender(): void;
  /** Shows the polygon of the user-defined fracture with this index, after a change of it; null: none */
  previewUserFracture?(index: number | null): void;
}
