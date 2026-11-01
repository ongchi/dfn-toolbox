// The workflow file of dfn-toolbox: one TOML with `[boundaries]`, `[network]`,
// `[flow]` and `[transport]`. The comment at the top is the description. The
// app makes the input files of dfngen, fehm and dfntrans from it
// (`networkToLibraryToml`, `flowToLibraryToml`, `transportToLibraryToml`). An
// unknown key or a missing key is an error. The keys are those of "Input file"
// in the README of each library, with these changes:
//
//   # Description of the input.
//
//   [boundaries]                       # the roles of the boundary surfaces of the domain mesh
//   inflow = ["west"]
//   outflow = ["east"]                 # a surface in no list is a no-flow surface
//
//   [network]                          # the dfngen input
//   seed = 12345
//   min_feature_size = 0.4
//   domain = "Box.vtu"                 # the name of a predefined mesh; no `user_fractures`
//   [network.generation]               # as [generation]
//   [network.fram]                     # as [fram]; optional
//   [network.mesh]                     # optional; no `enable` and no [network.region_boundaries]: always on
//   max_size_factor = 5.0
//   slope = 0.5
//   [network.clusters]                 # only keep_only_largest
//   [[network.family]]                 # as [[family]]; `aperture` is necessary
//   [[network.user_fracture]]          # optional; a regular polygon, all keys necessary
//   region = "box"                     # one region of the mesh
//   center = [5.0, 5.0, 5.0]           # m; in the bounding box of the cells of the region
//   number_of_points = 4               # as a family: 3 or more, 4 = rectangle
//   radius = 7.78                      # m; of the circle of the points
//   aspect_ratio = 0.545               # y radius / x radius
//   beta = 0.0                         # degrees; rotation in the plane of the fracture
//   aperture = 3e-4                    # m; above 0
//   orientation = { theta = 90.0, phi = 90.0 }   # the normal, as a family without kappa
//
//   [flow]                             # the fehm input, without `mesh`
//   temperature = 20.0
//   gravity = false
//   pressure = { west = 10.1, east = 10.0 }   # MPa; each in-flow and out-flow surface, in place of [[boundary]]; no [solver]
//
//   [transport]                        # the dfntrans input, without `flow`
//   seed = 12345
//   time_unit = "days"
//   porosity = 1.0
//   max_time_steps = 1000000
//   routing = "complete_mixing"        # no inflow, no outflow: [boundaries] gives them
//   [transport.seeding]                # no [transport.tdrw], no [transport.control_planes], no [transport.output]
import { boundariesTables, readBoundaries, type BoundaryRoles } from "./boundaryRoles";
import { flowTables, readFlow } from "./flow/toml";
import type { FlowState } from "./flow/state";
import { InputFormError, networkTables, parseToml, readNetwork, TableReader, tablesToToml, type Table } from "./form/toml";
import type { FormState } from "./form/state";
import { readTransport, transportTables } from "./transport/toml";
import type { TransportState } from "./transport/state";

const DESCRIPTION_WIDTH = 76;

export interface Workflow {
  /** The comment at the top of the file, as one line; "" = none */
  description: string;
  /** The roles of the boundary surfaces of the domain mesh (Domain tab) */
  boundaries: BoundaryRoles;
  network: FormState;
  flow: FlowState;
  transport: TransportState;
}

/** The comment at the top of a TOML text, as one line, or "" */
export function readDescription(toml: string): string {
  const lines = toml.split("\n");
  const end = lines.findIndex((line) => !line.startsWith("#"));
  return lines
    .slice(0, end === -1 ? lines.length : end)
    .map((line) => line.replace(/^#\s?/, ""))
    .join(" ")
    .trim();
}

/** The description as comment lines of at most about `DESCRIPTION_WIDTH` characters */
function descriptionLines(description: string): string[] {
  const lines: string[] = [];
  let line = "#";
  for (const word of description.split(/\s+/).filter((part) => part !== "")) {
    if (line !== "#" && line.length + 1 + word.length > DESCRIPTION_WIDTH) {
      lines.push(line);
      line = "#";
    }
    line += ` ${word}`;
  }
  if (line !== "#") {
    lines.push(line);
  }
  return lines;
}

export function workflowToToml(workflow: Workflow): string {
  const description = descriptionLines(workflow.description);
  return [
    description.length === 0 ? "" : `${description.join("\n")}\n\n`,
    tablesToToml(boundariesTables(workflow.boundaries), "boundaries"),
    "\n",
    tablesToToml(networkTables(workflow.network), "network"),
    "\n",
    tablesToToml(flowTables(workflow.flow, workflow.boundaries), "flow"),
    "\n",
    tablesToToml(transportTables(workflow.transport), "transport"),
  ].join("");
}

/** Reads a workflow file. Throws `InputFormError` with all problems. */
export function tomlToWorkflow(text: string): Workflow {
  const problems: string[] = [];
  const reader = new TableReader(parseToml(text), "", problems);
  /** A missing section is one problem, not one for each of its keys */
  const readSection = <State>(key: string, read: (table: Table, sectionProblems: string[]) => State): State => {
    const table = reader.subTable(key);
    return read(table, reader.has(key) ? problems : []);
  };
  const boundaries = readSection("boundaries", readBoundaries);
  const workflow: Workflow = {
    description: readDescription(text),
    boundaries,
    network: readSection("network", readNetwork),
    flow: readSection("flow", (table, sectionProblems) => readFlow(table, boundaries, sectionProblems)),
    transport: readSection("transport", readTransport),
  };
  reader.checkUnknownKeys();
  if (problems.length > 0) {
    throw new InputFormError(problems);
  }
  return workflow;
}
