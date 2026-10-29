// The flow form: one field for each key of the fehm input file.
import type { FormContext } from "../form/context";
import { checkboxField, element, numberField, row, section } from "../form/fields";
import type { FlowState } from "./state";

function fluidSection(state: FlowState, context: FormContext): HTMLElement {
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

function boundariesSection(state: FlowState, context: FormContext): HTMLElement {
  const container = section("Pressure boundaries");
  container.append(
    element(
      "p",
      "form-note",
      "The boundary surfaces of the domain mesh, in their colors of the 3D view. Use at least one. A point on two used boundaries keeps the pressure of the first in this list.",
    ),
  );
  for (const boundary of state.boundaries) {
    container.append(
      row(
        checkboxField({
          label: boundary.name,
          labelColor: context.boundarySurfaceColor(boundary.name) ?? undefined,
          help: "use this boundary",
          value: boundary.isUsed,
          onInput: (value) => {
            boundary.isUsed = value;
            context.rerender();
          },
        }),
        numberField({
          label: "Pressure (MPa)",
          key: "pressure",
          help: "0.001 to 110",
          value: boundary.pressure,
          isDisabled: !boundary.isUsed,
          onInput: (value) => {
            boundary.pressure = value;
            context.changed();
          },
        }),
      ),
    );
  }
  return container;
}

/** Shows the flow form; `hasMesh` = the last generation has a triangle mesh */
export function renderFlowForm(container: HTMLElement, state: FlowState, hasMesh: boolean, context: FormContext): void {
  const scrollTop = container.scrollTop;
  if (!hasMesh) {
    container.replaceChildren(
      element(
        "p",
        "form-note",
        "Generate a network (DFN tab) first. The flow uses the triangle mesh of the last generation.",
      ),
    );
    return;
  }
  container.replaceChildren(fluidSection(state, context), boundariesSection(state, context));
  container.scrollTop = scrollTop;
}
