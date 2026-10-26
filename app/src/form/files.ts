import type { InputFile, InputFiles } from "../inputFiles";
import { element, helpText, section } from "./fields";
import type { FormState } from "./state";

export interface FileHandlers {
  chooseMesh(file: File): void;
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

export function filesSection(state: FormState, files: InputFiles, handlers: FileHandlers): HTMLElement {
  const fractureButtons = [fileButton("Choose…", ".vtp", handlers.chooseUserFractures)];
  if (state.userFractures !== null) {
    const removeButton = element("button", "button-small", "Remove");
    removeButton.type = "button";
    removeButton.addEventListener("click", handlers.removeUserFractures);
    fractureButtons.push(removeButton);
  }
  return section(
    "Input files",
    fileRow({
      label: "Domain mesh",
      key: "domain",
      name: state.domain === "" ? null : state.domain,
      file: files.mesh,
      help: "ASCII .vtu; volume cell types 10 to 14, `region__<name>` cell arrays are regions; surface cell types 5 and 9, `boundary__<name>` cell arrays are boundary surfaces",
      buttons: [fileButton("Choose…", ".vtu", handlers.chooseMesh)],
    }),
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
