// The transport form: one field for each key of the dfntrans input file,
// except the output (the trajectories and the velocities are always on).
import type { FormContext } from "../form/context";
import { checkboxField, element, numberField, row, section, selectField } from "../form/fields";
import type { BoundaryRole, RoutingRule, SeedingMethod, TimeUnit, TransportState } from "./state";

/** Help text of the particle numbers: the trajectories are always on */
const TRAJECTORY_SIZE = "the trajectories have about 1 MB for each particle";

/** dfntrans has a u32 seed */
const MAX_RANDOM_SEED = 2 ** 32;

function generalSection(state: TransportState, context: FormContext): HTMLElement {
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
    "General",
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
    selectField<RoutingRule>({
      label: "Routing",
      key: "routing",
      help: "the rule at an intersection",
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

function boundariesSection(state: TransportState, context: FormContext): HTMLElement {
  const container = section("Boundaries");
  container.append(
    element(
      "p",
      "form-note",
      "The boundary surfaces of the domain mesh, in their colors of the 3D view (keys inflow and outflow). Use at least one of each. They need not be pressure boundaries of the flow.",
    ),
  );
  for (const boundary of state.boundaries) {
    container.append(
      selectField<BoundaryRole>({
        label: boundary.name,
        labelColor: context.boundarySurfaceColor(boundary.name) ?? undefined,
        value: boundary.role,
        choices: [
          ["none", "not used"],
          ["inflow", "in-flow"],
          ["outflow", "out-flow"],
        ],
        onInput: (value) => {
          boundary.role = value;
          context.changed();
        },
      }),
    );
  }
  return container;
}

function seedingSection(state: TransportState, context: FormContext): HTMLElement {
  const seeding = state.seeding;
  const method = selectField<SeedingMethod>({
    label: "Method",
    key: "method",
    help: "the initial positions of the particles",
    value: seeding.method,
    choices: [
      ["flux_weighted", "flux weighted"],
      ["uniform_per_line", "uniform per in-flow line"],
      ["equidistant", "equidistant"],
      ["random", "random triangles"],
      ["at_nodes", "at the in-flow points"],
    ],
    onInput: (value) => {
      seeding.method = value;
      context.rerender();
    },
  });
  const container = section("Seeding", method);

  switch (seeding.method) {
    case "uniform_per_line":
    case "equidistant":
      container.append(
        row(
          numberField({
            label: "Particles per line",
            key: "particles_per_line",
            help: `1 or more; ${TRAJECTORY_SIZE}`,
            value: seeding.particlesPerLine,
            isInteger: true,
            min: 1,
            onInput: (value) => {
              seeding.particlesPerLine = value;
              context.changed();
            },
          }),
        ),
        checkboxField({
          label: "Weight by flux",
          key: "weight_by_flux",
          help: "flux weight of a particle: the in-flow flux at its position, or 0",
          value: seeding.isWeightedByFlux,
          onInput: (value) => {
            seeding.isWeightedByFlux = value;
            context.changed();
          },
        }),
      );
      break;
    case "random":
    case "flux_weighted":
      container.append(
        row(
          numberField({
            label: "Particles",
            key: "particle_count",
            help:
              seeding.method === "flux_weighted"
                ? `1 or more; at least one for each in-flow point; ${TRAJECTORY_SIZE}`
                : `1 or more; ${TRAJECTORY_SIZE}`,
            value: seeding.particleCount,
            isInteger: true,
            min: 1,
            onInput: (value) => {
              seeding.particleCount = value;
              context.changed();
            },
          }),
        ),
      );
      break;
    case "at_nodes":
      container.append(
        row(
          numberField({
            label: "Particles per point",
            key: "particles_per_node",
            help: `1 or more; ${TRAJECTORY_SIZE}`,
            value: seeding.particlesPerNode,
            isInteger: true,
            min: 1,
            onInput: (value) => {
              seeding.particlesPerNode = value;
              context.changed();
            },
          }),
        ),
      );
      break;
  }
  return container;
}

/** Shows the transport form; `hasFlow` = there is a flow output */
export function renderTransportForm(
  container: HTMLElement,
  state: TransportState,
  hasFlow: boolean,
  context: FormContext,
): void {
  const scrollTop = container.scrollTop;
  if (!hasFlow) {
    container.replaceChildren(
      element(
        "p",
        "form-note",
        "Solve the flow (Flow tab) first. The particle tracking uses the flow input of the last “Solve flow” and its mesh.",
      ),
    );
    return;
  }
  container.replaceChildren(
    generalSection(state, context),
    boundariesSection(state, context),
    seedingSection(state, context),
  );
  container.scrollTop = scrollTop;
}
