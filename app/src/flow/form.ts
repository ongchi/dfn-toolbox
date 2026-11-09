// The flow form: one field for each key of the fehm input file. The pressure
// boundaries are the in-flow and out-flow surfaces of the Domain panel; the
// fluid follows them, also before a triangle mesh.
import type { FormContext } from "../form/context";
import { bindSurfaceHighlight, checkboxField, element, numberField, row, section } from "../form/fields";
import { pressureOf, type FlowState } from "./state";

/** The fluid of the flow: also before a triangle mesh */
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

/** A pressure boundary of the flow: an in-flow or out-flow surface of the Domain panel */
export interface FlowBoundary {
  name: string;
  isInflow: boolean;
  /** False if the network has no point on the surface: the flow does not use it */
  hasPoints: boolean;
}

function boundariesSection(state: FlowState, boundaries: FlowBoundary[], context: FormContext): HTMLElement {
  const container = section("Pressure boundaries");
  container.append(
    element(
      "p",
      "form-note",
      "The in-flow and out-flow surfaces of the Domain panel; the pointer over a field highlights its surface in the 3D view, and a click (a tap) on its name keeps it highlighted until a second click. A point on two surfaces keeps the pressure of the first in this list.",
    ),
  );
  for (const boundary of boundaries) {
    const role = boundary.isInflow ? "in-flow" : "out-flow";
    const field = numberField({
      label: `${boundary.name}: pressure (MPa)`,
      key: "pressure",
      help: boundary.hasPoints ? `${role}; 0.001 to 110` : `${role}; the network has no point on it: not used`,
      value: pressureOf(state, boundary.name),
      isDisabled: !boundary.hasPoints,
      onInput: (value) => {
        state.pressures[boundary.name] = value;
        context.changed();
      },
    });
    bindSurfaceHighlight(field, boundary.name, context.highlightBoundarySurface);
    container.append(field);
  }
  return container;
}

/** Shows the flow form; `boundaries` = null: the last generation has no triangle mesh */
export function renderFlowForm(
  container: HTMLElement,
  state: FlowState,
  boundaries: FlowBoundary[] | null,
  context: FormContext,
): void {
  const scrollTop = container.scrollTop;
  if (boundaries === null) {
    container.replaceChildren(
      element(
        "p",
        "form-note",
        'Click Run (▶): the flow uses the triangle mesh of the network.',
      ),
    );
    return;
  }
  container.replaceChildren(boundariesSection(state, boundaries, context));
  container.scrollTop = scrollTop;
}
