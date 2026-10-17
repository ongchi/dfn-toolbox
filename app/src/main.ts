// The page: input form, generation in the worker, 3D view and output files.
import "./style.css";
import { strToU8, zipSync } from "fflate";
import { exampleDescription, listExamples, loadExample } from "./examples";
import { renderForm } from "./form";
import type { FormContext } from "./form/context";
import type { FileHandlers } from "./form/files";
import { defaultFormState, type FormState } from "./form/state";
import { formStateToToml, InputFormError, tomlToFormState } from "./form/toml";
import { CancelledError, GenerationClient, type GenerationInput, type GenerationOutput } from "./generationClient";
import { baseName, meshRegionNames, type InputFiles } from "./inputFiles";
import { NetworkViewer, type FractureLayer } from "./viewer";

const DEFAULT_COLOR_ARRAY = "family";

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`missing element #${id}`);
  }
  return node as T;
}

const ui = {
  exampleSelect: byId<HTMLSelectElement>("example-select"),
  exampleDescription: byId<HTMLParagraphElement>("example-description"),
  openFiles: byId<HTMLInputElement>("open-files"),
  saveToml: byId<HTMLButtonElement>("save-toml"),
  form: byId<HTMLDivElement>("form"),
  checkButton: byId<HTMLButtonElement>("check-button"),
  runButton: byId<HTMLButtonElement>("run-button"),
  cancelButton: byId<HTMLButtonElement>("cancel-button"),
  progress: byId<HTMLProgressElement>("progress"),
  status: byId<HTMLPreElement>("status"),
  colorSelect: byId<HTMLSelectElement>("color-select"),
  showMesh: byId<HTMLInputElement>("show-mesh"),
  showRemoved: byId<HTMLInputElement>("show-removed"),
  showRejected: byId<HTMLInputElement>("show-rejected"),
  resetCamera: byId<HTMLButtonElement>("reset-camera"),
  canvas: byId<HTMLCanvasElement>("viewer-canvas"),
  viewerMessage: byId<HTMLDivElement>("viewer-message"),
  resultsEmpty: byId<HTMLParagraphElement>("results-empty"),
  results: byId<HTMLDivElement>("results"),
  resultsStats: byId<HTMLDListElement>("results-stats"),
  downloadAll: byId<HTMLButtonElement>("download-all"),
  downloadList: byId<HTMLUListElement>("download-list"),
  log: byId<HTMLPreElement>("log"),
  tomlPreview: byId<HTMLPreElement>("toml-preview"),
  copyToml: byId<HTMLButtonElement>("copy-toml"),
};

let state: FormState = defaultFormState();
let files: InputFiles = { mesh: null, userFractures: null };
let regionNames: string[] = [];
let output: GenerationOutput | null = null;
let isBusy = false;
let viewer: NetworkViewer | null = null;
const client = new GenerationClient();

// ---------------------------------------------------------------- status

function showStatus(text: string, isError = false): void {
  ui.status.hidden = text === "";
  ui.status.textContent = text;
  ui.status.classList.toggle("is-error", isError);
}

function errorText(error: unknown): string {
  if (error instanceof InputFormError) {
    return `The form cannot show this input:\n${error.problems.map((problem) => `• ${problem}`).join("\n")}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function durationText(milliseconds: number): string {
  return milliseconds < 1000 ? `${Math.round(milliseconds)} ms` : `${(milliseconds / 1000).toFixed(1)} s`;
}

function setBusy(busy: boolean, canCancel = false): void {
  isBusy = busy;
  ui.checkButton.disabled = busy;
  ui.runButton.disabled = busy;
  ui.exampleSelect.disabled = busy;
  ui.cancelButton.hidden = !canCancel;
  ui.progress.hidden = !canCancel;
}

// ---------------------------------------------------------------- form

const formContext: FormContext = {
  get regionNames() {
    return regionNames;
  },
  changed: () => updateTomlPreview(),
  rerender: () => render(),
};

const fileHandlers: FileHandlers = {
  chooseMesh: async (file) => {
    state.domain = file.name;
    await setMesh({ name: file.name, text: await file.text() });
    render();
  },
  chooseUserFractures: async (file) => {
    state.userFractures = file.name;
    files.userFractures = { name: file.name, text: await file.text() };
    render();
  },
  removeUserFractures: () => {
    state.userFractures = null;
    files.userFractures = null;
    render();
  },
};

function render(): void {
  renderForm(ui.form, state, files, formContext, fileHandlers);
  updateTomlPreview();
}

function updateTomlPreview(): void {
  ui.tomlPreview.textContent = formStateToToml(state);
}

async function setMesh(mesh: InputFiles["mesh"]): Promise<void> {
  files.mesh = mesh;
  regionNames = mesh === null ? [] : meshRegionNames(mesh.text);
  clearOutput();
  if (viewer && mesh) {
    await viewer.setMesh(mesh.text);
    viewer.setVisible("mesh", ui.showMesh.checked);
    viewer.resetCamera();
    await viewer.render();
  }
}

/** Loads a new input: the old output does not belong to it */
async function loadInput(newState: FormState, newFiles: InputFiles, description: string): Promise<void> {
  state = newState;
  files = { mesh: null, userFractures: newFiles.userFractures };
  await setMesh(newFiles.mesh);
  ui.exampleDescription.textContent = description;
  ui.exampleDescription.hidden = description === "";
  showStatus("");
  render();
}

// ---------------------------------------------------------------- open and save

async function openFiles(fileList: File[]): Promise<void> {
  const tomlFile = fileList.find((file) => file.name.endsWith(".toml"));
  const findFile = async (path: string | null) => {
    const file = path === null ? undefined : fileList.find((candidate) => candidate.name === baseName(path));
    return file && path !== null ? { name: path, text: await file.text() } : null;
  };

  if (tomlFile) {
    const toml = await tomlFile.text();
    const newState = tomlToFormState(toml);
    ui.exampleSelect.value = "";
    delete ui.form.dataset.example;
    await loadInput(
      newState,
      { mesh: await findFile(newState.domain), userFractures: await findFile(newState.userFractures) },
      exampleDescription(toml),
    );
    return;
  }
  // Only data files: they replace the files of the current input
  for (const file of fileList) {
    if (file.name.endsWith(".vtu")) {
      await fileHandlers.chooseMesh(file);
    } else if (file.name.endsWith(".vtp")) {
      await fileHandlers.chooseUserFractures(file);
    }
  }
}

function downloadText(name: string, text: string | Uint8Array, type = "text/plain"): void {
  const blob = new Blob([text as BlobPart], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// ---------------------------------------------------------------- run

/** The input for the worker, or an error message */
function generationInput(): GenerationInput | string {
  if (ui.form.querySelector(".is-invalid")) {
    return "A field of the form has an invalid value (red border). Correct it first.";
  }
  if (files.mesh === null) {
    return state.domain === "" ? "Choose a domain mesh file (.vtu)." : `Choose the domain mesh file ${state.domain}.`;
  }
  if (state.userFractures !== null && files.userFractures === null) {
    return `Choose the user-defined fracture file ${state.userFractures}, or remove it.`;
  }
  return {
    toml: formStateToToml(state),
    mesh: files.mesh.text,
    userFractures: files.userFractures?.text,
  };
}

async function checkInput(): Promise<void> {
  const input = generationInput();
  if (typeof input === "string") {
    showStatus(input, true);
    return;
  }
  setBusy(true);
  try {
    const error = await client.check(input);
    showStatus(error ?? "The input is valid.", error !== null);
  } catch (error) {
    showStatus(errorText(error), true);
  } finally {
    setBusy(false);
  }
}

async function runGeneration(): Promise<void> {
  const input = generationInput();
  if (typeof input === "string") {
    showStatus(input, true);
    return;
  }
  setBusy(true, true);
  ui.progress.value = 0;
  showStatus("Generating…");
  const startTime = performance.now();
  try {
    const result = await client.run(input, (acceptedCount, fraction) => {
      ui.progress.value = fraction;
      showStatus(`Generating… ${acceptedCount} fractures accepted`);
    });
    ui.log.textContent = result.log;
    if (result.error !== null) {
      showStatus(result.error, true);
      return;
    }
    showStatus(`Done in ${durationText(performance.now() - startTime)}: ${result.finalCount} final fractures.`);
    await showOutput(result);
  } catch (error) {
    showStatus(error instanceof CancelledError ? "Cancelled." : errorText(error), !(error instanceof CancelledError));
  } finally {
    setBusy(false);
  }
}

// ---------------------------------------------------------------- output

function clearOutput(): void {
  output = null;
  ui.results.hidden = true;
  ui.resultsEmpty.hidden = false;
  ui.colorSelect.disabled = true;
  ui.log.textContent = "";
  if (viewer) {
    for (const layer of ["final", "removed", "rejected"] as FractureLayer[]) {
      void viewer.setLayer(layer, null);
    }
    void viewer.render();
  }
}

function outputFile(name: string): string | null {
  return output?.files.find(([fileName]) => fileName === name)?.[1] ?? null;
}

async function showOutput(result: GenerationOutput): Promise<void> {
  output = result;
  ui.resultsEmpty.hidden = true;
  ui.results.hidden = false;

  const stats: [string, string][] = [
    ["Final fractures", String(result.finalCount)],
    ["Accepted fractures", String(result.acceptedCount)],
    ["Rejected fractures", String(result.rejectedCount)],
    ["Seed", result.seed],
  ];
  ui.resultsStats.replaceChildren(
    ...stats.flatMap(([label, value]) => {
      const term = document.createElement("dt");
      term.textContent = label;
      const description = document.createElement("dd");
      description.textContent = value;
      return [term, description];
    }),
  );

  ui.downloadList.replaceChildren(
    ...result.files.map(([name, text]) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = "#";
      link.textContent = name;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        downloadText(name, text);
      });
      item.append(link);
      return item;
    }),
  );

  ui.showRejected.disabled = outputFile("fractures_rejected.vtp") === null;
  await showOutputInViewer();
}

async function showOutputInViewer(): Promise<void> {
  if (!viewer || !output) {
    return;
  }
  await viewer.setLayer("final", outputFile("fractures.vtp"));
  await viewer.setLayer("removed", outputFile("fractures_removed.vtp"));
  await viewer.setLayer("rejected", outputFile("fractures_rejected.vtp"));
  viewer.setVisible("removed", ui.showRemoved.checked);
  viewer.setVisible("rejected", ui.showRejected.checked);

  const previous = ui.colorSelect.value;
  const names = await viewer.cellArrayNames();
  const oneColor = new Option("One color", "");
  ui.colorSelect.replaceChildren(oneColor, ...names.map((name) => new Option(name, name)));
  ui.colorSelect.value = names.includes(previous) ? previous : names.includes(DEFAULT_COLOR_ARRAY) ? DEFAULT_COLOR_ARRAY : "";
  ui.colorSelect.disabled = false;
  await viewer.colorBy(ui.colorSelect.value === "" ? null : ui.colorSelect.value);
  await viewer.render();
}

// ---------------------------------------------------------------- viewer

async function startViewer(): Promise<void> {
  try {
    viewer = await NetworkViewer.create(ui.canvas);
  } catch (error) {
    ui.viewerMessage.textContent = `The 3D viewer is not available: ${errorText(error)}`;
    return;
  }
  ui.viewerMessage.hidden = true;
  if (files.mesh) {
    await viewer.setMesh(files.mesh.text);
    viewer.setVisible("mesh", ui.showMesh.checked);
  }
  await showOutputInViewer();
  viewer.resetCamera();
  await viewer.render();
}

async function updateViewer(action: (viewer: NetworkViewer) => void | Promise<void>): Promise<void> {
  if (viewer) {
    await action(viewer);
    await viewer.render();
  }
}

// ---------------------------------------------------------------- events

function selectTab(name: string): void {
  for (const tab of document.querySelectorAll<HTMLButtonElement>(".tab")) {
    tab.classList.toggle("is-active", tab.dataset.tab === name);
  }
  for (const body of document.querySelectorAll<HTMLElement>(".tab-body")) {
    body.hidden = body.dataset.tabBody !== name;
  }
}

function bindEvents(): void {
  ui.exampleSelect.addEventListener("change", async () => {
    const name = ui.exampleSelect.value;
    if (name === "" || isBusy) {
      return;
    }
    try {
      const example = await loadExample(name);
      await loadInput(example.state, example.files, example.description);
      ui.form.dataset.example = name;
    } catch (error) {
      showStatus(errorText(error), true);
    }
  });
  ui.openFiles.addEventListener("change", async () => {
    try {
      await openFiles([...(ui.openFiles.files ?? [])]);
    } catch (error) {
      showStatus(errorText(error), true);
    }
    ui.openFiles.value = "";
  });
  ui.saveToml.addEventListener("click", () => downloadText("input.toml", formStateToToml(state)));
  ui.copyToml.addEventListener("click", () => void navigator.clipboard.writeText(formStateToToml(state)));
  ui.checkButton.addEventListener("click", () => void checkInput());
  ui.runButton.addEventListener("click", () => void runGeneration());
  ui.cancelButton.addEventListener("click", () => client.cancel());
  ui.downloadAll.addEventListener("click", () => {
    if (output) {
      const archive = zipSync(Object.fromEntries(output.files.map(([name, text]) => [name, strToU8(text)])));
      downloadText("dfngen_output.zip", archive, "application/zip");
    }
  });

  ui.colorSelect.addEventListener("change", () =>
    updateViewer((view) => view.colorBy(ui.colorSelect.value === "" ? null : ui.colorSelect.value)),
  );
  ui.showMesh.addEventListener("change", () => updateViewer((view) => view.setVisible("mesh", ui.showMesh.checked)));
  ui.showRemoved.addEventListener("change", () =>
    updateViewer((view) => view.setVisible("removed", ui.showRemoved.checked)),
  );
  ui.showRejected.addEventListener("change", () =>
    updateViewer((view) => view.setVisible("rejected", ui.showRejected.checked)),
  );
  ui.resetCamera.addEventListener("click", () => updateViewer((view) => view.resetCamera()));

  for (const tab of document.querySelectorAll<HTMLButtonElement>(".tab")) {
    tab.addEventListener("click", () => selectTab(tab.dataset.tab ?? "results"));
  }
}

async function fillExampleList(): Promise<void> {
  try {
    for (const name of await listExamples()) {
      ui.exampleSelect.append(new Option(name, name));
    }
  } catch (error) {
    showStatus(errorText(error), true);
  }
}

bindEvents();
render();
void fillExampleList();
void startViewer();
