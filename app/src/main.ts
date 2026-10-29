// The page: input forms (network, flow and transport), generation, flow and
// transport in the worker, 3D view and output files.
import "./style.css";
import {
  defaultBoundaryRoles,
  flowSurfaces,
  roleOf,
  setRole,
  surfacesWithPoints,
  type BoundaryRoles,
} from "./boundaryRoles";
import { boundarySurfacePolyData, DEFAULT_SURFACE_COLORS, domainBoundarySurfaceNames } from "./boundarySurfaces";
import { toolErrorText } from "./errors";
import { listExamples, loadExample, loadExampleTitle } from "./examples";
import { renderFlowForm, type FlowBoundary } from "./flow/form";
import { addArray, addPointArray, pointCount, triangleGridToPolyData, vectorMagnitudes } from "./flow/polyData";
import { defaultFlowState, FLOW_MESH_FILE, type FlowState } from "./flow/state";
import { flowToLibraryToml } from "./flow/toml";
import { renderForm } from "./form";
import type { FormContext } from "./form/context";
import { boundarySurfaceSection, type FileHandlers } from "./form/files";
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
import {
  dataArrayValues,
  meshDescription,
  meshRegionBounds,
  meshRegionNames,
  type InputFiles,
  type RegionBounds,
} from "./inputFiles";
import { listMeshes, loadMesh, meshDisplayName } from "./meshes";
import { renderTransportForm } from "./transport/form";
import { defaultTransportState, type TimeUnit, type TransportState } from "./transport/state";
import { transportToLibraryToml } from "./transport/toml";
import { markVelocityAsVectors } from "./transport/trajectories";
import { nodeVelocityMagnitudes } from "./transport/velocities";
import { userFracturesToVtp } from "./userFractures";
import {
  FLOW_VELOCITY_ARRAY,
  NetworkViewer,
  PRESSURE_ARRAY,
  TRANSPORT_VELOCITY_ARRAY,
  type ColorArray,
  type FractureLayer,
} from "./viewer";
import type { Workflow } from "./workflow";

const DEFAULT_COLOR_OPTION = "cell:fracture_id";
const PRESSURE_FILE = "pressure.vtu";
// The example of the page at the start
const DEFAULT_EXAMPLE = "box_west_east";
const PRESSURE_OPTION = colorOptionValue(PRESSURE_ARRAY);
const TRAJECTORIES_FILE = "trajectories.vtp";
const VELOCITIES_FILE = "velocities.vtp";
const FLOW_VELOCITY_OPTION = colorOptionValue(FLOW_VELOCITY_ARRAY);
const TRANSPORT_VELOCITY_OPTION = colorOptionValue(TRANSPORT_VELOCITY_ARRAY);
// The generation keeps all clusters when none connects an in-flow and an out-flow surface
const NO_CONNECTING_CLUSTER =
  "No cluster connects an in-flow and an out-flow surface: all clusters stay. The particles need a path between them; increase the number of fractures or their size, try another seed, or change the roles of the surfaces (Domain tab).";

// The domain, the user fractures and the network are the three tabs of the network input
const SIDEBAR_TABS = ["domain", "fractures", "network", "flow", "transport"] as const;
type SidebarTab = (typeof SIDEBAR_TABS)[number];

/** The text of the run button; null = no run button (the domain and the user fractures: "Generate" is on the DFN tab) */
const RUN_BUTTON_TEXT: Record<SidebarTab, string | null> = {
  domain: null,
  fractures: null,
  network: "Generate",
  flow: "Solve flow",
  transport: "Track particles",
};

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`missing element #${id}`);
  }
  return node as T;
}

const ui = {
  domainSource: byId<HTMLFieldSetElement>("domain-source"),
  exampleSelect: byId<HTMLSelectElement>("example-select"),
  exampleRow: byId<HTMLLabelElement>("example-row"),
  exampleDescription: byId<HTMLParagraphElement>("example-description"),
  domainForm: byId<HTMLDivElement>("domain-form"),
  shapeDescription: byId<HTMLParagraphElement>("shape-description"),
  boundarySurfaces: byId<HTMLDivElement>("boundary-surfaces"),
  fracturesForm: byId<HTMLDivElement>("fractures-form"),
  form: byId<HTMLDivElement>("form"),
  flowForm: byId<HTMLDivElement>("flow-form"),
  transportForm: byId<HTMLDivElement>("transport-form"),
  runButton: byId<HTMLButtonElement>("run-button"),
  cancelButton: byId<HTMLButtonElement>("cancel-button"),
  nextButton: byId<HTMLButtonElement>("next-button"),
  progress: byId<HTMLProgressElement>("progress"),
  status: byId<HTMLPreElement>("status"),
  colorSelect: byId<HTMLSelectElement>("color-select"),
  showDomain: byId<HTMLInputElement>("show-domain"),
  showMesh: byId<HTMLInputElement>("show-mesh"),
  showUserFractures: byId<HTMLInputElement>("show-user-fractures"),
  showRemoved: byId<HTMLInputElement>("show-removed"),
  showRejected: byId<HTMLInputElement>("show-rejected"),
  showTrajectories: byId<HTMLInputElement>("show-trajectories"),
  resetCamera: byId<HTMLButtonElement>("reset-camera"),
  canvas: byId<HTMLCanvasElement>("viewer-canvas"),
  viewerMessage: byId<HTMLDivElement>("viewer-message"),
  resultsBezel: byId<HTMLDivElement>("results-bezel"),
  results: byId<HTMLDetailsElement>("results"),
  resultsStats: byId<HTMLDListElement>("results-stats"),
  flowResults: byId<HTMLDetailsElement>("flow-results"),
  flowStats: byId<HTMLDListElement>("flow-stats"),
  transportResults: byId<HTMLDetailsElement>("transport-results"),
  transportStats: byId<HTMLDListElement>("transport-stats"),
};

let state: FormState = defaultFormState();
let files: InputFiles = { mesh: null };
let regionNames: string[] = [];
let regionBounds: RegionBounds[] = [];
let boundarySurfaceNames: string[] = [];
/** The roles of the boundary surfaces (Domain tab) */
let boundaryRoles: BoundaryRoles = { inflow: [], outflow: [] };
/** The colors which the user chose, by boundary surface name; they stay while the page is open */
const boundarySurfaceColors = new Map<string, string>();
let meshNames: string[] = [];
/** The description (comment) of the workflow file */
let description = "";
let output: GenerationOutput | null = null;
let flowState: FlowState = defaultFlowState();
let flowOutput: FlowOutput | null = null;
/** The flow TOML of `flowOutput`: the transport solves this flow again */
let flowOutputToml: string | null = null;
let transportState: TransportState = defaultTransportState();
let transportOutput: TransportOutput | null = null;
/** The time unit of the input of `transportOutput`: the unit of its velocities */
let transportTimeUnit: TimeUnit = "days";
let activeSidebarTab: SidebarTab = "domain";
/** The last predefined mesh of the "Predefined domain shape" mode; null = none yet (the first mesh) */
let lastShape: string | null = null;
let isBusy = false;
let viewer: NetworkViewer | null = null;
const client = new GenerationClient();

// ---------------------------------------------------------------- status

function showStatus(text: string, isError = false): void {
  ui.status.hidden = text === "";
  ui.status.textContent = text;
  ui.status.classList.toggle("is-error", isError);
  ui.status.classList.remove("is-warning");
}

/** A status which is not an error, but which the user must see */
function showWarningStatus(text: string): void {
  showStatus(text);
  ui.status.classList.add("is-warning");
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

/** A run in the worker: the buttons are disabled, and "Cancel" and the progress bar show */
function setBusy(busy: boolean): void {
  isBusy = busy;
  ui.runButton.disabled = busy;
  ui.exampleSelect.disabled = busy;
  ui.domainSource.disabled = busy;
  ui.cancelButton.hidden = !busy;
  ui.progress.hidden = !busy;
  updateNextButton();
}

/**
 * "Next" goes to the next tab; the Transport tab has none. On the DFN tab it
 * needs the fracture mesh of a generation with a cluster which connects an
 * in-flow and an out-flow surface, on the Flow tab a solved flow.
 */
function updateNextButton(): void {
  const isLastTab = activeSidebarTab === SIDEBAR_TABS[SIDEBAR_TABS.length - 1];
  const isNetworkMissing = flowMesh() === null || output?.isWithoutConnectingCluster === true;
  const isOutputMissing =
    (activeSidebarTab === "network" && isNetworkMissing) || (activeSidebarTab === "flow" && flowOutput === null);
  ui.nextButton.hidden = isLastTab;
  ui.nextButton.disabled = isBusy || isOutputMissing;
}

// ---------------------------------------------------------------- form

const formContext: FormContext = {
  get regionNames() {
    return regionNames;
  },
  get meshNames() {
    return meshNames;
  },
  get regionBounds() {
    return regionBounds;
  },
  boundarySurfaceColor: (name) => knownBoundarySurfaceColor(name),
  changed: () => updateUserFracturesInViewer(),
  rerender: () => render(),
};

const fileHandlers: FileHandlers = {
  chooseMesh: async (name) => {
    try {
      const mesh = await loadMesh(name);
      state.domain = name;
      lastShape = name;
      boundaryRoles = defaultBoundaryRoles(domainBoundarySurfaceNames(mesh.text));
      await setMesh(mesh);
      render();
    } catch (error) {
      showStatus(errorText(error), true);
    }
  },
};

const flowContext: FormContext = {
  regionNames: [],
  meshNames: [],
  regionBounds: [],
  boundarySurfaceColor: (name) => knownBoundarySurfaceColor(name),
  changed: () => {},
  rerender: () => renderFlow(),
};

const transportContext: FormContext = {
  regionNames: [],
  meshNames: [],
  regionBounds: [],
  boundarySurfaceColor: (name) => knownBoundarySurfaceColor(name),
  changed: () => {},
  rerender: () => renderTransport(),
};

function render(): void {
  renderForm({ domain: ui.domainForm, fractures: ui.fracturesForm, network: ui.form }, state, formContext, fileHandlers);
  updateUserFracturesInViewer();
}

/** The pressure boundaries of the flow form; null without a triangle mesh */
function flowBoundaries(): FlowBoundary[] | null {
  const mesh = flowMesh();
  if (mesh === null) {
    return null;
  }
  const withPoints = surfacesWithPoints(mesh, flowSurfaces(boundaryRoles));
  return flowSurfaces(boundaryRoles).map((name) => ({
    name,
    isInflow: roleOf(boundaryRoles, name) === "inflow",
    hasPoints: withPoints.includes(name),
  }));
}

function renderFlow(): void {
  renderFlowForm(ui.flowForm, flowState, flowBoundaries(), flowContext);
}

function renderTransport(): void {
  renderTransportForm(ui.transportForm, transportState, flowOutput !== null, transportContext);
}

function selectSidebarTab(name: SidebarTab): void {
  activeSidebarTab = name;
  for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-sidebar-tab]")) {
    tab.classList.toggle("is-active", tab.dataset.sidebarTab === name);
  }
  updateDomainSource();
  ui.fracturesForm.hidden = name !== "fractures";
  ui.form.hidden = name !== "network";
  ui.flowForm.hidden = name !== "flow";
  ui.transportForm.hidden = name !== "transport";
  const runText = RUN_BUTTON_TEXT[name];
  ui.runButton.hidden = runText === null;
  ui.runButton.textContent = runText ?? "";
  updateNextButton();
  showStatus("");
}

/** The radio button "Example" of the Domain tab is selected (else "Predefined domain shape") */
function isExampleSource(): boolean {
  return ui.domainSource.querySelector<HTMLInputElement>("input:checked")?.value === "example";
}

/** The radio buttons of the Domain tab: the example dropdown and its description, or the predefined meshes */
function updateDomainSource(): void {
  const isDomainTab = activeSidebarTab === "domain";
  const isExample = isExampleSource();
  ui.domainSource.hidden = !isDomainTab;
  ui.exampleRow.hidden = !isDomainTab || !isExample;
  ui.exampleDescription.hidden = !isDomainTab || !isExample || ui.exampleDescription.textContent === "";
  ui.domainForm.hidden = !isDomainTab || isExample;
  ui.shapeDescription.hidden = !isDomainTab || isExample || ui.shapeDescription.textContent === "";
  ui.boundarySurfaces.hidden = !isDomainTab || boundarySurfaceNames.length === 0;
}

/** The color of a boundary surface: the chosen one, else a default color from its position in the mesh */
function boundarySurfaceColor(name: string): string {
  const index = Math.max(0, boundarySurfaceNames.indexOf(name));
  return boundarySurfaceColors.get(name) ?? DEFAULT_SURFACE_COLORS[index % DEFAULT_SURFACE_COLORS.length];
}

/** The color of a boundary surface of the domain mesh; null for another name */
function knownBoundarySurfaceColor(name: string): string | null {
  return boundarySurfaceNames.includes(name) ? boundarySurfaceColor(name) : null;
}

function renderBoundarySurfaces(): void {
  ui.boundarySurfaces.replaceChildren(
    boundarySurfaceSection(boundarySurfaceNames, {
      colorOf: boundarySurfaceColor,
      onColor: (name, color) => {
        boundarySurfaceColors.set(name, color);
        // The Flow tab shows the color before the name of the boundary
        renderFlow();
        void updateViewer((view) => view.setBoundarySurfaceColor(name, color));
      },
      roleOf: (name) => roleOf(boundaryRoles, name),
      onRole: (name, role) => {
        setRole(boundaryRoles, name, role, boundarySurfaceNames);
        // The network keeps the clusters which connect the in-flow and out-flow surfaces
        clearOutput();
      },
    }),
  );
  updateDomainSource();
}

/** Shows the domain mesh and its boundary surfaces */
async function showDomainInViewer(view: NetworkViewer, mesh: NonNullable<InputFiles["mesh"]>): Promise<void> {
  await view.setDomainMesh(mesh.text);
  await view.setBoundarySurfaces(
    boundarySurfaceNames.map((name) => ({
      name,
      vtpText: boundarySurfacePolyData(mesh.text, name),
      color: boundarySurfaceColor(name),
    })),
  );
  view.setVisible("domain", ui.showDomain.checked);
}

async function setMesh(mesh: InputFiles["mesh"]): Promise<void> {
  files.mesh = mesh;
  regionNames = mesh === null ? [] : meshRegionNames(mesh.text);
  regionBounds = mesh === null ? [] : meshRegionBounds(mesh.text);
  boundarySurfaceNames = mesh === null ? [] : domainBoundarySurfaceNames(mesh.text);
  ui.shapeDescription.textContent = mesh === null ? "" : meshDescription(mesh.text);
  renderBoundarySurfaces();
  clearOutput();
  if (viewer && mesh) {
    await showDomainInViewer(viewer, mesh);
    viewer.resetCamera();
    await viewer.render();
  }
}

/** Loads a new workflow into the three forms: the old output does not belong to it */
async function loadInput(workflow: Workflow, newFiles: InputFiles): Promise<void> {
  boundaryRoles = workflow.boundaries;
  state = workflow.network;
  flowState = workflow.flow;
  transportState = workflow.transport;
  description = workflow.description;
  files = { mesh: null };
  await setMesh(newFiles.mesh);
  ui.exampleDescription.textContent = description;
  updateDomainSource();
  showStatus("");
  render();
}

// ---------------------------------------------------------------- run

/** The input for the worker, or an error message */
function generationInput(): GenerationInput | string {
  if ([ui.domainForm, ui.fracturesForm, ui.form].some((tab) => tab.querySelector(".is-invalid"))) {
    return "A field of the form has an invalid value (red border). Correct it first.";
  }
  if (files.mesh === null) {
    return state.domain === ""
      ? "Choose a domain shape."
      : `The domain shape ${meshDisplayName(state.domain)} is not available. Choose a domain shape.`;
  }
  const unknownRegion = state.userFractures.find((fracture) => !regionNames.includes(fracture.region));
  if (unknownRegion !== undefined) {
    return `The region ${unknownRegion.region} of a user-defined fracture is not in the domain mesh. Choose another region.`;
  }
  return {
    toml: networkToLibraryToml(state, boundaryRoles),
    mesh: files.mesh.text,
    userFractures: state.userFractures.length === 0 ? undefined : userFracturesToVtp(state.userFractures, regionNames),
  };
}

async function runGeneration(): Promise<void> {
  const input = generationInput();
  if (typeof input === "string") {
    showStatus(input, true);
    return;
  }
  setBusy(true);
  ui.progress.value = 0;
  showStatus("Generating…");
  const startTime = performance.now();
  try {
    const result = await client.run(input, (acceptedCount, fraction) => {
      ui.progress.value = fraction;
      showStatus(`Generating… ${acceptedCount} fractures accepted`);
    });
    if (result.error !== null) {
      showStatus(toolErrorText(result.error), true);
      return;
    }
    const doneText = `Done in ${durationText(performance.now() - startTime)}: ${result.finalCount} final fractures.`;
    if (result.isWithoutConnectingCluster) {
      showWarningStatus(`${doneText}\n${NO_CONNECTING_CLUSTER}`);
    } else {
      showStatus(doneText);
    }
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
    return "Generate a network first: the flow needs its triangle mesh.";
  }
  if (ui.flowForm.querySelector(".is-invalid")) {
    return "A field of the form has an invalid value (red border). Correct it first.";
  }
  return { toml: flowToLibraryToml(flowState, surfacesWithPoints(mesh, flowSurfaces(boundaryRoles))), mesh };
}

async function runFlow(): Promise<void> {
  const input = flowInput();
  if (typeof input === "string") {
    showStatus(input, true);
    return;
  }
  setBusy(true);
  // fehm reports no progress: an indeterminate bar
  ui.progress.removeAttribute("value");
  showStatus("Solving the flow…");
  const startTime = performance.now();
  try {
    const result = await client.runFlow(input);
    if (result.error !== null) {
      showStatus(toolErrorText(result.error), true);
      return;
    }
    showStatus(
      `Done in ${durationText(performance.now() - startTime)}: ${result.newtonIterations} Newton iterations.`,
    );
    await showFlowOutput(result, input.toml);
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
  const boundaries = {
    inflow: surfacesWithPoints(mesh, boundaryRoles.inflow),
    outflow: surfacesWithPoints(mesh, boundaryRoles.outflow),
  };
  return { toml: transportToLibraryToml(transportState, boundaries), flowToml: flowOutputToml, mesh };
}

async function runTransport(): Promise<void> {
  const input = transportInput();
  if (typeof input === "string") {
    showStatus(input, true);
    return;
  }
  setBusy(true);
  const timeUnit = transportState.timeUnit;
  // dfntrans reports no progress: an indeterminate bar
  ui.progress.removeAttribute("value");
  showStatus("Tracking the particles…");
  const startTime = performance.now();
  try {
    const result = await client.runTransport(input);
    if (result.error !== null) {
      showStatus(toolErrorText(result.error), true);
      return;
    }
    showStatus(
      `Done in ${durationText(performance.now() - startTime)}: ${result.exitCount} of ${result.particleCount} particles exited.`,
    );
    await showTransportOutput(result, timeUnit);
  } catch (error) {
    showStatus(error instanceof CancelledError ? "Cancelled." : errorText(error), !(error instanceof CancelledError));
  } finally {
    setBusy(false);
  }
}

// ---------------------------------------------------------------- output

function clearOutput(): void {
  output = null;
  updateNextButton();
  ui.results.hidden = true;
  ui.resultsBezel.hidden = true;
  ui.colorSelect.disabled = true;
  if (viewer) {
    for (const layer of ["final", "removed", "rejected"] as FractureLayer[]) {
      void viewer.setLayer(layer, null);
    }
    void viewer.render();
  }
  clearFlowOutput();
  renderFlow();
}

/**
 * Removes the "Color by" options of a cleared output. If one of them is
 * selected, the default array: the viewer must not color a new mesh by an
 * array which it does not have.
 */
function removeColorOptions(optionValues: string[]): void {
  const isSelected = optionValues.includes(ui.colorSelect.value);
  for (const option of [...ui.colorSelect.options]) {
    if (optionValues.includes(option.value)) {
      option.remove();
    }
  }
  if (isSelected) {
    ui.colorSelect.value = DEFAULT_COLOR_OPTION;
    void viewer?.colorBy(colorArrayOf(ui.colorSelect.value));
  }
}

/** The flow output belongs to the mesh of one generation */
function clearFlowOutput(): void {
  flowOutput = null;
  updateNextButton();
  flowOutputToml = null;
  ui.flowResults.hidden = true;
  removeColorOptions([PRESSURE_OPTION, FLOW_VELOCITY_OPTION]);
  clearTransportOutput();
  renderTransport();
}

/** The transport output belongs to one flow output */
function clearTransportOutput(): void {
  transportOutput = null;
  removeColorOptions([TRANSPORT_VELOCITY_OPTION]);
  ui.transportResults.hidden = true;
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

async function showOutput(result: GenerationOutput): Promise<void> {
  clearFlowOutput();
  output = result;
  updateNextButton();
  ui.resultsBezel.hidden = false;
  ui.results.hidden = false;
  renderFlow();

  showStats(ui.resultsStats, [
    ["Final fractures", String(result.finalCount)],
    ["Accepted fractures", String(result.acceptedCount)],
    ["Rejected fractures", String(result.rejectedCount)],
    ["Seed", result.seed],
  ]);

  ui.showRejected.disabled = outputFile("fractures_rejected.vtp") === null;
  await showOutputInViewer();
}

function massFlowText(massFlow: number): string {
  return `${massFlow.toExponential(4)} kg/s`;
}

async function showFlowOutput(result: FlowOutput, toml: string): Promise<void> {
  clearTransportOutput();
  flowOutput = result;
  updateNextButton();
  flowOutputToml = toml;
  renderTransport();
  ui.flowResults.hidden = false;
  const netFlow = result.boundaryFlows.reduce((sum, boundary) => sum + boundary.massFlow, 0);
  showStats(ui.flowStats, [
    ...result.boundaryFlows.map(({ name, massFlow }): [string, string] => [`Into the network at ${name}`, massFlowText(massFlow)]),
    ["Net flow", massFlowText(netFlow)],
    ["Newton iterations", String(result.newtonIterations)],
  ]);

  await showOutputInViewer(PRESSURE_OPTION);
}

function volumeFluxText(volumeFlux: number): string {
  return `${volumeFlux.toExponential(4)} m³/s`;
}

async function showTransportOutput(result: TransportOutput, timeUnit: TimeUnit): Promise<void> {
  transportOutput = result;
  transportTimeUnit = timeUnit;
  ui.transportResults.hidden = false;
  showStats(ui.transportStats, [
    ["Particles", String(result.particleCount)],
    ["Exited particles", String(result.exitCount)],
    ["In-flow volume flux", volumeFluxText(result.inflowVolumeFlux)],
    ["Out-flow volume flux", volumeFluxText(result.outflowVolumeFlux)],
    ["Seed", String(result.seed)],
  ]);

  const hasTrajectories = transportOutputFile(TRAJECTORIES_FILE) !== null;
  ui.showTrajectories.disabled = !hasTrajectories;
  ui.showTrajectories.checked = hasTrajectories;
  await showTransportInViewer();
  // "Color by" gets the velocities of the transport, or loses those of the last one
  await showOutputInViewer();
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
  view.setVisible("user", ui.showUserFractures.checked);
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

/**
 * The triangle mesh of the final fractures, with the pressure and the flow
 * velocity of the flow, and the velocity of the transport, if they exist
 */
function meshWithFlowArrays(mesh: string): string {
  const pressure = flowOutputFile(PRESSURE_FILE);
  if (pressure === null) {
    return mesh;
  }
  const darcyVelocities = dataArrayValues(pressure, "darcy_velocity") ?? [];
  const flowMeshText = addArray(
    addPointArray(mesh, pressure, PRESSURE_ARRAY.name),
    "cell",
    FLOW_VELOCITY_ARRAY.name,
    vectorMagnitudes(darcyVelocities),
  );
  const velocities = transportOutputFile(VELOCITIES_FILE);
  if (velocities === null) {
    return flowMeshText;
  }
  const speeds = nodeVelocityMagnitudes(velocities, pointCount(mesh), transportTimeUnit);
  return addArray(flowMeshText, "point", TRANSPORT_VELOCITY_ARRAY.name, speeds);
}

/**
 * Shows the output of the generation, and the arrays of the flow and the
 * transport. "Color by" selects `selected`; else it keeps its array if the
 * new mesh has it; else `fracture_id`.
 */
async function showOutputInViewer(selected: string | null = null): Promise<void> {
  if (!viewer || !output) {
    return;
  }
  const mesh = flowMesh();
  await viewer.setLayer("final", mesh === null ? null : triangleGridToPolyData(meshWithFlowArrays(mesh)));
  await viewer.setLayer("removed", outputFile("fractures_removed.vtp"));
  await viewer.setLayer("rejected", outputFile("fractures_rejected.vtp"));
  applyLayerVisibility(viewer);

  const previous = ui.colorSelect.value;
  const options = (await viewer.cellArrayNames())
    .filter((name) => name !== FLOW_VELOCITY_ARRAY.name)
    .map((name) => new Option(name, colorOptionValue({ name, association: "cell" })));
  if (flowOutputFile(PRESSURE_FILE) !== null) {
    options.push(new Option("Pressure", PRESSURE_OPTION), new Option("Flow velocity", FLOW_VELOCITY_OPTION));
  }
  if (transportOutputFile(VELOCITIES_FILE) !== null) {
    options.push(new Option("Transport velocity", TRANSPORT_VELOCITY_OPTION));
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

// The updates of the layer "user" run one after the other: two updates at the
// same time could both add their polygons
let userFracturesUpdate: Promise<void> = Promise.resolve();

/** Shows the polygons of the user-defined fractures of the form (those with a region of the mesh) */
function updateUserFracturesInViewer(): void {
  userFracturesUpdate = userFracturesUpdate
    .then(async () => {
      if (!viewer) {
        return;
      }
      const fractures = state.userFractures.filter((fracture) => regionNames.includes(fracture.region));
      await viewer.setLayer("user", fractures.length === 0 ? null : userFracturesToVtp(fractures, regionNames));
      applyLayerVisibility(viewer);
      await viewer.render();
    })
    // A failed update does not stop the next ones
    .catch((error: unknown) => showStatus(errorText(error), true));
}

async function startViewer(): Promise<void> {
  try {
    viewer = await NetworkViewer.create(ui.canvas);
  } catch (error) {
    ui.viewerMessage.textContent = `The 3D viewer is not available: ${errorText(error)}`;
    return;
  }
  ui.viewerMessage.hidden = true;
  if (files.mesh) {
    await showDomainInViewer(viewer, files.mesh);
  }
  await showOutputInViewer();
  await showTransportInViewer();
  updateUserFracturesInViewer();
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

/** Loads an example into the forms; "" (no example) does nothing */
async function openExample(name: string): Promise<void> {
  if (name === "" || isBusy) {
    return;
  }
  try {
    const example = await loadExample(name);
    await loadInput(example.workflow, example.files);
    ui.form.dataset.example = name;
  } catch (error) {
    showStatus(errorText(error), true);
  }
}

/** Default forms on a predefined mesh: the last selected shape, else the first one */
async function startFromShape(): Promise<void> {
  const name = lastShape ?? meshNames[0];
  if (name === undefined || isBusy) {
    return;
  }
  try {
    const mesh = await loadMesh(name);
    const network = defaultFormState();
    network.domain = name;
    await loadInput(
      {
        description: "",
        boundaries: defaultBoundaryRoles(domainBoundarySurfaceNames(mesh.text)),
        network,
        flow: defaultFlowState(),
        transport: defaultTransportState(),
      },
      { mesh },
    );
    ui.form.dataset.shape = name;
  } catch (error) {
    showStatus(errorText(error), true);
  }
}

/** A switch of the domain source resets the input: the example loads again, or the default forms on a shape */
function switchDomainSource(): void {
  updateDomainSource();
  if (isExampleSource()) {
    ui.exampleSelect.value ||= DEFAULT_EXAMPLE;
    void openExample(ui.exampleSelect.value);
  } else {
    void startFromShape();
  }
}

function bindEvents(): void {
  ui.exampleSelect.addEventListener("change", () => void openExample(ui.exampleSelect.value));
  ui.domainSource.addEventListener("change", () => switchDomainSource());
  const runActions: Partial<Record<SidebarTab, () => Promise<void>>> = {
    network: runGeneration,
    flow: runFlow,
    transport: runTransport,
  };
  ui.runButton.addEventListener("click", () => void runActions[activeSidebarTab]?.());
  ui.nextButton.addEventListener("click", () =>
    selectSidebarTab(SIDEBAR_TABS[SIDEBAR_TABS.indexOf(activeSidebarTab) + 1] ?? activeSidebarTab),
  );
  ui.cancelButton.addEventListener("click", () => client.cancel());

  ui.colorSelect.addEventListener("change", () =>
    updateViewer((view) => view.colorBy(colorArrayOf(ui.colorSelect.value))),
  );
  ui.showDomain.addEventListener("change", () => updateViewer((view) => view.setVisible("domain", ui.showDomain.checked)));
  for (const checkbox of [ui.showMesh, ui.showUserFractures, ui.showRemoved, ui.showRejected, ui.showTrajectories]) {
    checkbox.addEventListener("change", () => updateViewer(applyLayerVisibility));
  }
  ui.resetCamera.addEventListener("click", () => updateViewer((view) => view.resetCamera()));

  for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-sidebar-tab]")) {
    tab.addEventListener("click", () => {
      const name = SIDEBAR_TABS.find((candidate) => candidate === tab.dataset.sidebarTab);
      selectSidebarTab(name ?? "network");
    });
  }
}

/** Fills the list of the examples, and opens the default example */
async function fillExampleList(): Promise<void> {
  try {
    const names = await listExamples();
    const titles = await Promise.all(names.map(loadExampleTitle));
    names.forEach((name, index) => ui.exampleSelect.append(new Option(titles[index], name)));
    if (names.includes(DEFAULT_EXAMPLE)) {
      ui.exampleSelect.value = DEFAULT_EXAMPLE;
      await openExample(DEFAULT_EXAMPLE);
    }
  } catch (error) {
    showStatus(errorText(error), true);
  }
}

async function fillMeshList(): Promise<void> {
  try {
    meshNames = await listMeshes();
    render();
  } catch (error) {
    showStatus(errorText(error), true);
  }
}

bindEvents();
selectSidebarTab(activeSidebarTab);
render();
renderFlow();
renderTransport();
void fillExampleList();
void fillMeshList();
void startViewer();
