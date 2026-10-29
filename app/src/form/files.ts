import type { SurfaceRole } from "../boundaryRoles";
import { meshDisplayName } from "../meshes";
import type { FormContext } from "./context";
import { element, helpText, section } from "./fields";
import type { FormState } from "./state";

export interface FileHandlers {
  /** The name of a predefined domain mesh */
  chooseMesh(name: string): void;
}

/** The predefined domain meshes; a name which is not one of them is shown as not available */
function meshSelect(selected: string, meshNames: string[], onChoose: (name: string) => void): HTMLElement {
  const select = element("select");
  const names = selected === "" || meshNames.includes(selected) ? meshNames : [...meshNames, selected];
  select.append(new Option("Choose…", ""));
  for (const name of names) {
    select.append(new Option(meshNames.includes(name) ? meshDisplayName(name) : `${meshDisplayName(name)} (not available)`, name));
  }
  select.value = selected;
  select.addEventListener("change", () => {
    if (select.value !== "") {
      onChoose(select.value);
    }
  });
  return select;
}

/** The domain mesh: the dropdown of the predefined meshes shows the selected one; the style of the example row */
function meshRow(selected: string, meshNames: string[], onChoose: (name: string) => void): HTMLElement {
  const row = element("label", "example-row");
  row.append(element("span", "field-label", "Domain mesh"), meshSelect(selected, meshNames, onChoose));
  return row;
}

const ROLE_CHOICES: [SurfaceRole, string][] = [
  ["inflow", "in-flow"],
  ["outflow", "out-flow"],
  ["noflow", "no-flow"],
];

/** The boundary surfaces of the domain mesh: their roles, and their colors in the 3D view */
export interface BoundarySurfaceHandlers {
  colorOf(name: string): string;
  onColor(name: string, color: string): void;
  roleOf(name: string): SurfaceRole;
  onRole(name: string, role: SurfaceRole): void;
}

/** A role and a color chooser for each boundary surface of the domain mesh */
export function boundarySurfaceSection(names: string[], handlers: BoundarySurfaceHandlers): HTMLElement {
  const rows = names.map((name) => {
    const role = element("select");
    role.dataset.surface = name;
    for (const [value, text] of ROLE_CHOICES) {
      const option = element("option", undefined, text);
      option.value = value;
      option.selected = value === handlers.roleOf(name);
      role.append(option);
    }
    role.addEventListener("change", () => handlers.onRole(name, role.value as SurfaceRole));
    const color = element("input");
    color.type = "color";
    color.value = handlers.colorOf(name);
    color.addEventListener("input", () => handlers.onColor(name, color.value));
    const label = element("label", "file-row-header");
    label.append(element("span", "field-label", name), role, color);
    return label;
  });
  const help = helpText(
    undefined,
    "The role of each boundary surface and its color in the 3D view. The network keeps only the clusters which connect an in-flow and an out-flow surface. The flow has a pressure on each of them, and the particles go from the in-flow to the out-flow surfaces.",
  );
  return section("Boundary surfaces", ...rows, ...(help ? [help] : []));
}

export function domainSection(state: FormState, context: FormContext, handlers: FileHandlers): HTMLElement {
  return meshRow(state.domain, context.meshNames, handlers.chooseMesh);
}
