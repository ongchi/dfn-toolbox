import type { FormContext } from "./context";
import { checkboxField, section } from "./fields";
import type { FormState } from "./state";

export function regionBoundariesSection(state: FormState, context: FormContext): HTMLElement {
  const regionBoundaries = state.regionBoundaries;
  return section(
    "Boundary lines of the regions",
    checkboxField({
      label: "Boundary lines on",
      key: "enable",
      help: "write the lines where the boundary of the region of each fracture crosses it (`fracture_boundaries.vtp`)",
      value: regionBoundaries.enable,
      onInput: (value) => {
        regionBoundaries.enable = value;
        context.rerender();
      },
    }),
    checkboxField({
      label: "Use the family region",
      key: "use_family_region",
      help: "off = the lines of each stochastic fracture are at the mesh surface, also if its family has a region",
      value: regionBoundaries.useFamilyRegion,
      isDisabled: !regionBoundaries.enable,
      onInput: (value) => {
        regionBoundaries.useFamilyRegion = value;
        context.changed();
      },
    }),
  );
}
