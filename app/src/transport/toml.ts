// The TOML text of the dfntrans input file from the transport form. Only
// writing: the transport input always comes from the form (dfntrans checks
// the values).
import { float, integer, string } from "../form/toml";
import { TRANSPORT_FLOW_FILE, type BoundaryRole, type SeedingState, type TransportState } from "./state";

function boundaryNames(state: TransportState, role: BoundaryRole): string {
  const names = state.boundaries.filter((boundary) => boundary.role === role).map((boundary) => string(boundary.name));
  return `[${names.join(", ")}]`;
}

function seedingLines(seeding: SeedingState): string[] {
  const lines = ["[seeding]", `method = ${string(seeding.method)}`];
  switch (seeding.method) {
    case "uniform_per_line":
    case "equidistant":
      lines.push(`particles_per_line = ${integer(seeding.particlesPerLine)}`);
      lines.push(`weight_by_flux = ${seeding.isWeightedByFlux}`);
      break;
    case "random":
    case "flux_weighted":
      lines.push(`particle_count = ${integer(seeding.particleCount)}`);
      break;
    case "at_nodes":
      lines.push(`particles_per_node = ${integer(seeding.particlesPerNode)}`);
      break;
  }
  return lines;
}

export function transportStateToToml(state: TransportState): string {
  const lines = [
    `flow = ${string(TRANSPORT_FLOW_FILE)}`,
    `seed = ${integer(state.seed)}`,
    `time_unit = ${string(state.timeUnit)}`,
    `porosity = ${float(state.porosity)}`,
    `max_time_steps = ${integer(state.maxTimeSteps)}`,
    `inflow = ${boundaryNames(state, "inflow")}`,
    `outflow = ${boundaryNames(state, "outflow")}`,
    `routing = ${string(state.routing)}`,
    "",
    ...seedingLines(state.seeding),
  ];

  const diffusion = state.matrixDiffusion;
  if (diffusion.isUsed) {
    lines.push(
      "",
      "[tdrw]",
      `matrix_porosity = ${float(diffusion.matrixPorosity)}`,
      `matrix_diffusivity = ${float(diffusion.matrixDiffusivity)}`,
    );
  }

  const control = state.controlSurfaces;
  if (control.shape === "plane") {
    lines.push(
      "",
      "[control_planes]",
      `shape = "plane"`,
      `direction = ${string(control.axis)}`,
      `spacing = ${float(control.spacing)}`,
    );
  } else if (control.shape === "cylinder") {
    lines.push(
      "",
      "[control_planes]",
      `shape = "cylinder"`,
      `axis = ${string(control.axis)}`,
      `spacing = ${float(control.spacing)}`,
      `length_to_well = ${float(control.lengthToWell)}`,
      `well_thickness = ${float(control.wellThickness)}`,
    );
  }

  lines.push(
    "",
    "[output]",
    `trajectories = ${state.hasTrajectories}`,
    `all_particles = ${state.hasAllParticles}`,
    `velocities = ${state.hasVelocities}`,
  );
  return `${lines.join("\n")}\n`;
}
