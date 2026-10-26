// The page: input forms (network, flow and transport), generation, flow and
// transport in the worker, 3D view and output files.
import "./style.css";
import { strToU8, zipSync } from "fflate";
import { listExamples, loadExample } from "./examples";
import { renderFlowForm } from "./flow/form";
import { addPointArray, triangleGridToPolyData } from "./flow/polyData";
import { defaultFlowState, FLOW_MESH_FILE, meshBoundaryNames, updateBoundaries, type FlowState } from "./flow/state";
import { flowToLibraryToml } from "./flow/toml";
import { renderForm } from "./form";
import type { FormContext } from "./form/context";
import type { FileHandlers } from "./form/files";
import { defaultFormState, type FormState } from "./form/state";
import { InputFormError, networkToLibraryToml } from "./form/toml";
import {
  CancelledError,
  GenerationClient,
  type FlowInput,
  type FlowOutput,
  type GenerationInput,
  type GenerationOutput,
  type TransportInput,
  type TransportOutput,
} from "./generationClient";
import { meshRegionNames, type InputFiles } from "./inputFiles";
import { renderTransportForm } from "./transport/form";
import { defaultTransportState, updateTransportBoundaries, type TransportState } from "./transport/state";
import { transportToLibraryToml } from "./transport/toml";
import { markVelocityAsVectors } from "./transport/trajectories";
import { NetworkViewer, PRESSURE_ARRAY, type ColorArray, type FractureLayer } from "./viewer";
import { workflowToToml, type Workflow } from "./workflow";

const DEFAULT_COLOR_OPTION = "cell:fracture_id";
const PRESSURE_FILE = "pressure.vtu";
const PRESSURE_OPTION = colorOptionValue(PRESSURE_ARRAY);
const TRAJECTORIES_FILE = "trajectories.vtp";

type SidebarTab = "network" | "flow" | "transport";

const RUN_BUTTON_TEXT: Record<SidebarTab, string> = {
  network: "Generate",
  flow: "Solve flow",
  transport: "Track particles",
};
const DEFAULT_INPUT_FILE = "workflow.toml";

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
  form: byId<HTMLDivElement>("form"),
  flowForm: byId<HTMLDivElement>("flow-form"),
  transportForm: byId<HTMLDivElement>("transport-form"),
  checkButton: byId<HTMLButtonElement>("check-button"),
  runButton: byId<HTMLButtonElement>("run-button"),
  cancelButton: byId<HTMLButtonElement>("cancel-button"),
  progress: byId<HTMLProgressElement>("progress"),
  status: byId<HTMLPreElement>("status"),
  colorSelect: byId<HTMLSelectElement>("color-select"),
  showDomain: byId<HTMLInputElement>("show-domain"),
  showMesh: byId<HTMLInputElement>("show-mesh"),
  showRemoved: byId<HTMLInputElement>("show-removed"),
  showRejected: byId<HTMLInputElement>("show-rejected"),
  showTrajectories: byId<HTMLInputElement>("show-trajectories"),
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
  flowDownloadList: byId<HTMLUListElement>("flow-download-list"),
  transportResults: byId<HTMLDivElement>("transport-results"),
  transportStats: byId<HTMLDListElement>("transport-stats"),
  transportDownloadList: byId<HTMLUListElement>("transport-download-list"),
  log: byId<HTMLPreElement>("log"),
  flowLogTitle: byId<HTMLHeadingElement>("flow-log-title"),
  flowLog: byId<HTMLPreElement>("flow-log"),
  transportLogTitle: byId<HTMLHeadingElement>("transport-log-title"),
  transportLog: byId<HTMLPreElement>("transport-log"),
  tomlPreview: byId<HTMLPreElement>("toml-preview"),
  copyToml: byId<HTMLButtonElement>("copy-toml"),
};

let state: FormState = defaultFormState();
let files: InputFiles = { mesh: null, userFractures: null };
let regionNames: string[] = [];
/** The description (comment) and the file name of the workflow file */
let description = "";
let inputFileName = DEFAULT_INPUT_FILE;
let output: GenerationOutput | null = null;
/** The network input of `output` */
let outputNetwork: FormState | null = null;
let flowState: FlowState = defaultFlowState();
let flowOutput: FlowOutput | null = null;
/** The flow input of `flowOutput` */
let outputFlow: FlowState | null = null;
/** The flow TOML of `flowOutput`: the transport solves this flow again */
let flowOutputToml: string | null = null;
let transportState: TransportState = defaultTransportState();
let transportOutput: TransportOutput | null = null;
/** The transport input of `transportOutput` */
let outputTransport: TransportState | null = null;
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

const transportContext: FormContext = {
  regionNames: [],
  changed: () => updateTomlPreview(),
  rerender: () => renderTransport(),
};

function render(): void {
  renderForm(ui.form, state, files, formContext, fileHandlers);
  updateTomlPreview();
}

function renderFlow(): void {
  renderFlowForm(ui.flowForm, flowState, flowMesh() !== null, flowContext);
  updateTomlPreview();
}

function renderTransport(): void {
  renderTransportForm(ui.transportForm, transportState, flowOutput !== null, transportContext);
  updateTomlPreview();
}

/** The workflow file of the three forms */
function workflowText(): string {
  return workflowToToml({ description, network: state, flow: flowState, transport: transportState });
}

function updateTomlPreview(): void {
  ui.tomlPreview.textContent = workflowText();
}

function selectSidebarTab(name: SidebarTab): void {
  activeSidebarTab = name;
  for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-sidebar-tab]")) {
    tab.classList.toggle("is-active", tab.dataset.sidebarTab === name);
  }
  ui.form.hidden = name !== "network";
  ui.flowForm.hidden = name !== "flow";
  ui.transportForm.hidden = name !== "transport";
  ui.exampleDescription.hidden = name !== "network" || ui.exampleDescription.textContent === "";
  ui.runButton.textContent = RUN_BUTTON_TEXT[name];
  showStatus("");
}

async function setMesh(mesh: InputFiles["mesh"]): Promise<void> {
  files.mesh = mesh;
  regionNames = mesh === null ? [] : meshRegionNames(mesh.text);
  clearOutput();
  if (viewer && mesh) {
    await viewer.setDomainMesh(mesh.text);
    viewer.setVisible("domain", ui.showDomain.checked);
    viewer.resetCamera();
    await viewer.render();
  }
}

/** Loads a new workflow into the three forms: the old output does not belong to it */
async function loadInput(workflow: Workflow, newFiles: InputFiles, fileName: string): Promise<void> {
  state = workflow.network;
  flowState = workflow.flow;
  transportState = workflow.transport;
  description = workflow.description;
  inputFileName = fileName;
  files = { mesh: null, userFractures: newFiles.userFractures };
  await setMesh(newFiles.mesh);
  ui.exampleDescription.textContent = description;
  ui.exampleDescription.hidden = description === "" || activeSidebarTab !== "network";
  showStatus("");
  render();
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
    toml: networkToLibraryToml(state),
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
  const network = structuredClone(state);
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
    outputNetwork = network;
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
    return `Generate a network first: the flow needs ${FLOW_MESH_FILE}.`;
  }
  if (ui.flowForm.querySelector(".is-invalid")) {
    return "A field of the form has an invalid value (red border). Correct it first.";
  }
  return { toml: flowToLibraryToml(flowState), mesh };
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
  const flow = structuredClone(flowState);
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
    await showFlowOutput(result, input.toml);
    outputFlow = flow;
  } catch (error) {
    showStatus(error instanceof CancelledError ? "Cancelled." : errorText(error), !(error instanceof CancelledError));
  } finally {
    setBusy(false);
  }
}

/** The transport input for the worker, or an error message */
function transportInput(): TransportInput | string {
  const mesh = flowMesh();
  if (mesh === null || flowOutputToml === null) {
    return "Solve the flow first: the transport needs its flow input.";
  }
  if (ui.transportForm.querySelector(".is-invalid")) {
    return "A field of the form has an invalid value (red border). Correct it first.";
  }
  return { toml: transportToLibraryToml(transportState), flowToml: flowOutputToml, mesh };
}

async function checkTransportInput(): Promise<void> {
  const input = transportInput();
  if (typeof input === "string") {
    showStatus(input, true);
    return;
  }
  setBusy(true);
  try {
    const error = await client.checkTransport(input);
    showStatus(error ?? "The transport input is valid.", error !== null);
  } catch (error) {
    showStatus(errorText(error), true);
  } finally {
    setBusy(false);
  }
}

async function runTransport(): Promise<void> {
  const input = transportInput();
  if (typeof input === "string") {
    showStatus(input, true);
    return;
  }
  setBusy(true, true);
  // dfntrans reports no progress: an indeterminate bar
  ui.progress.removeAttribute("value");
  showStatus("Tracking the particles…");
  const transport = structuredClone(transportState);
  const startTime = performance.now();
  try {
    const result = await client.runTransport(input);
    ui.transportLog.textContent = result.log;
    ui.transportLogTitle.hidden = false;
    if (result.error !== null) {
      showStatus(result.error, true);
      return;
    }
    showStatus(
      `Done in ${durationText(performance.now() - startTime)}: ${result.exitCount} of ${result.particleCount} particles exited.`,
    );
    await showTransportOutput(result);
    outputTransport = transport;
  } catch (error) {
    showStatus(error instanceof CancelledError ? "Cancelled." : errorText(error), !(error instanceof CancelledError));
  } finally {
    setBusy(false);
  }
}

// ---------------------------------------------------------------- output

function clearOutput(): void {
  output = null;
  outputNetwork = null;
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
  outputFlow = null;
  flowOutputToml = null;
  ui.flowResults.hidden = true;
  ui.flowLog.textContent = "";
  ui.flowLogTitle.hidden = true;
  clearTransportOutput();
  renderTransport();
}

/** The transport output belongs to one flow output */
function clearTransportOutput(): void {
  transportOutput = null;
  outputTransport = null;
  ui.transportResults.hidden = true;
  ui.transportLog.textContent = "";
  ui.transportLogTitle.hidden = true;
  ui.showTrajectories.checked = false;
  ui.showTrajectories.disabled = true;
  if (viewer) {
    void viewer.setTrajectories(null);
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

function transportOutputFile(name: string): string | null {
  return transportOutput?.files.find(([fileName]) => fileName === name)?.[1] ?? null;
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

/**
 * One zip of the workflow: the workflow file with the input of each output
 * (the form for a step with no output), and the folders network/, flow/ and
 * transport/ with the output files.
 */
function downloadAllOutput(): void {
  const workflow = workflowToToml({
    description,
    network: outputNetwork ?? state,
    flow: outputFlow ?? flowState,
    transport: outputTransport ?? transportState,
  });
  const folders: [string, [string, string][]][] = [
    ["network", output?.files ?? []],
    ["flow", flowOutput?.files ?? []],
    ["transport", transportOutput?.files ?? []],
  ];
  const entries: [string, Uint8Array][] = [[inputFileName, strToU8(workflow)]];
  for (const [folder, outputFiles] of folders) {
    entries.push(...outputFiles.map(([name, text]): [string, Uint8Array] => [`${folder}/${name}`, strToU8(text)]));
  }
  const archiveName = `${inputFileName.replace(/\.toml$/, "")}_output.zip`;
  downloadText(archiveName, zipSync(Object.fromEntries(entries)), "application/zip");
}

async function showOutput(result: GenerationOutput): Promise<void> {
  clearFlowOutput();
  output = result;
  ui.resultsEmpty.hidden = true;
  ui.results.hidden = false;
  const mesh = flowMesh();
  const boundaryNames = mesh === null ? [] : meshBoundaryNames(mesh);
  updateBoundaries(flowState, boundaryNames);
  updateTransportBoundaries(transportState, boundaryNames);
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

async function showFlowOutput(result: FlowOutput, toml: string): Promise<void> {
  clearTransportOutput();
  flowOutput = result;
  flowOutputToml = toml;
  renderTransport();
  ui.flowResults.hidden = false;
  const netFlow = result.boundaryFlows.reduce((sum, boundary) => sum + boundary.massFlow, 0);
  showStats(ui.flowStats, [
    ...result.boundaryFlows.map(({ name, massFlow }): [string, string] => [`Into the network at ${name}`, massFlowText(massFlow)]),
    ["Net flow", massFlowText(netFlow)],
    ["Newton iterations", String(result.newtonIterations)],
  ]);
  showDownloadLinks(ui.flowDownloadList, result.files);

  await showOutputInViewer(PRESSURE_OPTION);
}

function volumeFluxText(volumeFlux: number): string {
  return `${volumeFlux.toExponential(4)} m³/s`;
}

async function showTransportOutput(result: TransportOutput): Promise<void> {
  transportOutput = result;
  ui.transportResults.hidden = false;
  showStats(ui.transportStats, [
    ["Particles", String(result.particleCount)],
    ["Exited particles", String(result.exitCount)],
    ["In-flow volume flux", volumeFluxText(result.inflowVolumeFlux)],
    ["Out-flow volume flux", volumeFluxText(result.outflowVolumeFlux)],
    ["Seed", String(result.seed)],
  ]);
  showDownloadLinks(ui.transportDownloadList, result.files);

  const hasTrajectories = transportOutputFile(TRAJECTORIES_FILE) !== null;
  ui.showTrajectories.disabled = !hasTrajectories;
  ui.showTrajectories.checked = hasTrajectories;
  await showTransportInViewer();
}

async function showTransportInViewer(): Promise<void> {
  const trajectories = transportOutputFile(TRAJECTORIES_FILE);
  if (!viewer || trajectories === null) {
    return;
  }
  await viewer.setTrajectories(markVelocityAsVectors(trajectories));
  applyLayerVisibility(viewer);
  await viewer.render();
}

function applyLayerVisibility(view: NetworkViewer): void {
  view.setVisible("final", ui.showMesh.checked);
  view.setVisible("removed", ui.showRemoved.checked);
  view.setVisible("rejected", ui.showRejected.checked);
  view.setVisible("trajectories", ui.showTrajectories.checked);
}

/** The value of a "Color by" option: `<association>:<name>`, "" = one color */
function colorOptionValue(colorArray: ColorArray): string {
  return `${colorArray.association}:${colorArray.name}`;
}

/** The array of a "Color by" option value; null = one color */
function colorArrayOf(optionValue: string): ColorArray | null {
  const separator = optionValue.indexOf(":");
  if (separator < 0) {
    return null;
  }
  const association = optionValue.slice(0, separator) === "point" ? "point" : "cell";
  return { name: optionValue.slice(separator + 1), association };
}

/** The triangle mesh of the final fractures, with the pressure of the flow if there is one */
function meshWithPressure(mesh: string): string {
  const pressure = flowOutputFile(PRESSURE_FILE);
  return pressure === null ? mesh : addPointArray(mesh, pressure, PRESSURE_ARRAY.name);
}

/**
 * Shows the output of the generation and the pressure of the flow. "Color
 * by" selects `selected`; else it keeps its array if the new mesh has it;
 * else `fracture_id`.
 */
async function showOutputInViewer(selected: string | null = null): Promise<void> {
  if (!viewer || !output) {
    return;
  }
  const mesh = flowMesh();
  await viewer.setLayer("final", mesh === null ? null : triangleGridToPolyData(meshWithPressure(mesh)));
  await viewer.setLayer("removed", outputFile("fractures_removed.vtp"));
  await viewer.setLayer("rejected", outputFile("fractures_rejected.vtp"));
  applyLayerVisibility(viewer);

  const previous = ui.colorSelect.value;
  const options = (await viewer.cellArrayNames()).map((name) => new Option(name, colorOptionValue({ name, association: "cell" })));
  if (flowOutputFile(PRESSURE_FILE) !== null) {
    options.push(new Option("Pressure", PRESSURE_OPTION));
  }
  ui.colorSelect.replaceChildren(new Option("One color", ""), ...options);
  const values = options.map((option) => option.value);
  ui.colorSelect.value =
    [selected, previous, DEFAULT_COLOR_OPTION].find((value) => value !== null && values.includes(value)) ?? "";
  ui.colorSelect.disabled = false;
  await viewer.colorBy(colorArrayOf(ui.colorSelect.value));
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
    await viewer.setDomainMesh(files.mesh.text);
    viewer.setVisible("domain", ui.showDomain.checked);
  }
  await showOutputInViewer();
  await showTransportInViewer();
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
      await loadInput(example.workflow, example.files, `${name}.toml`);
      ui.form.dataset.example = name;
    } catch (error) {
      showStatus(errorText(error), true);
    }
  });
  ui.copyToml.addEventListener("click", () => void navigator.clipboard.writeText(workflowText()));
  const checkActions: Record<SidebarTab, () => Promise<void>> = {
    network: checkInput,
    flow: checkFlowInput,
    transport: checkTransportInput,
  };
  const runActions: Record<SidebarTab, () => Promise<void>> = {
    network: runGeneration,
    flow: runFlow,
    transport: runTransport,
  };
  ui.checkButton.addEventListener("click", () => void checkActions[activeSidebarTab]());
  ui.runButton.addEventListener("click", () => void runActions[activeSidebarTab]());
  ui.cancelButton.addEventListener("click", () => client.cancel());
  ui.downloadAll.addEventListener("click", downloadAllOutput);

  ui.colorSelect.addEventListener("change", () =>
    updateViewer((view) => view.colorBy(colorArrayOf(ui.colorSelect.value))),
  );
  ui.showDomain.addEventListener("change", () => updateViewer((view) => view.setVisible("domain", ui.showDomain.checked)));
  for (const checkbox of [ui.showMesh, ui.showRemoved, ui.showRejected, ui.showTrajectories]) {
    checkbox.addEventListener("change", () => updateViewer(applyLayerVisibility));
  }
  ui.resetCamera.addEventListener("click", () => updateViewer((view) => view.resetCamera()));

  for (const tab of document.querySelectorAll<HTMLButtonElement>(".panel .tab")) {
    tab.addEventListener("click", () => selectTab(tab.dataset.tab ?? "results"));
  }
  for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-sidebar-tab]")) {
    tab.addEventListener("click", () => {
      const name = tab.dataset.sidebarTab;
      selectSidebarTab(name === "flow" || name === "transport" ? name : "network");
    });
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
renderTransport();
void fillExampleList();
void startViewer();
