// The flow form: the fluid of the fehm input file, in the settings dialog.
// The pressure boundaries are on the Domain panel (`boundaryForm.ts`).
import type { FormContext } from "../form/context";
import { checkboxField, numberField, row, section } from "../form/fields";
import type { FlowState } from "./state";

/** The fluid of the flow (settings dialog) */
export function fluidSection(state: FlowState, context: FormContext): HTMLElement {
  return section(
    "Fluid",
    row(
      numberField({
        label: "Temperature (°C)",
        key: "temperature",
        help: "15 to 360; the same temperature everywhere",
        value: state.temperature,
        onInput: (value) => {
          state.temperature = value;
          context.changed();
        },
      }),
    ),
    checkboxField({
      label: "Gravity",
      key: "gravity",
      help: "in the −z direction",
      value: state.hasGravity,
      onInput: (value) => {
        state.hasGravity = value;
        context.changed();
      },
    }),
  );
}
