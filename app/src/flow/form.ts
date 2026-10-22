// The flow form: one field for each key of the fehm input file.
import type { FormContext } from "../form/context";
import { checkboxField, element, numberField, optionalNumberField, row, section } from "../form/fields";
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
      "The point arrays boundary__<name> of the mesh. Use at least one. A point on two used boundaries keeps the pressure of the first in this list.",
    ),
  );
  for (const boundary of state.boundaries) {
    container.append(
      row(
        checkboxField({
          label: boundary.name,
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

function solverSection(state: FlowState, context: FormContext): HTMLElement {
  return section(
    "Solver",
    row(
      optionalNumberField({
        label: "Tolerance",
        key: "tolerance",
        help: "of the largest mass residual of a point, relative; 0 to 1",
        placeholder: "1e-10",
        value: state.tolerance,
        onInput: (value) => {
          state.tolerance = value;
          context.changed();
        },
      }),
      optionalNumberField({
        label: "Maximum iterations",
        key: "max_iterations",
        help: "Newton iterations; 1 or more",
        placeholder: "20",
        value: state.maxIterations,
        onInput: (value) => {
          state.maxIterations = value;
          context.changed();
        },
      }),
    ),
  );
}

/** Shows the flow form; `hasMesh` = the last generation has a triangle mesh */
export function renderFlowForm(container: HTMLElement, state: FlowState, hasMesh: boolean, context: FormContext): void {
  const scrollTop = container.scrollTop;
  if (!hasMesh) {
    container.replaceChildren(
      element(
        "p",
        "form-note",
        "Generate a network with the mesh on (section “Triangle mesh for fehm-rs” of the Network tab) first. The flow uses the mesh dfn_mesh.vtu of the last generation.",
      ),
    );
    return;
  }
  container.replaceChildren(
    fluidSection(state, context),
    boundariesSection(state, context),
    solverSection(state, context),
  );
  container.scrollTop = scrollTop;
}
