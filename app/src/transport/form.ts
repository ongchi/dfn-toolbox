// The transport form: one field for each key of the dfntrans input file.
import type { FormContext } from "../form/context";
import { checkboxField, element, numberField, row, section, selectField } from "../form/fields";
import type { BoundaryRole, RoutingRule, SeedingMethod, TimeUnit, TransportState } from "./state";

function generalSection(state: TransportState, context: FormContext): HTMLElement {
  return section(
    "General",
    row(
      numberField({
        label: "Seed",
        key: "seed",
        help: "0 = a random seed for each run",
        value: state.seed,
        isInteger: true,
        min: 0,
        onInput: (value) => {
          state.seed = value;
          context.changed();
        },
      }),
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
      "The point arrays boundary__<name> of the mesh (keys inflow and outflow). Use at least one of each. They need not be pressure boundaries of the flow.",
    ),
  );
  for (const boundary of state.boundaries) {
    container.append(
      selectField<BoundaryRole>({
        label: boundary.name,
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
            help: "1 or more",
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
                ? "1 or more; at least one for each in-flow point"
                : "1 or more",
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
            help: "1 or more",
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

function matrixDiffusionSection(state: TransportState, context: FormContext): HTMLElement {
  const diffusion = state.matrixDiffusion;
  return section(
    "Matrix diffusion",
    checkboxField({
      label: "Use matrix diffusion",
      key: "tdrw",
      help: "time domain random walk",
      value: diffusion.isUsed,
      onInput: (value) => {
        diffusion.isUsed = value;
        context.rerender();
      },
    }),
    row(
      numberField({
        label: "Matrix porosity",
        key: "matrix_porosity",
        help: "above 0, at most 1",
        value: diffusion.matrixPorosity,
        min: 0,
        isMinExclusive: true,
        isDisabled: !diffusion.isUsed,
        onInput: (value) => {
          diffusion.matrixPorosity = value;
          context.changed();
        },
      }),
      numberField({
        label: "Matrix diffusivity (m²/s)",
        key: "matrix_diffusivity",
        help: "above 0",
        value: diffusion.matrixDiffusivity,
        min: 0,
        isMinExclusive: true,
        isDisabled: !diffusion.isUsed,
        onInput: (value) => {
          diffusion.matrixDiffusivity = value;
          context.changed();
        },
      }),
    ),
  );
}

function outputSection(state: TransportState, context: FormContext): HTMLElement {
  return section(
    "Output",
    checkboxField({
      label: "Trajectories",
      key: "trajectories",
      help: "shown in the 3D view; a point for each time step: the data can be very large (some 100 MB)",
      value: state.hasTrajectories,
      onInput: (value) => {
        state.hasTrajectories = value;
        context.changed();
      },
    }),
    checkboxField({
      label: "All particles",
      key: "all_particles",
      help: "also the particles which do not exit",
      value: state.hasAllParticles,
      onInput: (value) => {
        state.hasAllParticles = value;
        context.changed();
      },
    }),
    checkboxField({
      label: "Velocities",
      key: "velocities",
      help: "the velocity of the particle tracking at each point of the mesh: Color by → Transport velocity",
      value: state.hasVelocities,
      onInput: (value) => {
        state.hasVelocities = value;
        context.changed();
      },
    }),
  );
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
    matrixDiffusionSection(state, context),
    outputSection(state, context),
  );
  container.scrollTop = scrollTop;
}
