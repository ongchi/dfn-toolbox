import type { InputFile, InputFiles } from "../inputFiles";
import type { FormContext } from "./context";
import { element, helpText, section } from "./fields";
import type { FormState } from "./state";

export interface FileHandlers {
  /** The name of a predefined domain mesh */
  chooseMesh(name: string): void;
  chooseUserFractures(file: File): void;
  removeUserFractures(): void;
}

function fileButton(label: string, accept: string, onChoose: (file: File) => void): HTMLElement {
  const button = element("label", "button-small file-button", label);
  const input = element("input");
  input.type = "file";
  input.accept = accept;
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) {
      onChoose(file);
    }
  });
  button.append(input);
  return button;
}

/** The name of a predefined mesh in the form: its file name without `.vtu` */
function meshLabel(fileName: string): string {
  return fileName.replace(/\.vtu$/, "");
}

/** The predefined domain meshes; a name which is not one of them is shown as not available */
function meshSelect(selected: string, meshNames: string[], onChoose: (name: string) => void): HTMLElement {
  const select = element("select");
  const names = selected === "" || meshNames.includes(selected) ? meshNames : [...meshNames, selected];
  select.append(new Option("Choose…", ""));
  for (const name of names) {
    select.append(new Option(meshNames.includes(name) ? meshLabel(name) : `${meshLabel(name)} (not available)`, name));
  }
  select.value = selected;
  select.addEventListener("change", () => {
    if (select.value !== "") {
      onChoose(select.value);
    }
  });
  return select;
}

function sizeText(file: InputFile): string {
  const kilobytes = file.text.length / 1024;
  return kilobytes < 1024 ? `${kilobytes.toFixed(0)} kB` : `${(kilobytes / 1024).toFixed(1)} MB`;
}

/** One file of the input: its key, its name and its state */
function fileRow(options: {
  label: string;
  key: string;
  name: string | null;
  file: InputFile | null;
  help: string;
  buttons: HTMLElement[];
}): HTMLElement {
  const container = element("div", "file-row");
  const header = element("div", "file-row-header");
  header.append(element("span", "field-label", options.label), ...options.buttons);
  container.append(header);

  const status = element("div", "file-status");
  if (options.name === null) {
    status.textContent = "None";
  } else if (options.file === null) {
    status.classList.add("is-warning");
    status.textContent = `${options.name}: missing. Choose this file.`;
  } else {
    status.textContent = `${options.name} (${sizeText(options.file)})`;
  }
  container.append(status);
  const help = helpText(options.key, options.help);
  if (help) {
    container.append(help);
  }
  return container;
}

/** The domain mesh: the dropdown of the predefined meshes shows the selected one */
function meshRow(selected: string, meshNames: string[], onChoose: (name: string) => void): HTMLElement {
  const container = element("div", "file-row");
  const header = element("div", "file-row-header");
  header.append(element("span", "field-label", "Domain mesh"), meshSelect(selected, meshNames, onChoose));
  container.append(header);
  return container;
}

export function filesSection(
  state: FormState,
  files: InputFiles,
  context: FormContext,
  handlers: FileHandlers,
): HTMLElement {
  const fractureButtons = [fileButton("Choose…", ".vtp", handlers.chooseUserFractures)];
  if (state.userFractures !== null) {
    const removeButton = element("button", "button-small", "Remove");
    removeButton.type = "button";
    removeButton.addEventListener("click", handlers.removeUserFractures);
    fractureButtons.push(removeButton);
  }
  return section(
    "Input files",
    meshRow(state.domain, context.meshNames, handlers.chooseMesh),
    fileRow({
      label: "User-defined fractures",
      key: "user_fractures",
      name: state.userFractures,
      file: files.userFractures,
      help: "optional; ASCII .vtp, one polygon cell for each fracture",
      buttons: fractureButtons,
    }),
  );
}
