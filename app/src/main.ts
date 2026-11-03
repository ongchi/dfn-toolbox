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
import { boundarySurfaceCells, domainBoundarySurfaceNames, domainWireframe } from "./boundarySurfaces";
import { toolErrorText } from "./errors";
import { listExamples, loadExample, loadExampleTitle } from "./examples";
import { fluidSection, renderFlowForm, type FlowBoundary } from "./flow/form";
import { defaultFlowState, type FlowState } from "./flow/state";
import { flowToLibraryToml } from "./flow/toml";
import { renderForm } from "./form";
import type { FormContext } from "./form/context";
import { clearPinnedSurface, getPinnedSurface } from "./form/fields";
import { boundarySurfaceSection, type FileHandlers } from "./form/files";
import { defaultFormState, ORIENTATION_KEYS, type FormState, type OrientationConvention } from "./form/state";
import { InputFormError, networkToLibraryToml } from "./form/toml";
import {
  CancelledError,
  firstFractures,
  GenerationClient,
  type FlowInput,
  type FlowMeshArrays,
  type FlowOutput,
  type FractureBatch,
  type GenerationCallbacks,
  type GenerationCheckpoint,
  type GenerationInput,
  type GenerationOutput,
  type Restart,
  type ShapeArrays,
  type TransportInput,
  type TransportOutput,
} from "./generationClient";
import {
  meshDescription,
  meshRegionBounds,
  meshRegionNames,
  type InputFiles,
  type RegionBounds,
} from "./inputFiles";
import { listMeshes, loadMesh, meshDisplayName } from "./meshes";
import { renderTransportForm, routingSection } from "./transport/form";
import { defaultTransportState, type TimeUnit, type TransportState } from "./transport/state";
import { transportToLibraryToml } from "./transport/toml";
import { nodeVelocityMagnitudes } from "./transport/velocities";
import { convertOrientation, polygonFileShapes, userFracturesToVtp } from "./userFractures";
import {
  FLOW_VELOCITY_ARRAY,
  NetworkViewer,
  PRESSURE_ARRAY,
  TRANSPORT_VELOCITY_ARRAY,
  type ColorArray,
  type FractureLayer,
  type LayerShapes,
} from "./viewer";
import { vectorMagnitudes } from "./viewerGeometry";
import type { Workflow } from "./workflow";

const DEFAULT_COLOR_OPTION = "cell:fracture_id";
// The example of the page at the start
const DEFAULT_EXAMPLE = "box_west_east";
const PRESSURE_OPTION = colorOptionValue(PRESSURE_ARRAY);
const FLOW_VELOCITY_OPTION = colorOptionValue(FLOW_VELOCITY_ARRAY);
const TRANSPORT_VELOCITY_OPTION = colorOptionValue(TRANSPORT_VELOCITY_ARRAY);
// The view of the fractures of a running generation is drawn again at most this often
const GENERATION_RENDER_INTERVAL_MS = 200;
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

/** The screens with the settings in a bottom sheet: the condition of this layout in `style.css` */
const SHEET_QUERY = "(max-width: 900px) and (orientation: portrait), (max-width: 900px) and (min-height: 501px)";
/** The heights of the bottom sheet */
type SheetSize = "half" | "full";

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
  settingsForm: byId<HTMLDivElement>("settings-form"),
  settingsFlowForm: byId<HTMLDivElement>("settings-flow-form"),
  settingsTransportForm: byId<HTMLDivElement>("settings-transport-form"),
  flowForm: byId<HTMLDivElement>("flow-form"),
  transportForm: byId<HTMLDivElement>("transport-form"),
  runButton: byId<HTMLButtonElement>("run-button"),
  cancelButton: byId<HTMLButtonElement>("cancel-button"),
  stopButton: byId<HTMLButtonElement>("stop-button"),
  continueButton: byId<HTMLButtonElement>("continue-button"),
  meshingButton: byId<HTMLButtonElement>("meshing-button"),
  nextButton: byId<HTMLButtonElement>("next-button"),
  progress: byId<HTMLProgressElement>("progress"),
  status: byId<HTMLPreElement>("status"),
  colorSelect: byId<HTMLSelectElement>("color-select"),
  logScale: byId<HTMLInputElement>("log-scale"),
  showDomain: byId<HTMLInputElement>("show-domain"),
  showMesh: byId<HTMLInputElement>("show-mesh"),
  showUserFractures: byId<HTMLInputElement>("show-user-fractures"),
  /** The removed and the rejected fractures: one layer button */
  showDiscarded: byId<HTMLInputElement>("show-discarded"),
  showParticles: byId<HTMLInputElement>("show-particles"),
  showTrajectories: byId<HTMLInputElement>("show-trajectories"),
  showColorBar: byId<HTMLInputElement>("show-color-bar"),
  resetCamera: byId<HTMLButtonElement>("reset-camera"),
  canvas: byId<HTMLCanvasElement>("viewer-canvas"),
  viewerMessage: byId<HTMLDivElement>("viewer-message"),
  layout: byId<HTMLElement>("layout"),
  viewerToolbar: byId<HTMLDivElement>("viewer-toolbar"),
  dock: byId<HTMLDivElement>("dock"),
  runPanel: byId<HTMLDivElement>("run-panel"),
  settingsPanel: byId<HTMLElement>("settings-panel"),
  panelClose: byId<HTMLButtonElement>("panel-close"),
  panelOpen: byId<HTMLButtonElement>("panel-open"),
  sheetSize: byId<HTMLButtonElement>("sheet-size"),
  logButton: byId<HTMLButtonElement>("log-button"),
  settingsButton: byId<HTMLButtonElement>("settings-button"),
  settingsDialog: byId<HTMLDialogElement>("settings-dialog"),
  orientationOption: byId<HTMLSelectElement>("orientation-option"),
  logView: byId<HTMLDivElement>("log-view"),
  logEmpty: byId<HTMLParagraphElement>("log-empty"),
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
/**
 * The last checkpoint of a generation which did not complete (a stop, a
 * cancel, or the network of a checkpoint), with the fractures until it:
 * "Continue" restarts from it. null after a complete generation.
 */
let stoppedGeneration: { checkpoint: GenerationCheckpoint; fractures: FractureBatch } | null = null;
/** "Stop and keep the fractures" was clicked: the cancel of the run starts the network of its checkpoint */
let isKeepRequested = false;
/** The last generation with no error, for "Meshing"; null without a network */
let generatedNetwork: {
  input: GenerationInput;
  seed: string;
  /** The checkpoint with all accepted fractures; null: "Meshing" runs the generation again from the seed */
  checkpoint: Uint8Array | null;
  isWithoutConnectingCluster: boolean;
} | null = null;
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
  // On a phone, the sheet goes down at a run: the view shows the fractures
  if (busy && window.matchMedia(SHEET_QUERY).matches) {
    setSheetSize("half");
  }
  ui.runButton.disabled = busy;
  ui.exampleSelect.disabled = busy;
  ui.domainSource.disabled = busy;
  ui.cancelButton.hidden = !busy;
  // Only a generation shows it (`generate`)
  ui.stopButton.hidden = true;
  ui.progress.hidden = !busy;
  updateStepButtons();
  updateContinueButton();
}

/** "Continue" shows on the DFN tab when a stopped generation has a checkpoint */
function updateContinueButton(): void {
  ui.continueButton.hidden = activeSidebarTab !== "network" || stoppedGeneration === null;
  ui.continueButton.disabled = isBusy;
}

/**
 * "Next" goes to the next tab; the Transport tab has none. On the DFN tab it
 * needs the fracture mesh of a generation with a cluster which connects an
 * in-flow and an out-flow surface, on the Flow tab a solved flow. "Meshing"
 * shows on the DFN tab, and it needs a network with such a cluster.
 */
function updateStepButtons(): void {
  const isLastTab = activeSidebarTab === SIDEBAR_TABS[SIDEBAR_TABS.length - 1];
  const isNetworkMissing = flowMesh() === null || output?.isWithoutConnectingCluster === true;
  const isOutputMissing =
    (activeSidebarTab === "network" && isNetworkMissing) || (activeSidebarTab === "flow" && flowOutput === null);
  ui.nextButton.hidden = isLastTab;
  ui.nextButton.disabled = isBusy || isOutputMissing;
  ui.meshingButton.hidden = activeSidebarTab !== "network";
  ui.meshingButton.disabled = isBusy || generatedNetwork === null || generatedNetwork.isWithoutConnectingCluster;
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
  highlightBoundarySurface: (name) => highlightBoundarySurface(name),
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
  highlightBoundarySurface: (name) => highlightBoundarySurface(name),
  changed: () => {},
  rerender: () => renderFlow(),
};

const transportContext: FormContext = {
  regionNames: [],
  meshNames: [],
  regionBounds: [],
  highlightBoundarySurface: (name) => highlightBoundarySurface(name),
  changed: () => {},
  rerender: () => renderTransport(),
};

function render(): void {
  renderForm(
    { domain: ui.domainForm, fractures: ui.fracturesForm, network: ui.form, settings: ui.settingsForm },
    state,
    formContext,
    fileHandlers,
  );
  updateUserFracturesInViewer();
}

/** The pressure boundaries of the flow form; null without a triangle mesh */
function flowBoundaries(): FlowBoundary[] | null {
  const mesh = flowMesh();
  if (mesh === null) {
    return null;
  }
  const withPoints = surfacesWithPoints(mesh.boundaries, flowSurfaces(boundaryRoles));
  return flowSurfaces(boundaryRoles).map((name) => ({
    name,
    isInflow: roleOf(boundaryRoles, name) === "inflow",
    hasPoints: withPoints.includes(name),
  }));
}

function renderFlow(): void {
  renderFlowForm(ui.flowForm, flowState, flowBoundaries(), flowContext);
  ui.settingsFlowForm.replaceChildren(fluidSection(flowState, flowContext));
}

function renderTransport(): void {
  renderTransportForm(ui.transportForm, transportState, flowOutput !== null, transportContext);
  ui.settingsTransportForm.replaceChildren(routingSection(transportState, transportContext));
}

function selectSidebarTab(name: SidebarTab): void {
  activeSidebarTab = name;
  for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-sidebar-tab]")) {
    tab.classList.toggle("is-active", tab.dataset.sidebarTab === name);
    if (tab.dataset.sidebarTab === name) {
      tab.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }
  updateDomainSource();
  ui.fracturesForm.hidden = name !== "fractures";
  ui.form.hidden = name !== "network";
  ui.flowForm.hidden = name !== "flow";
  ui.transportForm.hidden = name !== "transport";
  const runText = RUN_BUTTON_TEXT[name];
  ui.runButton.hidden = runText === null;
  ui.runButton.textContent = runText ?? "";
  updateStepButtons();
  updateContinueButton();
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

/** Highlights a boundary surface in the 3D view (pointer over its row or field, or its pin); null = no surface */
function highlightBoundarySurface(name: string | null): void {
  void updateViewer((view) => view.highlightBoundarySurface(name));
}

function renderBoundarySurfaces(): void {
  ui.boundarySurfaces.replaceChildren(
    boundarySurfaceSection(boundarySurfaceNames, {
      roleOf: (name) => roleOf(boundaryRoles, name),
      onRole: (name, role) => {
        setRole(boundaryRoles, name, role, boundarySurfaceNames);
        // The network keeps the clusters which connect the in-flow and out-flow surfaces
        clearOutput();
      },
      onHover: (name) => highlightBoundarySurface(name),
    }),
  );
  updateDomainSource();
}

/** Shows the domain mesh and its boundary surfaces */
function showDomainInViewer(view: NetworkViewer, mesh: NonNullable<InputFiles["mesh"]>): void {
  view.setDomainMesh(domainWireframe(mesh.text));
  view.setBoundarySurfaces(
    boundarySurfaceNames.map((name) => ({
      name,
      cells: boundarySurfaceCells(mesh.text, name),
    })),
  );
  view.highlightBoundarySurface(getPinnedSurface());
  view.setVisible("domain", ui.showDomain.checked);
}

async function setMesh(mesh: InputFiles["mesh"]): Promise<void> {
  files.mesh = mesh;
  regionNames = mesh === null ? [] : meshRegionNames(mesh.text);
  regionBounds = mesh === null ? [] : meshRegionBounds(mesh.text);
  boundarySurfaceNames = mesh === null ? [] : domainBoundarySurfaceNames(mesh.text);
  clearPinnedSurface();
  ui.shapeDescription.textContent = mesh === null ? "" : meshDescription(mesh.text);
  renderBoundarySurfaces();
  clearOutput();
  if (viewer && mesh) {
    showDomainInViewer(viewer, mesh);
    viewer.resetCamera();
    viewer.render();
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
    userFractures: state.userFractures.length === 0 ? undefined : userFracturesToVtp(state.userFractures, state, regionNames),
  };
}

/** "Generate": a new generation */
async function runGeneration(): Promise<void> {
  await generate(null);
}

/** "Stop and keep the fractures": the worker stops, and the network is made from the last checkpoint */
function stopAndKeepFractures(): void {
  isKeepRequested = true;
  client.cancel();
}

/** A generation; with `restartMode`, from the checkpoint of `stoppedGeneration` */
async function generate(restartMode: Restart["mode"] | null): Promise<void> {
  const input = generationInput();
  if (typeof input === "string") {
    showStatus(input, true);
    return;
  }
  const stopped = restartMode === null ? null : stoppedGeneration;
  if (restartMode !== null && stopped === null) {
    return;
  }
  setBusy(true);
  // The network of a checkpoint has no insertion to stop
  ui.stopButton.hidden = restartMode === "finish";
  ui.progress.value = 0;
  showStatus(
    restartMode === "finish"
      ? `Making the network of the ${stopped?.checkpoint.acceptedCount} fractures until the stop…`
      : "Generating…",
  );
  // The view shows the new fractures during the run, not the old network;
  // a restart shows the fractures until its checkpoint again
  clearOutput();
  viewer?.clearGenerationFractures();
  const fractures: FractureBatch[] = stopped === null ? [] : [stopped.fractures];
  if (stopped !== null) {
    viewer?.addGenerationFractures(stopped.fractures);
    viewer?.render();
  }
  let checkpoint: GenerationCheckpoint | null = stopped?.checkpoint ?? null;
  let lastAcceptedCount = checkpoint?.acceptedCount ?? null;
  ui.stopButton.disabled = checkpoint === null;
  let lastRenderTime = 0;
  const startTime = performance.now();
  const callbacks: GenerationCallbacks = {
    onProgress: (acceptedCount, fraction, batch) => {
      ui.progress.value = fraction;
      lastAcceptedCount = acceptedCount;
      showStatus(
        fraction >= 1
          ? `Generating… ${acceptedCount} fractures accepted; making the clusters`
          : `Generating… ${acceptedCount} fractures accepted`,
      );
      fractures.push(batch);
      if (!viewer) {
        return;
      }
      viewer.addGenerationFractures(batch);
      const now = performance.now();
      if (now - lastRenderTime >= GENERATION_RENDER_INTERVAL_MS || fraction >= 1) {
        lastRenderTime = now;
        viewer.render();
      }
    },
    onCheckpoint: (newCheckpoint) => {
      checkpoint = newCheckpoint;
      ui.stopButton.disabled = false;
    },
  };
  try {
    const restart =
      stopped === null || restartMode === null ? null : { checkpoint: stopped.checkpoint.checkpoint, mode: restartMode };
    const result = await client.run(input, callbacks, restart);
    if (result.error !== null) {
      showStatus(toolErrorText(result.error), true);
      return;
    }
    // The network of a checkpoint has only the fractures until the stop: "Continue" adds the others
    stoppedGeneration = restartMode === "finish" ? stopped : null;
    const finishText =
      restartMode === "finish"
        ? `\nThe network has the ${stopped?.checkpoint.acceptedCount} fractures until the stop. "Continue" adds the others.`
        : "";
    showGenerationDone(result, startTime, finishText);
    generatedNetwork = {
      input,
      seed: result.seed,
      checkpoint: checkpoint?.acceptedCount === lastAcceptedCount ? (checkpoint?.checkpoint ?? null) : null,
      isWithoutConnectingCluster: result.isWithoutConnectingCluster,
    };
    await showOutput(result);
  } catch (error) {
    if (!(error instanceof CancelledError)) {
      showStatus(errorText(error), true);
      return;
    }
    // The checkpoint of the run, or that of its restart; none: a new generation stopped before its first checkpoint
    stoppedGeneration =
      checkpoint === null ? null : { checkpoint, fractures: firstFractures(fractures, checkpoint.acceptedCount) };
    showStatus(isKeepRequested ? "Stopped." : "Cancelled.");
  } finally {
    // The final layers replace the fractures of the run; after an error or a cancel, nothing does
    if (viewer) {
      viewer.clearGenerationFractures();
      viewer.render();
    }
    setBusy(false);
  }
  if (isKeepRequested) {
    isKeepRequested = false;
    await generate("finish");
  }
}

function showGenerationDone(result: GenerationOutput, startTime: number, finishText = ""): void {
  const doneText = `Done in ${durationText(performance.now() - startTime)}: ${result.finalCount} final fractures.${finishText}`;
  if (result.isWithoutConnectingCluster) {
    showWarningStatus(`${doneText}\n${NO_CONNECTING_CLUSTER}`);
  } else {
    showStatus(doneText);
  }
}

/** "Meshing": the fractures of the last generation, with the mesh values of the forms now */
async function runMeshing(): Promise<void> {
  const network = generatedNetwork;
  const current = generationInput();
  if (network === null) {
    return;
  }
  if (typeof current === "string") {
    showStatus(current, true);
    return;
  }
  setBusy(true);
  // dfngen reports no progress during the mesh: an indeterminate bar
  ui.progress.removeAttribute("value");
  showStatus("Meshing…");
  const startTime = performance.now();
  try {
    const result = await client.runMeshing({
      network: network.input,
      current,
      seed: network.seed,
      checkpoint: network.checkpoint,
    });
    if (result.error !== null) {
      showStatus(toolErrorText(result.error), true);
      return;
    }
    showGenerationDone(result, startTime);
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
    return 'Generate a network and click "Meshing" first: the flow needs its triangle mesh.';
  }
  if (ui.flowForm.querySelector(".is-invalid")) {
    return "A field of the form has an invalid value (red border). Correct it first.";
  }
  return { toml: flowToLibraryToml(flowState, surfacesWithPoints(mesh.boundaries, flowSurfaces(boundaryRoles))), mesh };
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
    inflow: surfacesWithPoints(mesh.boundaries, boundaryRoles.inflow),
    outflow: surfacesWithPoints(mesh.boundaries, boundaryRoles.outflow),
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
  generatedNetwork = null;
  updateStepButtons();
  ui.results.hidden = true;
  ui.logEmpty.hidden = false;
  ui.colorSelect.disabled = true;
  ui.logScale.disabled = true;
  if (viewer) {
    for (const layer of ["final", "removed", "rejected"] as FractureLayer[]) {
      viewer.setLayer(layer, null);
    }
    viewer.render();
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
    if (viewer) {
      applyColorChoice(viewer);
    }
  }
}

/** The flow output belongs to the mesh of one generation */
function clearFlowOutput(): void {
  flowOutput = null;
  updateStepButtons();
  flowOutputToml = null;
  ui.flowResults.hidden = true;
  removeColorOptions([PRESSURE_OPTION, FLOW_VELOCITY_OPTION]);
  ui.showParticles.checked = false;
  ui.showParticles.disabled = true;
  viewer?.setFlowParticles(null);
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
    viewer.setTrajectories(null);
    viewer.render();
  }
}

/** The triangle mesh of the last "Meshing", the mesh of the flow */
function flowMesh(): FlowMeshArrays | null {
  const shapes = output?.shapes;
  if (shapes == null || shapes.mesh === null) {
    return null;
  }
  const cellArray = (name: string) => shapes.mesh?.cellArrays.find(([arrayName]) => arrayName === name)?.[1] ?? new Float64Array();
  return {
    points: shapes.mesh.points,
    triangles: shapes.mesh.connectivity,
    fractureIds: cellArray("fracture_id"),
    apertures: cellArray("aperture"),
    permeabilities: cellArray("permeability"),
    boundaries: shapes.meshBoundaries,
  };
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
  updateStepButtons();
  ui.logEmpty.hidden = true;
  ui.results.hidden = false;
  renderFlow();

  showStats(ui.resultsStats, [
    ["Final fractures", String(result.finalCount)],
    ["Accepted fractures", String(result.acceptedCount)],
    ["Rejected fractures", String(result.rejectedCount)],
    ["Seed", result.seed],
  ]);

  await showOutputInViewer();
}

function massFlowText(massFlow: number): string {
  return `${massFlow.toExponential(4)} kg/s`;
}

async function showFlowOutput(result: FlowOutput, toml: string): Promise<void> {
  clearTransportOutput();
  flowOutput = result;
  updateStepButtons();
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
  ui.showParticles.disabled = false;
  ui.showParticles.checked = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  showParticlesInViewer();
}

/** The moving particles of the flow; the page can have a flow before the viewer is ready */
function showParticlesInViewer(): void {
  const mesh = flowMesh();
  if (!viewer || flowOutput === null || mesh === null) {
    return;
  }
  viewer.setFlowParticles({ points: mesh.points, triangles: mesh.triangles, velocities: flowOutput.darcyVelocities });
  applyLayerVisibility(viewer);
  viewer.render();
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

  const hasTrajectories = result.pathPointCounts.length > 0;
  ui.showTrajectories.disabled = !hasTrajectories;
  ui.showTrajectories.checked = hasTrajectories;
  await showTransportInViewer();
  // "Color by" gets the velocities of the transport, or loses those of the last one
  await showOutputInViewer();
}

async function showTransportInViewer(): Promise<void> {
  if (!viewer || transportOutput === null || transportOutput.pathPointCounts.length === 0) {
    return;
  }
  viewer.setTrajectories({
    points: transportOutput.pathPoints,
    velocities: transportOutput.pathVelocities,
    pointCounts: transportOutput.pathPointCounts,
  });
  applyLayerVisibility(viewer);
  viewer.render();
}

function applyLayerVisibility(view: NetworkViewer): void {
  view.setVisible("final", ui.showMesh.checked);
  view.setVisible("user", ui.showUserFractures.checked);
  // A network without rejected fractures (FRAM keeps none) shows only the removed ones
  view.setVisible("removed", ui.showDiscarded.checked);
  view.setVisible("rejected", ui.showDiscarded.checked);
  view.setVisible("trajectories", ui.showTrajectories.checked);
  view.setVisible("particles", ui.showParticles.checked);
}

/** Colors the mesh with the choices of the toolbar; a log scale needs a positive value of the array */
function applyColorChoice(view: NetworkViewer): void {
  view.setLogScale(ui.logScale.checked);
  view.colorBy(colorArrayOf(ui.colorSelect.value));
  ui.logScale.disabled = !view.canUseLogScale();
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

/** The shapes of a layer with no point array */
function layerShapes(shapes: ShapeArrays | null | undefined): LayerShapes | null {
  return shapes == null ? null : { ...shapes, pointArrays: [] };
}

/**
 * The triangle mesh of the final fractures, with the pressure and the flow
 * velocity of the flow, and the velocity of the transport, if they exist
 */
function meshWithFlowArrays(mesh: ShapeArrays): LayerShapes {
  if (flowOutput === null) {
    return { ...mesh, pointArrays: [] };
  }
  const pointArrays: [string, Float64Array][] = [[PRESSURE_ARRAY.name, flowOutput.pressures]];
  if (transportOutput !== null && transportOutput.sectorNodes.length > 0) {
    const speeds = nodeVelocityMagnitudes(
      transportOutput.sectorNodes,
      transportOutput.sectorVelocities,
      mesh.points.length / 3,
      transportTimeUnit,
    );
    pointArrays.push([TRANSPORT_VELOCITY_ARRAY.name, speeds]);
  }
  return {
    ...mesh,
    cellArrays: [...mesh.cellArrays, [FLOW_VELOCITY_ARRAY.name, vectorMagnitudes(flowOutput.darcyVelocities)]],
    pointArrays,
  };
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
  const shapes = output.shapes;
  // Before "Meshing", the polygons of the final fractures
  viewer.setLayer("final", shapes?.mesh ? meshWithFlowArrays(shapes.mesh) : layerShapes(shapes?.fractures));
  viewer.setLayer("removed", layerShapes(shapes?.removed));
  viewer.setLayer("rejected", layerShapes(shapes?.rejected));
  applyLayerVisibility(viewer);

  const previous = ui.colorSelect.value;
  const options = viewer
    .cellArrayNames()
    .filter((name) => name !== FLOW_VELOCITY_ARRAY.name)
    .map((name) => new Option(name, colorOptionValue({ name, association: "cell" })));
  if (flowOutput !== null) {
    options.push(new Option("Pressure", PRESSURE_OPTION), new Option("Flow velocity", FLOW_VELOCITY_OPTION));
  }
  if (transportOutput !== null && transportOutput.sectorNodes.length > 0) {
    options.push(new Option("Transport velocity", TRANSPORT_VELOCITY_OPTION));
  }
  ui.colorSelect.replaceChildren(new Option("One color", ""), ...options);
  const values = options.map((option) => option.value);
  ui.colorSelect.value =
    [selected, previous, DEFAULT_COLOR_OPTION].find((value) => value !== null && values.includes(value)) ?? "";
  ui.colorSelect.disabled = false;
  applyColorChoice(viewer);
  viewer.render();
}

// ---------------------------------------------------------------- viewer

// The updates of the layer "user" run one after the other: two updates at the
// same time could both add their polygons
let userFracturesUpdate: Promise<void> = Promise.resolve();

/** The polygons of a polygon file as a layer */
function polygonLayerShapes(vtpText: string): LayerShapes {
  const { points, vertexCounts, connectivity } = polygonFileShapes(vtpText);
  return {
    points: Float64Array.from(points),
    vertexCounts: Uint32Array.from(vertexCounts),
    connectivity: Uint32Array.from(connectivity),
    cellArrays: [],
    pointArrays: [],
  };
}

/** Shows the polygons of the user-defined fractures of the form (those with a region of the mesh) */
function updateUserFracturesInViewer(): void {
  userFracturesUpdate = userFracturesUpdate
    .then(async () => {
      if (!viewer) {
        return;
      }
      const fractures = state.userFractures.filter((fracture) => regionNames.includes(fracture.region));
      viewer.setLayer("user", fractures.length === 0 ? null : polygonLayerShapes(userFracturesToVtp(fractures, state, regionNames)));
      applyLayerVisibility(viewer);
      viewer.render();
    })
    // A failed update does not stop the next ones
    .catch((error: unknown) => showStatus(errorText(error), true));
}

async function startViewer(): Promise<void> {
  try {
    viewer = NetworkViewer.create(ui.canvas);
  } catch (error) {
    ui.viewerMessage.textContent = `The 3D viewer is not available: ${errorText(error)}`;
    return;
  }
  ui.viewerMessage.hidden = true;
  if (files.mesh) {
    showDomainInViewer(viewer, files.mesh);
  }
  await showOutputInViewer();
  await showTransportInViewer();
  showParticlesInViewer();
  updateUserFracturesInViewer();
  updateCoveredArea();
  viewer.resetCamera();
  viewer.render();
}

async function updateViewer(action: (viewer: NetworkViewer) => void | Promise<void>): Promise<void> {
  if (viewer) {
    await action(viewer);
    viewer.render();
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

/** Shows or hides the settings panel (a phone: the bottom sheet); the view then has the free part of the page */
function setSettingsShown(isShown: boolean): void {
  ui.layout.classList.toggle("is-panel-closed", !isShown);
  ui.panelOpen.hidden = isShown;
  (isShown ? ui.panelClose : ui.panelOpen).focus();
}

/** The height of the bottom sheet of a phone; `style.css` uses it only on such a screen */
function setSheetSize(size: SheetSize): void {
  ui.layout.dataset.sheet = size;
  ui.sheetSize.setAttribute("aria-label", size === "half" ? "Larger settings" : "Smaller settings");
}

function openSettings(): void {
  ui.orientationOption.value = state.orientationConvention;
  ui.settingsDialog.showModal();
}

/** A new pair of angles for all orientations: the angles change, each plane (and mean normal) stays */
function setOrientationConvention(convention: OrientationConvention): void {
  const from = state.orientationConvention;
  for (const family of state.families) {
    family.orientation = { ...convertOrientation(family.orientation, from, convention), kappa: family.orientation.kappa };
  }
  for (const fracture of state.userFractures) {
    fracture.orientation = convertOrientation(fracture.orientation, from, convention);
  }
  state.orientationConvention = convention;
  render();
}

function toggleLog(): void {
  ui.logView.hidden = !ui.logView.hidden;
  ui.logButton.setAttribute("aria-expanded", String(!ui.logView.hidden));
}

/**
 * The parts of the page which the panels cover: the view centers the model in the
 * rest, and `style.css` places the Log panel, the legend and the layers with them.
 */
function updateCoveredArea(): void {
  const isSheet = window.matchMedia(SHEET_QUERY).matches;
  const pageHeight = window.innerHeight;
  const coveredBottom = isSheet ? pageHeight - ui.dock.getBoundingClientRect().top : 0;
  ui.layout.style.setProperty("--covered-bottom", `${coveredBottom}px`);
  ui.layout.style.setProperty("--run-panel-height", `${ui.runPanel.offsetHeight}px`);
  const isPanelShown = !ui.layout.classList.contains("is-panel-closed");
  viewer?.setCoveredArea({
    left: !isSheet && isPanelShown ? ui.settingsPanel.getBoundingClientRect().right : 0,
    top: isSheet ? ui.viewerToolbar.querySelector(".color-panel")?.getBoundingClientRect().bottom ?? 0 : 0,
    bottom: coveredBottom,
  });
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
  ui.stopButton.addEventListener("click", stopAndKeepFractures);
  ui.continueButton.addEventListener("click", () => void generate("continue"));
  ui.meshingButton.addEventListener("click", () => void runMeshing());

  for (const control of [ui.colorSelect, ui.logScale]) {
    control.addEventListener("change", () => updateViewer(applyColorChoice));
  }
  ui.showDomain.addEventListener("change", () => updateViewer((view) => view.setVisible("domain", ui.showDomain.checked)));
  for (const checkbox of [ui.showMesh, ui.showUserFractures, ui.showDiscarded, ui.showTrajectories, ui.showParticles]) {
    checkbox.addEventListener("change", () => updateViewer(applyLayerVisibility));
  }
  ui.showColorBar.addEventListener("change", () => updateViewer((view) => view.setScalarBarShown(ui.showColorBar.checked)));
  ui.resetCamera.addEventListener("click", () => updateViewer((view) => view.resetCamera()));

  for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-sidebar-tab]")) {
    tab.addEventListener("click", () => {
      const name = SIDEBAR_TABS.find((candidate) => candidate === tab.dataset.sidebarTab);
      selectSidebarTab(name ?? "network");
    });
  }
  ui.panelClose.addEventListener("click", () => setSettingsShown(false));
  ui.panelOpen.addEventListener("click", () => setSettingsShown(true));
  ui.sheetSize.addEventListener("click", () => setSheetSize(ui.layout.dataset.sheet === "full" ? "half" : "full"));
  ui.logButton.addEventListener("click", toggleLog);
  ui.settingsButton.addEventListener("click", openSettings);
  ui.orientationOption.addEventListener("change", () => {
    const convention = (Object.keys(ORIENTATION_KEYS) as OrientationConvention[]).find(
      (candidate) => candidate === ui.orientationOption.value,
    );
    if (convention !== undefined) {
      setOrientationConvention(convention);
    }
  });
  // A click on the backdrop: the target is the dialog itself, not its content
  ui.settingsDialog.addEventListener("click", (event) => {
    if (event.target === ui.settingsDialog) {
      ui.settingsDialog.close();
    }
  });
  const coveredAreaObserver = new ResizeObserver(updateCoveredArea);
  for (const panel of [ui.dock, ui.runPanel, ui.settingsPanel, ui.viewerToolbar]) {
    coveredAreaObserver.observe(panel);
  }
  // A closed panel has no size: its change has no resize
  new MutationObserver(updateCoveredArea).observe(ui.layout, { attributeFilter: ["class", "data-sheet"] });
  window.addEventListener("resize", updateCoveredArea);
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
