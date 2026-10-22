// The page: input forms (network and flow), generation and flow in the
// worker, 3D view and output files.
import "./style.css";
import { strToU8, zipSync } from "fflate";
import { exampleDescription, listExamples, loadExample } from "./examples";
import { renderFlowForm } from "./flow/form";
import { triangleGridToPolyData } from "./flow/polyData";
import { defaultFlowState, FLOW_MESH_FILE, meshBoundaryNames, updateBoundaries, type FlowState } from "./flow/state";
import { flowStateToToml } from "./flow/toml";
import { renderForm } from "./form";
import type { FormContext } from "./form/context";
import type { FileHandlers } from "./form/files";
import { defaultFormState, type FormState } from "./form/state";
import { formStateToToml, InputFormError, tomlToFormState } from "./form/toml";
import {
  CancelledError,
  GenerationClient,
  type FlowInput,
  type FlowOutput,
  type GenerationInput,
  type GenerationOutput,
} from "./generationClient";
import { baseName, meshRegionNames, type InputFiles } from "./inputFiles";
import { NetworkViewer, type FractureLayer } from "./viewer";

const DEFAULT_COLOR_ARRAY = "family";
const PRESSURE_FILE = "pressure.vtu";

type SidebarTab = "network" | "flow";

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
  flowForm: byId<HTMLDivElement>("flow-form"),
  checkButton: byId<HTMLButtonElement>("check-button"),
  runButton: byId<HTMLButtonElement>("run-button"),
  cancelButton: byId<HTMLButtonElement>("cancel-button"),
  progress: byId<HTMLProgressElement>("progress"),
  status: byId<HTMLPreElement>("status"),
  colorSelect: byId<HTMLSelectElement>("color-select"),
  showMesh: byId<HTMLInputElement>("show-mesh"),
  showRemoved: byId<HTMLInputElement>("show-removed"),
  showRejected: byId<HTMLInputElement>("show-rejected"),
  showPressure: byId<HTMLInputElement>("show-pressure"),
  resetCamera: byId<HTMLButtonElement>("reset-camera"),
  canvas: byId<HTMLCanvasElement>("viewer-canvas"),
  viewerMessage: byId<HTMLDivElement>("viewer-message"),
  resultsEmpty: byId<HTMLParagraphElement>("results-empty"),
  results: byId<HTMLDivElement>("results"),
  resultsStats: byId<HTMLDListElement>("results-stats"),
  downloadAll: byId<HTMLButtonElement>("download-all"),
  downloadList: byId<HTMLUListElement>("download-list"),
  flowResults: byId<HTMLDivElement>("flow-results"),
  flowStats: byId<HTMLDListElement>("flow-stats"),
  flowDownloadAll: byId<HTMLButtonElement>("flow-download-all"),
  flowDownloadList: byId<HTMLUListElement>("flow-download-list"),
  log: byId<HTMLPreElement>("log"),
  flowLogTitle: byId<HTMLHeadingElement>("flow-log-title"),
  flowLog: byId<HTMLPreElement>("flow-log"),
  tomlPreview: byId<HTMLPreElement>("toml-preview"),
  copyToml: byId<HTMLButtonElement>("copy-toml"),
};

let state: FormState = defaultFormState();
let files: InputFiles = { mesh: null, userFractures: null };
let regionNames: string[] = [];
let output: GenerationOutput | null = null;
const flowState: FlowState = defaultFlowState();
let flowOutput: FlowOutput | null = null;
let activeSidebarTab: SidebarTab = "network";
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

const flowContext: FormContext = {
  regionNames: [],
  changed: () => updateTomlPreview(),
  rerender: () => renderFlow(),
};

function render(): void {
  renderForm(ui.form, state, files, formContext, fileHandlers);
  updateTomlPreview();
}

function renderFlow(): void {
  renderFlowForm(ui.flowForm, flowState, flowMesh() !== null, flowContext);
  updateTomlPreview();
}

/** The TOML of the form of the active sidebar tab */
function activeToml(): string {
  return activeSidebarTab === "flow" ? flowStateToToml(flowState) : formStateToToml(state);
}

function updateTomlPreview(): void {
  ui.tomlPreview.textContent = activeToml();
}

function selectSidebarTab(name: SidebarTab): void {
  activeSidebarTab = name;
  for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-sidebar-tab]")) {
    tab.classList.toggle("is-active", tab.dataset.sidebarTab === name);
  }
  ui.form.hidden = name !== "network";
  ui.flowForm.hidden = name !== "flow";
  ui.exampleDescription.hidden = name !== "network" || ui.exampleDescription.textContent === "";
  ui.runButton.textContent = name === "flow" ? "Solve flow" : "Generate";
  showStatus("");
  updateTomlPreview();
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
  ui.exampleDescription.hidden = description === "" || activeSidebarTab !== "network";
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

/** The flow input for the worker, or an error message */
function flowInput(): FlowInput | string {
  const mesh = flowMesh();
  if (mesh === null) {
    return `Generate a network with the mesh on first: the flow needs ${FLOW_MESH_FILE}.`;
  }
  if (ui.flowForm.querySelector(".is-invalid")) {
    return "A field of the form has an invalid value (red border). Correct it first.";
  }
  return { toml: flowStateToToml(flowState), mesh };
}

async function checkFlowInput(): Promise<void> {
  const input = flowInput();
  if (typeof input === "string") {
    showStatus(input, true);
    return;
  }
  setBusy(true);
  try {
    const error = await client.checkFlow(input);
    showStatus(error ?? "The flow input is valid.", error !== null);
  } catch (error) {
    showStatus(errorText(error), true);
  } finally {
    setBusy(false);
  }
}

async function runFlow(): Promise<void> {
  const input = flowInput();
  if (typeof input === "string") {
    showStatus(input, true);
    return;
  }
  setBusy(true, true);
  // fehm reports no progress: an indeterminate bar
  ui.progress.removeAttribute("value");
  showStatus("Solving the flow…");
  const startTime = performance.now();
  try {
    const result = await client.runFlow(input);
    ui.flowLog.textContent = result.log;
    ui.flowLogTitle.hidden = false;
    if (result.error !== null) {
      showStatus(result.error, true);
      return;
    }
    showStatus(
      `Done in ${durationText(performance.now() - startTime)}: ${result.newtonIterations} Newton iterations.`,
    );
    await showFlowOutput(result);
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
  clearFlowOutput();
  renderFlow();
}

/** The flow output belongs to the mesh of one generation */
function clearFlowOutput(): void {
  flowOutput = null;
  ui.flowResults.hidden = true;
  ui.flowLog.textContent = "";
  ui.flowLogTitle.hidden = true;
  ui.showPressure.checked = false;
  ui.showPressure.disabled = true;
  if (viewer) {
    void viewer.setPressure(null);
    applyLayerVisibility(viewer);
    void viewer.render();
  }
}

function outputFile(name: string): string | null {
  return output?.files.find(([fileName]) => fileName === name)?.[1] ?? null;
}

/** The triangle mesh of the last generation, the mesh of the flow */
function flowMesh(): string | null {
  return outputFile(FLOW_MESH_FILE);
}

function flowOutputFile(name: string): string | null {
  return flowOutput?.files.find(([fileName]) => fileName === name)?.[1] ?? null;
}

function showStats(list: HTMLDListElement, stats: [string, string][]): void {
  list.replaceChildren(
    ...stats.flatMap(([label, value]) => {
      const term = document.createElement("dt");
      term.textContent = label;
      const description = document.createElement("dd");
      description.textContent = value;
      return [term, description];
    }),
  );
}

function showDownloadLinks(list: HTMLUListElement, outputFiles: [string, string][]): void {
  list.replaceChildren(
    ...outputFiles.map(([name, text]) => {
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
}

function downloadZip(name: string, outputFiles: [string, string][]): void {
  const archive = zipSync(Object.fromEntries(outputFiles.map(([fileName, text]) => [fileName, strToU8(text)])));
  downloadText(name, archive, "application/zip");
}

async function showOutput(result: GenerationOutput): Promise<void> {
  clearFlowOutput();
  output = result;
  ui.resultsEmpty.hidden = true;
  ui.results.hidden = false;
  const mesh = flowMesh();
  updateBoundaries(flowState, mesh === null ? [] : meshBoundaryNames(mesh));
  renderFlow();

  showStats(ui.resultsStats, [
    ["Final fractures", String(result.finalCount)],
    ["Accepted fractures", String(result.acceptedCount)],
    ["Rejected fractures", String(result.rejectedCount)],
    ["Seed", result.seed],
  ]);
  showDownloadLinks(ui.downloadList, result.files);

  ui.showRejected.disabled = outputFile("fractures_rejected.vtp") === null;
  await showOutputInViewer();
}

function massFlowText(massFlow: number): string {
  return `${massFlow.toExponential(4)} kg/s`;
}

async function showFlowOutput(result: FlowOutput): Promise<void> {
  flowOutput = result;
  ui.flowResults.hidden = false;
  const netFlow = result.boundaryFlows.reduce((sum, boundary) => sum + boundary.massFlow, 0);
  showStats(ui.flowStats, [
    ...result.boundaryFlows.map(({ name, massFlow }): [string, string] => [`Into the network at ${name}`, massFlowText(massFlow)]),
    ["Net flow", massFlowText(netFlow)],
    ["Newton iterations", String(result.newtonIterations)],
  ]);
  showDownloadLinks(ui.flowDownloadList, result.files);

  ui.showPressure.disabled = false;
  ui.showPressure.checked = true;
  await showFlowInViewer();
}

async function showFlowInViewer(): Promise<void> {
  const pressure = flowOutputFile(PRESSURE_FILE);
  if (!viewer || pressure === null) {
    return;
  }
  await viewer.setPressure(triangleGridToPolyData(pressure));
  applyLayerVisibility(viewer);
  await viewer.render();
}

/** The pressure layer hides the fracture layers: they have the same surfaces */
function applyLayerVisibility(view: NetworkViewer): void {
  const isPressureVisible = ui.showPressure.checked && flowOutput !== null;
  view.showPressure(isPressureVisible);
  view.setVisible("final", !isPressureVisible);
  view.setVisible("removed", !isPressureVisible && ui.showRemoved.checked);
  view.setVisible("rejected", !isPressureVisible && ui.showRejected.checked);
}

async function showOutputInViewer(): Promise<void> {
  if (!viewer || !output) {
    return;
  }
  await viewer.setLayer("final", outputFile("fractures.vtp"));
  await viewer.setLayer("removed", outputFile("fractures_removed.vtp"));
  await viewer.setLayer("rejected", outputFile("fractures_rejected.vtp"));
  applyLayerVisibility(viewer);

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
  await showFlowInViewer();
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
  for (const tab of document.querySelectorAll<HTMLButtonElement>(".panel .tab")) {
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
  ui.saveToml.addEventListener("click", () =>
    downloadText(activeSidebarTab === "flow" ? "flow.toml" : "input.toml", activeToml()),
  );
  ui.copyToml.addEventListener("click", () => void navigator.clipboard.writeText(activeToml()));
  ui.checkButton.addEventListener("click", () => void (activeSidebarTab === "flow" ? checkFlowInput() : checkInput()));
  ui.runButton.addEventListener("click", () => void (activeSidebarTab === "flow" ? runFlow() : runGeneration()));
  ui.cancelButton.addEventListener("click", () => client.cancel());
  ui.downloadAll.addEventListener("click", () => {
    if (output) {
      downloadZip("dfngen_output.zip", output.files);
    }
  });
  ui.flowDownloadAll.addEventListener("click", () => {
    if (flowOutput) {
      downloadZip("fehm_output.zip", flowOutput.files);
    }
  });

  ui.colorSelect.addEventListener("change", () =>
    updateViewer((view) => view.colorBy(ui.colorSelect.value === "" ? null : ui.colorSelect.value)),
  );
  ui.showMesh.addEventListener("change", () => updateViewer((view) => view.setVisible("mesh", ui.showMesh.checked)));
  for (const checkbox of [ui.showRemoved, ui.showRejected, ui.showPressure]) {
    checkbox.addEventListener("change", () => updateViewer(applyLayerVisibility));
  }
  ui.resetCamera.addEventListener("click", () => updateViewer((view) => view.resetCamera()));

  for (const tab of document.querySelectorAll<HTMLButtonElement>(".panel .tab")) {
    tab.addEventListener("click", () => selectTab(tab.dataset.tab ?? "results"));
  }
  for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-sidebar-tab]")) {
    tab.addEventListener("click", () => selectSidebarTab(tab.dataset.sidebarTab === "flow" ? "flow" : "network"));
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
renderFlow();
void fillExampleList();
void startViewer();
