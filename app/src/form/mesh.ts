import type { FormContext } from "./context";
import { element, numberField, row, section } from "./fields";
import type { FormState } from "./state";

/** The boundary lines and the mesh are always on: the flow needs them */
export function meshSection(state: FormState, context: FormContext): HTMLElement {
  const mesh = state.mesh;
  return section(
    "Triangle mesh for the flow",
    element(
      "p",
      "form-note",
      "The generation always makes the boundary lines of the regions and the triangle mesh of the final fractures. The boundary lines give the boundaries of the flow.",
    ),
    row(
      numberField({
        label: "Maximum size factor",
        key: "max_size_factor",
        help: "largest triangle size = factor × `min_feature_size`",
        value: mesh.maxSizeFactor,
        min: 1,
        onInput: (value) => {
          mesh.maxSizeFactor = value;
          context.changed();
        },
      }),
      numberField({
        label: "Slope",
        key: "slope",
        help: "growth of the triangle size with the distance from an intersection or a boundary line",
        value: mesh.slope,
        min: 0,
        isMinExclusive: true,
        onInput: (value) => {
          mesh.slope = value;
          context.changed();
        },
      }),
    ),
  );
}
