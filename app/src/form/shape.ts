import type { FormContext } from "./context";
import { numberField, row, section } from "./fields";
import type { FormState } from "./state";

/** The shape of all fractures: one number of points for the families and the user-defined fractures */
export function shapeSection(state: FormState, context: FormContext): HTMLElement {
  return section(
    "Fracture shape",
    row(
      numberField({
        label: "Number of points",
        key: "number_of_points",
        help: "of each family and user fracture: 3 or more; 4 = rectangle",
        value: state.numberOfPoints,
        isInteger: true,
        min: 3,
        onInput: (value) => {
          state.numberOfPoints = value;
          context.changed();
        },
      }),
    ),
  );
}
