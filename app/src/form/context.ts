// What the form sections need besides the state.

export interface FormContext {
  /** Names of the regions of the domain mesh (`region__<name>` arrays) */
  regionNames: string[];
  /** Call after a change of a value */
  changed(): void;
  /** Call after a change which shows or hides fields */
  rerender(): void;
}
