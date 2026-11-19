// The transport form: one field for each key of the dfntrans input file,
// except the output (the trajectories and the velocities are always on) and
// the in-flow and out-flow boundaries (the roles of the Domain panel). The
// Transport panel has only the seeding; the particle tracking and the routing
// are in the settings dialog, also before a flow.
import type { FormContext } from "../form/context";
import { element, numberField, row, section, selectField } from "../form/fields";
import type { ReleasePoint, RoutingRule, TimeUnit, TransportState } from "./state";

/** The pick mode of the release points in the 3D view (page state, not in the workflow file) */
export interface PointPicking {
  isOn: boolean;
  setOn(isOn: boolean): void;
}

/** Help text of the particle numbers: the trajectories are always on */
const TRAJECTORY_SIZE = "the trajectories have about 1 MB for each particle";

/** dfntrans has a u32 seed */
const MAX_RANDOM_SEED = 2 ** 32;

/** The settings of the particle tracking (settings dialog): also before a flow */
export function particleTrackingSection(state: TransportState, context: FormContext): HTMLElement {
  const randomButton = element("button", "button-small", "Random");
  randomButton.type = "button";
  randomButton.title = "Set a new random seed";
  const seed = numberField({
    label: "Seed",
    key: "seed",
    help: "0 = a random seed for each run",
    value: state.seed,
    isInteger: true,
    min: 0,
    button: randomButton,
    onInput: (value) => {
      state.seed = value;
      context.changed();
    },
  });
  randomButton.addEventListener("click", () => {
    state.seed = 1 + Math.floor(Math.random() * (MAX_RANDOM_SEED - 1));
    const input = seed.querySelector("input");
    if (input) {
      input.value = String(state.seed);
      input.classList.remove("is-invalid");
    }
    context.changed();
  });

  return section(
    "Particle tracking",
    row(
      seed,
      selectField<TimeUnit>({
        label: "Time unit",
        key: "time_unit",
        help: "of the times and velocities",
        value: state.timeUnit,
        choices: [
          ["seconds", "seconds"],
          ["minutes", "minutes"],
          ["hours", "hours"],
          ["days", "days"],
          ["years", "years"],
        ],
        onInput: (value) => {
          state.timeUnit = value;
          context.changed();
        },
      }),
    ),
    row(
      numberField({
        label: "Porosity",
        key: "porosity",
        help: "of the fractures; above 0, at most 1",
        value: state.porosity,
        min: 0,
        isMinExclusive: true,
        onInput: (value) => {
          state.porosity = value;
          context.changed();
        },
      }),
      numberField({
        label: "Maximum time steps",
        key: "max_time_steps",
        help: "of a particle; 1 or more",
        value: state.maxTimeSteps,
        isInteger: true,
        min: 1,
        onInput: (value) => {
          state.maxTimeSteps = value;
          context.changed();
        },
      }),
    ),
  );
}

/** The routing of the particles: also before a flow */
export function routingSection(state: TransportState, context: FormContext): HTMLElement {
  return section(
    "Intersections",
    selectField<RoutingRule>({
      label: "Routing",
      key: "routing",
      help: "the rule of the particles at an intersection",
      value: state.routing,
      choices: [
        ["complete_mixing", "complete mixing"],
        ["streamline_routing", "streamline routing"],
      ],
      onInput: (value) => {
        state.routing = value;
        context.changed();
      },
    }),
  );
}

/** The particles start only at the release points (user decision) */
function seedingSection(state: TransportState, context: FormContext, picking: PointPicking): HTMLElement {
  return section("Seeding", ...releasePointFields(state, context, picking));
}

/** Text of a release point: 4 significant digits */
function pointText(point: ReleasePoint): string {
  return point.map((value) => value.toPrecision(4)).join(", ");
}

function releasePointFields(state: TransportState, context: FormContext, picking: PointPicking): HTMLElement[] {
  const seeding = state.seeding;
  const pickButton = element("button", "button-small", picking.isOn ? "Stop picking" : "Pick points");
  pickButton.type = "button";
  pickButton.id = "pick-points";
  pickButton.title = "Click on a fracture of the 3D view to add a release point";
  pickButton.setAttribute("aria-pressed", String(picking.isOn));
  pickButton.classList.toggle("is-pinned", picking.isOn);
  pickButton.addEventListener("click", () => picking.setOn(!picking.isOn));
  const clearButton = element("button", "button-small", "Clear points");
  clearButton.type = "button";
  clearButton.disabled = seeding.points.length === 0;
  clearButton.addEventListener("click", () => {
    seeding.points = [];
    context.rerender();
    context.changed();
  });
  const buttons = element("div", "field-row");
  buttons.append(pickButton, clearButton);

  const list = element("ol", "point-list");
  list.id = "release-points";
  for (const [index, point] of seeding.points.entries()) {
    const item = element("li", undefined, pointText(point));
    const removeButton = element("button", "button-small", "Remove");
    removeButton.type = "button";
    removeButton.title = `Remove release point ${index + 1}`;
    removeButton.addEventListener("click", () => {
      seeding.points.splice(index, 1);
      context.rerender();
      context.changed();
    });
    item.append(removeButton);
    list.append(item);
  }
  const note =
    seeding.points.length === 0
      ? element("p", "form-note", "No release point. Click “Pick points”, then click on a fracture of the 3D view.")
      : list;

  return [
    row(
      numberField({
        label: "Particles per point",
        key: "particles_per_point",
        help: `1 or more; ${TRAJECTORY_SIZE}`,
        value: seeding.particlesPerPoint,
        isInteger: true,
        min: 1,
        onInput: (value) => {
          seeding.particlesPerPoint = value;
          context.changed();
        },
      }),
    ),
    buttons,
    note,
  ];
}

/** Shows the transport form; `hasFlow` = there is a flow output */
export function renderTransportForm(
  container: HTMLElement,
  state: TransportState,
  hasFlow: boolean,
  context: FormContext,
  picking: PointPicking,
): void {
  const scrollTop = container.scrollTop;
  if (!hasFlow) {
    container.replaceChildren(
      element(
        "p",
        "form-note",
        "Click Run (▶): the particle tracking uses the flow and its triangle mesh.",
      ),
    );
    return;
  }
  container.replaceChildren(
    element("p", "form-note", "The particles go from the in-flow to the out-flow surfaces of the Domain panel."),
    seedingSection(state, context, picking),
  );
  container.scrollTop = scrollTop;
}
