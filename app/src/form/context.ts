// What the form sections need besides the state.

export interface FormContext {
  /** Names of the regions of the domain mesh (`region__<name>` arrays) */
  regionNames: string[];
  /** Names of the predefined domain meshes (`meshes/` of the site) */
  meshNames: string[];
  /** Call after a change of a value */
  changed(): void;
  /** Call after a change which shows or hides fields */
  rerender(): void;
}
