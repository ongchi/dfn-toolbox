// The workflow file of dfn-web: one TOML with `[boundaries]`, `[network]`,
// `[flow]` and `[transport]` (see "Workflow file" of README.md). The comment
// at the top is the description. The app makes the input files of dfngen,
// fehm and dfntrans from it (`networkToLibraryToml`, `flowToLibraryToml`,
// `transportToLibraryToml`).
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
