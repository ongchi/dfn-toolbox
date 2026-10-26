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

/** A color chooser of each boundary surface of the domain mesh, for the 3D view */
export function boundarySurfaceSection(
  names: string[],
  colorOf: (name: string) => string,
  onColor: (name: string, color: string) => void,
): HTMLElement {
  const rows = names.map((name) => {
    const input = element("input");
    input.type = "color";
    input.value = colorOf(name);
    input.addEventListener("input", () => onColor(name, input.value));
    const label = element("label", "file-row-header");
    label.append(element("span", "field-label", name), input);
    return label;
  });
  const help = helpText(undefined, "The color of each boundary surface in the 3D view.");
  return section("Boundary surfaces", ...rows, ...(help ? [help] : []));
}

export function domainSection(state: FormState, context: FormContext, handlers: FileHandlers): HTMLElement {
  return meshRow(state.domain, context.meshNames, handlers.chooseMesh);
}
