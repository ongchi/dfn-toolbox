// The page: input forms (network, flow and transport), generation, flow and
// transport in the worker (one "Run" for all steps, `liveRun.ts`), 3D view
// and output files.
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
import { fluidSection, renderFlowForm, type FlowBoundary } from "./flow/form";
import { defaultFlowState, setDefaultInflowPressures, type FlowState } from "./flow/state";
import { flowToLibraryToml } from "./flow/toml";
import { renderForm } from "./form";
import type { FormContext } from "./form/context";
import { clearPinnedItem, getPinnedItem, resetOpenCards, type HighlightItem } from "./form/fields";
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
  meshLargestSide,
  meshRegionBounds,
  meshRegionNames,
  type InputFiles,
  type RegionBounds,
} from "./inputFiles";
import { CHAIN_STEPS, isSameFractureInput, LiveRun, networkChangeStep, type ChainStep, type StepResult } from "./liveRun";
import { listMeshes, loadMesh, meshDisplayName } from "./meshes";
import { regionOuterFaces } from "./regions";
import { renderTransportForm, routingSection, type PointPicking } from "./transport/form";
import { defaultTransportState, type ReleasePoint, type TimeUnit, type TransportState } from "./transport/state";
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
import { defaultWorkflow, type Workflow } from "./workflow";

const DEFAULT_COLOR_OPTION = "cell:fracture_id";
const PRESSURE_OPTION = colorOptionValue(PRESSURE_ARRAY);
const FLOW_VELOCITY_OPTION = colorOptionValue(FLOW_VELOCITY_ARRAY);
const TRANSPORT_VELOCITY_OPTION = colorOptionValue(TRANSPORT_VELOCITY_ARRAY);
// The view of the fractures of a running generation is drawn again at most this often
const GENERATION_RENDER_INTERVAL_MS = 200;
// The generation keeps all clusters when none connects an in-flow and an out-flow surface
const NO_CONNECTING_CLUSTER =
  "No cluster connects an in-flow and an out-flow surface: all clusters stay. The particles need a path between them; increase the number of fractures or their size, try another seed, or change the roles of the surfaces (Domain panel).";
// The transport runs only with a release point (user decision)
const NO_RELEASE_POINT = "To track particles, click “Pick points” (Transport panel), then click on a fracture.";

// The steps of the run bar, each with a panel of its settings; the domain and the fractures are the network input
const STEP_PANELS = ["domain", "fractures", "flow", "transport"] as const;
type StepPanel = (typeof STEP_PANELS)[number];
const STEP_PANEL_TITLES: Record<StepPanel, string> = {
  domain: "Domain",
  fractures: "Fractures",
  flow: "Flow",
  transport: "Transport",
};
/** The steps of the live run of each segment of the run bar; the domain has none */
const STEP_PANEL_CHAIN_STEPS: Record<StepPanel, ChainStep[]> = {
  domain: [],
  fractures: ["generation", "userFractures", "mesh"],
  flow: ["flow"],
  transport: ["transport"],
};
/** The state of a segment of the run bar (`data-step-state`, for `style.css` and `e2e.mjs`) */
type SegmentState = "empty" | "stale" | "running" | "failed" | "done";

/** The screens with the settings in a bottom sheet: the condition of this layout in `style.css` */
const SHEET_QUERY = "(max-width: 900px) and (orientation: portrait), (max-width: 900px) and (min-height: 501px)";
/** The vertical move (pixels) of a swipe down on the handle bar of the sheet */
const SHEET_SWIPE_DISTANCE = 30;

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`missing element #${id}`);
  }
  return node as T;
}

const ui = {
  domainForm: byId<HTMLDivElement>("domain-form"),
  shapeDescription: byId<HTMLParagraphElement>("shape-description"),
  boundarySurfaces: byId<HTMLDivElement>("boundary-surfaces"),
  fracturesForm: byId<HTMLDivElement>("fractures-form"),
  form: byId<HTMLDivElement>("form"),
  networkAdvancedForm: byId<HTMLDivElement>("network-advanced-form"),
  settingsForm: byId<HTMLDivElement>("settings-form"),
  flowSettingsForm: byId<HTMLDivElement>("flow-settings-form"),
  transportSettingsForm: byId<HTMLDivElement>("transport-settings-form"),
  flowForm: byId<HTMLDivElement>("flow-form"),
  transportForm: byId<HTMLDivElement>("transport-form"),
  runButton: byId<HTMLButtonElement>("run-button"),
  resetButton: byId<HTMLButtonElement>("reset-button"),
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
  titlePanel: byId<HTMLElement>("title-panel"),
  viewerToolbar: byId<HTMLDivElement>("viewer-toolbar"),
  dock: byId<HTMLDivElement>("dock"),
  runPanel: byId<HTMLDivElement>("run-panel"),
  stepPanel: byId<HTMLElement>("step-panel"),
  stepSegments: [...document.querySelectorAll<HTMLButtonElement>("[data-step-panel]")],
  stepGroups: [...document.querySelectorAll<HTMLElement>("[data-step-group]")],
  sheetHandle: byId<HTMLButtonElement>("sheet-handle"),
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
/** The largest side of the bounding box of the domain mesh (m); 0 without a mesh */
let domainSize = 0;
let boundarySurfaceNames: string[] = [];
/** The roles of the boundary surfaces (Domain panel) */
let boundaryRoles: BoundaryRoles = { inflow: [], outflow: [] };
let meshNames: string[] = [];
let output: GenerationOutput | null = null;
let flowState: FlowState = defaultFlowState();
let flowOutput: FlowOutput | null = null;
/** The flow TOML of `flowOutput`: the transport solves this flow again */
let flowOutputToml: string | null = null;
/** The status of the last flow: the status with no release point shows it again */
let flowDoneText = "";
let transportState: TransportState = defaultTransportState();
let transportOutput: TransportOutput | null = null;
/** The time unit of the input of `transportOutput`: the unit of its velocities */
let transportTimeUnit: TimeUnit = "days";
/** A click on a final fracture of the 3D view adds a release point (Transport panel, seeding) */
let isPickingPoints = false;
/** The step whose settings show above the run bar; null: none (the start) */
let openPanel: StepPanel | null = null;
/** The step of the live run which failed last; null after a new start of a step */
let failedChainStep: ChainStep | null = null;
let isBusy = false;
/** The checkpoint of a generation, with the accepted fractures until it and the input of the generation */
interface SavedGeneration {
  checkpoint: GenerationCheckpoint;
  fractures: FractureBatch;
  input: GenerationInput;
  /** The insertion ended: the checkpoint has all stochastic fractures. False after a stop or a cancel. */
  isComplete: boolean;
}

/** A generation from a saved checkpoint */
interface GenerationRestart {
  from: SavedGeneration;
  /** "continue": the insertion continues; "finish": the network of the fractures of the checkpoint */
  mode: Restart["mode"];
}

/**
 * The last checkpoint of the stochastic fractures: the next generation of
 * the same stochastic fractures starts from it. null without stochastic
 * fractures, and before the first checkpoint of a generation.
 */
let savedGeneration: SavedGeneration | null = null;
/** "Pause" during a generation: the cancel of the run starts the network of its checkpoint */
let isKeepRequested = false;
/** The last generation with no error, for the mesh; null without a network */
let generatedNetwork: {
  input: GenerationInput;
  seed: string;
  /** The checkpoint with all accepted fractures; null: the mesh runs the generation again from the seed */
  checkpoint: Uint8Array | null;
  isWithoutConnectingCluster: boolean;
  /** FRAM was on: the network can have rejected fractures */
  isFramOn: boolean;
} | null = null;
/** The input of the network forms at the last mesh; null without a mesh */
let meshedInput: GenerationInput | null = null;
let viewer: NetworkViewer | null = null;
const client = new GenerationClient();
const liveRun = new LiveRun({
  runStep: async (step) => {
    failedChainStep = null;
    const result = await runChainStep(step);
    if (result === "failed") {
      failedChainStep = step;
    }
    return result;
  },
  cancel: () => client.cancel(),
  onStateChange: () => {
    updateRunBar();
    // The chain stopped (an error, "Pause"): the view shows the results which it has
    if (liveRun.isIdle) {
      void releaseView();
    }
  },
});

// ---------------------------------------------------------------- status

/** The status is at the top of the Log panel; the Log button has a dot for an error or a warning */
function showStatus(text: string, isError = false): void {
  ui.status.hidden = text === "";
  ui.status.textContent = text;
  ui.status.classList.toggle("is-error", isError);
  ui.status.classList.remove("is-warning");
  setLogMessage(isError ? "error" : null);
}

/** A status which is not an error, but which the user must see */
function showWarningStatus(text: string): void {
  showStatus(text);
  ui.status.classList.add("is-warning");
  setLogMessage("warning");
}

/** The dot of the Log button (`style.css`); null = no dot */
function setLogMessage(kind: "error" | "warning" | null): void {
  if (kind === null) {
    delete ui.logButton.dataset.message;
  } else {
    ui.logButton.dataset.message = kind;
  }
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

/** A step runs in the worker: the progress bar shows */
function setBusy(busy: boolean): void {
  isBusy = busy;
  ui.progress.hidden = !busy;
  updateRunBar();
}

/** The state of the segment of a step: from the live run, and from the domain mesh for the Domain step */
function segmentState(panel: StepPanel): SegmentState {
  const steps = STEP_PANEL_CHAIN_STEPS[panel];
  if (steps.length === 0) {
    return files.mesh === null ? "empty" : "done";
  }
  if (liveRun.currentStep !== null && steps.includes(liveRun.currentStep)) {
    return "running";
  }
  if (failedChainStep !== null && steps.includes(failedChainStep)) {
    return "failed";
  }
  const stale = liveRun.staleStep;
  const lastStep = steps[steps.length - 1];
  return stale !== null && CHAIN_STEPS.indexOf(stale) <= CHAIN_STEPS.indexOf(lastStep) ? "stale" : "done";
}

/**
 * "Run" starts the live run, which shows "Pause". The network of a stopped
 * generation (after "Pause") runs with the live run off: "Run" waits for it.
 * Each segment shows the state of its step; the progress bar is in the running one.
 */
function updateRunBar(): void {
  ui.runButton.setAttribute("aria-label", liveRun.isOn ? "Pause" : "Run");
  ui.runButton.title = liveRun.isOn
    ? "Pause: the running step stops; the results before it stay"
    : "Run all steps; a change of a setting runs the steps again";
  ui.runButton.setAttribute("aria-pressed", String(liveRun.isOn));
  ui.runButton.disabled = isBusy && !liveRun.isOn;
  // For the e2e check: "idle" when no step runs or waits
  ui.runButton.dataset.state = liveRun.isIdle && !isBusy ? "idle" : "running";
  for (const segment of ui.stepSegments) {
    const panel = STEP_PANELS.find((candidate) => candidate === segment.dataset.stepPanel);
    if (panel === undefined) {
      continue;
    }
    const state = segmentState(panel);
    segment.dataset.stepState = state;
    if (state === "running" && ui.progress.parentElement !== segment) {
      segment.append(ui.progress);
    }
  }
}

/** "Run" or "Pause" */
function toggleLiveRun(): void {
  if (!liveRun.isOn) {
    if (liveRun.staleStep === null) {
      showStatus("All results are up to date.");
    }
    liveRun.start();
    return;
  }
  // "Pause" during the generation keeps the fractures until its last checkpoint (user decision)
  isKeepRequested = liveRun.currentStep === "generation" || liveRun.currentStep === "userFractures";
  liveRun.stop();
}

/** "Reset": all results go; the next run starts from the seed. The forms stay. */
function resetAll(): void {
  isKeepRequested = false;
  failedChainStep = null;
  liveRun.reset();
  savedGeneration = null;
  meshedInput = null;
  viewer?.clearGenerationFractures();
  clearOutput();
  showStatus("");
}

/** A value of the network forms changed: the steps from the first step which it affects are stale */
function networkChanged(): void {
  const current = generationInput();
  // An invalid value: the next valid change runs the steps
  if (typeof current === "string") {
    return;
  }
  const step = networkChangeStep(current, generatedNetwork?.input ?? null, meshedInput);
  if (step !== null) {
    liveRun.changed(step);
  }
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
  get domainSize() {
    return domainSize;
  },
  highlight: (item) => highlight(item),
  changed: () => {
    updateUserFracturesInViewer();
    networkChanged();
  },
  previewUserFracture: (index) => {
    previewedUserFracture = index;
  },
  rerender: () => {
    render();
    networkChanged();
  },
};

const fileHandlers: FileHandlers = {
  chooseMesh: async (name) => {
    try {
      const mesh = await loadMesh(name);
      state.domain = name;
      boundaryRoles = defaultBoundaryRoles(domainBoundarySurfaceNames(mesh.text));
      setDefaultInflowPressures(flowState, boundaryRoles.inflow);
      await setMesh(mesh);
      render();
      ui.form.dataset.shape = name;
    } catch (error) {
      showStatus(errorText(error), true);
    }
  },
};

const flowContext: FormContext = {
  regionNames: [],
  meshNames: [],
  regionBounds: [],
  domainSize: 0,
  highlight: (item) => highlight(item),
  changed: () => liveRun.changed("flow"),
  rerender: () => {
    renderFlow();
    liveRun.changed("flow");
  },
};

const transportContext: FormContext = {
  regionNames: [],
  meshNames: [],
  regionBounds: [],
  domainSize: 0,
  highlight: (item) => highlight(item),
  changed: () => liveRun.changed("transport"),
  rerender: () => {
    renderTransport();
    liveRun.changed("transport");
  },
};

function render(): void {
  renderForm(
    {
      domain: ui.domainForm,
      fractures: ui.fracturesForm,
      network: ui.form,
      advanced: ui.networkAdvancedForm,
      settings: ui.settingsForm,
    },
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
  ui.flowSettingsForm.replaceChildren(fluidSection(flowState, flowContext));
}

const pointPicking: PointPicking = {
  get isOn() {
    return isPickingPoints;
  },
  setOn: (isOn) => {
    isPickingPoints = isOn;
    renderTransport();
  },
};

function addReleasePoint(point: ReleasePoint): void {
  transportState.seeding.points.push(point);
  renderTransport();
  transportContext.changed();
}

function renderTransport(): void {
  // The picking needs the shown triangle mesh of a flow
  isPickingPoints &&= flowOutput !== null && openPanel === "transport";
  renderTransportForm(ui.transportForm, transportState, flowOutput !== null, transportContext, pointPicking);
  ui.transportSettingsForm.replaceChildren(routingSection(transportState, transportContext));
  void updateViewer((view) => {
    view.setPointPicking(isPickingPoints ? addReleasePoint : null);
    view.setReleasePoints(transportState.seeding.points);
  });
}

/** Shows the settings of a step above the run bar (a phone: the bottom sheet); null = no settings */
function openStepPanel(name: StepPanel | null): void {
  openPanel = name;
  ui.stepPanel.hidden = name === null;
  ui.layout.classList.toggle("has-step-panel", name !== null);
  if (name !== null) {
    ui.stepPanel.setAttribute("aria-label", STEP_PANEL_TITLES[name]);
  }
  for (const segment of ui.stepSegments) {
    const isOpen = segment.dataset.stepPanel === name;
    segment.classList.toggle("is-open", isOpen);
    segment.setAttribute("aria-expanded", String(isOpen));
  }
  for (const group of ui.stepGroups) {
    group.hidden = group.dataset.stepGroup !== name;
  }
  if (isPickingPoints && name !== "transport") {
    pointPicking.setOn(false);
  }
}

/** The Domain panel: the description of the mesh and the boundary surfaces show only when they have content */
function updateDomainPanel(): void {
  ui.shapeDescription.hidden = ui.shapeDescription.textContent === "";
  ui.boundarySurfaces.hidden = boundarySurfaceNames.length === 0;
}

/** Highlights a boundary surface or a region in the 3D view (pointer over its row or field, or its pin); null = none */
function highlight(item: HighlightItem | null): void {
  void updateViewer((view) => showHighlight(view, item));
}

function showHighlight(view: NetworkViewer, item: HighlightItem | null): void {
  view.highlightBoundarySurface(item?.kind === "surface" ? item.name : null);
  view.highlightRegion(item?.kind === "region" ? item.name : null);
}

function renderBoundarySurfaces(): void {
  ui.boundarySurfaces.replaceChildren(
    boundarySurfaceSection(boundarySurfaceNames, {
      roleOf: (name) => roleOf(boundaryRoles, name),
      onRole: (name, role) => {
        setRole(boundaryRoles, name, role, boundarySurfaceNames);
        // The network keeps the clusters which connect the in-flow and out-flow surfaces
        networkChanged();
      },
      onHover: (item) => highlight(item),
    }),
  );
  updateDomainPanel();
}

/** Shows the domain mesh, its boundary surfaces and its regions (hidden until highlighted) */
function showDomainInViewer(view: NetworkViewer, mesh: NonNullable<InputFiles["mesh"]>): void {
  view.setDomainMesh(domainWireframe(mesh.text));
  view.setBoundarySurfaces(
    boundarySurfaceNames.map((name) => ({
      name,
      cells: boundarySurfaceCells(mesh.text, name),
    })),
  );
  view.setRegions(regionNames.map((name) => ({ name, cells: regionOuterFaces(mesh.text, name) })));
  showHighlight(view, getPinnedItem());
  view.setVisible("domain", ui.showDomain.checked);
}

async function setMesh(mesh: InputFiles["mesh"]): Promise<void> {
  files.mesh = mesh;
  previewedUserFracture = null;
  regionNames = mesh === null ? [] : meshRegionNames(mesh.text);
  regionBounds = mesh === null ? [] : meshRegionBounds(mesh.text);
  domainSize = mesh === null ? 0 : meshLargestSide(mesh.text);
  boundarySurfaceNames = mesh === null ? [] : domainBoundarySurfaceNames(mesh.text);
  clearPinnedItem();
  resetOpenCards();
  ui.shapeDescription.textContent = mesh === null ? "" : meshDescription(mesh.text);
  renderBoundarySurfaces();
  // A new domain: no result stays
  savedGeneration = null;
  meshedInput = null;
  clearOutput();
  liveRun.changed("generation");
  updateRunBar();
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
  files = { mesh: null };
  await setMesh(newFiles.mesh);
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
    userFractures: userFracturesToVtp(state.userFractures, state, regionNames),
  };
}

/**
 * True while the steps run again from the network of the view (a new user
 * fracture, new mesh values): the view keeps its mesh and colors, with the
 * placeholder polygon of the changed fracture, until the new flow or the end
 * of the chain changes it at once (user decision: no blink)
 */
let isViewHeld = false;

/** The viewer for the output layers; null while the view is held */
function outputViewer(): NetworkViewer | null {
  return isViewHeld ? null : viewer;
}

/** Holds the view if it shows a mesh */
function holdView(): void {
  isViewHeld ||= output?.shapes?.mesh != null;
}

/** Shows the results of now in one frame: the layers, the colors, then the layer "user" without the placeholder */
async function releaseView(): Promise<void> {
  if (!isViewHeld) {
    return;
  }
  isViewHeld = false;
  if (!viewer) {
    return;
  }
  if (output === null) {
    for (const layer of ["final", "removed", "rejected"] as FractureLayer[]) {
      viewer.setLayer(layer, null);
    }
    removeColorOptions([PRESSURE_OPTION, FLOW_VELOCITY_OPTION, TRANSPORT_VELOCITY_OPTION]);
  }
  viewer.setFlowParticles(null);
  viewer.setTrajectories(null);
  await showOutputInViewer(flowOutput === null ? null : PRESSURE_OPTION);
  showParticlesInViewer();
  await showTransportInViewer();
  updateUserFracturesInViewer();
}

/** The steps of the live run (`liveRun.ts`) */
async function runChainStep(step: ChainStep): Promise<StepResult> {
  // The steps after a change of the network of the view: the view waits for the new flow
  if (step === "userFractures" || step === "mesh") {
    holdView();
  }
  // A new generation from the seed shows its fractures during the run
  if (step === "generation") {
    await releaseView();
  }
  switch (step) {
    case "generation":
    case "userFractures":
      return runFractureStep();
    case "mesh":
      return runMeshing();
    case "flow": {
      const result = await runFlow();
      // A cancel by a change runs the flow again; the end of the chain releases the view in the other cases
      if (result === "done") {
        await releaseView();
      }
      return result;
    }
    case "transport":
      return runTransport();
  }
}

/** The result of a step which threw: a cancel, or an error of the page */
function failedStep(error: unknown): StepResult {
  if (error instanceof CancelledError) {
    // A cancel by a change: the step starts again and shows its own status
    if (!liveRun.isOn) {
      showStatus("Paused.");
    }
    return "cancelled";
  }
  showStatus(errorText(error), true);
  return "failed";
}

/**
 * The fractures of the forms. With the stochastic fractures of the last
 * checkpoint, from that checkpoint: a complete one gives its network with the
 * user-defined fractures of the form, and FRAM does not check its fractures
 * again (user decisions); a stopped one continues the insertion. Else from
 * the seed. Nothing if the network has these fractures.
 */
async function runFractureStep(): Promise<StepResult> {
  const input = generationInput();
  if (typeof input === "string") {
    showStatus(input, true);
    return "failed";
  }
  const network = generatedNetwork;
  const saved = savedGeneration;
  const isNetworkCurrent =
    network !== null &&
    isSameFractureInput(network.input, input) &&
    network.input.userFractures === input.userFractures &&
    (saved === null || saved.isComplete);
  if (isNetworkCurrent) {
    return "done";
  }
  if (saved !== null && isSameFractureInput(saved.input, input)) {
    // The checkpoint is for the TOML of its generation (its hash)
    const restartInput = { ...saved.input, userFractures: input.userFractures };
    return generate(restartInput, { from: saved, mode: saved.isComplete ? "finish" : "continue" });
  }
  return generate(input, null);
}

/** A generation; with `restart`, from a saved checkpoint */
async function generate(input: GenerationInput, restart: GenerationRestart | null): Promise<StepResult> {
  const isFramOn = state.fram.enable;
  const from = restart?.from ?? null;
  setBusy(true);
  ui.progress.value = 0;
  showStatus(
    restart?.mode === "finish"
      ? `Making the network of the ${from?.checkpoint.acceptedCount} stochastic fractures of the last run…`
      : "Generating…",
  );
  // The view shows the new fractures during the run, not the old network;
  // a restart shows the fractures until its checkpoint again
  clearOutput();
  outputViewer()?.clearGenerationFractures();
  const fractures: FractureBatch[] = from === null ? [] : [from.fractures];
  const runViewer = outputViewer();
  if (from !== null && runViewer) {
    runViewer.addGenerationFractures(from.fractures);
    runViewer.render();
  }
  let checkpoint: GenerationCheckpoint | null = from?.checkpoint ?? null;
  let lastAcceptedCount = checkpoint?.acceptedCount ?? null;
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
      const view = outputViewer();
      if (!view) {
        return;
      }
      view.addGenerationFractures(batch);
      const now = performance.now();
      if (now - lastRenderTime >= GENERATION_RENDER_INTERVAL_MS || fraction >= 1) {
        lastRenderTime = now;
        view.render();
      }
    },
    onCheckpoint: (newCheckpoint) => {
      checkpoint = newCheckpoint;
    },
  };
  /** The checkpoint until now, with its fractures; `isInsertionEnded`: this run ended the insertion */
  const savedNow = (isInsertionEnded: boolean): SavedGeneration | null => {
    if (checkpoint === null) {
      return null;
    }
    if (checkpoint === from?.checkpoint) {
      // No new fracture: the saved generation stays, with the user-defined fractures of this run
      return { ...from, input, isComplete: from.isComplete || isInsertionEnded };
    }
    return { checkpoint, fractures: firstFractures(fractures, checkpoint.acceptedCount), input, isComplete: isInsertionEnded };
  };
  try {
    const result = await client.run(
      input,
      callbacks,
      restart === null ? null : { checkpoint: restart.from.checkpoint.checkpoint, mode: restart.mode },
    );
    if (result.error !== null) {
      showStatus(toolErrorText(result.error), true);
      return "failed";
    }
    const isCheckpointOfAll = checkpoint?.acceptedCount === lastAcceptedCount;
    savedGeneration = isCheckpointOfAll ? savedNow(restart?.mode !== "finish") : null;
    const finishText =
      savedGeneration?.isComplete === false
        ? `\nThe network has the ${savedGeneration.checkpoint.acceptedCount} fractures until the pause. "Run" adds the others.`
        : "";
    showGenerationDone(result, startTime, finishText);
    generatedNetwork = {
      input,
      seed: result.seed,
      checkpoint: savedGeneration?.checkpoint.checkpoint ?? null,
      isWithoutConnectingCluster: result.isWithoutConnectingCluster,
      isFramOn,
    };
    meshedInput = null;
    showDiscardedLabel();
    // The network shows the user-defined fractures, in the domain; a held view keeps the placeholder until its new mesh
    previewedUserFracture = null;
    if (!isViewHeld) {
      updateUserFracturesInViewer();
    }
    await showOutput(result);
    return "done";
  } catch (error) {
    if (error instanceof CancelledError) {
      // The checkpoint of the run, or that of its restart; none: a new generation stopped before its first checkpoint
      savedGeneration = savedNow(false);
    }
    return failedStep(error);
  } finally {
    // The final layers replace the fractures of the run; after an error or a cancel, nothing does
    const endViewer = outputViewer();
    if (endViewer) {
      endViewer.clearGenerationFractures();
      endViewer.render();
    }
    setBusy(false);
    await keepStoppedFractures();
  }
}

/** After "Pause" during a generation: the network of the fractures until its last checkpoint */
async function keepStoppedFractures(): Promise<void> {
  if (!isKeepRequested) {
    return;
  }
  isKeepRequested = false;
  const saved = savedGeneration;
  if (saved !== null) {
    await generate(saved.input, { from: saved, mode: "finish" });
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

/** The triangle mesh: the fractures of the last generation, with the mesh values of the forms now */
async function runMeshing(): Promise<StepResult> {
  const network = generatedNetwork;
  const current = generationInput();
  if (typeof current === "string") {
    showStatus(current, true);
    return "failed";
  }
  if (network === null) {
    showStatus("The mesh needs a network.", true);
    return "failed";
  }
  // The particles need a path: the status shows the warning of the generation
  if (network.isWithoutConnectingCluster) {
    return "failed";
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
      return "failed";
    }
    showGenerationDone(result, startTime);
    meshedInput = current;
    await showOutput(result);
    return "done";
  } catch (error) {
    return failedStep(error);
  } finally {
    setBusy(false);
  }
}

/** The flow input for the worker, or an error message */
function flowInput(): FlowInput | string {
  const mesh = flowMesh();
  if (mesh === null) {
    return "The flow needs the triangle mesh of a network.";
  }
  if (ui.flowForm.querySelector(".is-invalid")) {
    return "A field of the form has an invalid value (red border). Correct it first.";
  }
  return { toml: flowToLibraryToml(flowState, surfacesWithPoints(mesh.boundaries, flowSurfaces(boundaryRoles))), mesh };
}

async function runFlow(): Promise<StepResult> {
  const input = flowInput();
  if (typeof input === "string") {
    showStatus(input, true);
    return "failed";
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
      return "failed";
    }
    flowDoneText = `Done in ${durationText(performance.now() - startTime)}: ${result.newtonIterations} Newton iterations.`;
    showStatus(flowDoneText);
    await showFlowOutput(result, input.toml);
    return "done";
  } catch (error) {
    return failedStep(error);
  } finally {
    setBusy(false);
  }
}

/** The transport input for the worker, or an error message */
function transportInput(): TransportInput | string {
  const mesh = flowMesh();
  if (mesh === null || flowOutputToml === null) {
    return "The transport needs a flow.";
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

async function runTransport(): Promise<StepResult> {
  const input = transportInput();
  if (typeof input === "string") {
    showStatus(input, true);
    return "failed";
  }
  if (transportState.seeding.points.length === 0) {
    // The trajectories of removed points go
    clearTransportOutput();
    showStatus(`${flowDoneText}\n${NO_RELEASE_POINT}`);
    return "done";
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
      return "failed";
    }
    showStatus(
      `Done in ${durationText(performance.now() - startTime)}: ${result.exitCount} of ${result.particleCount} particles exited.`,
    );
    await showTransportOutput(result, timeUnit);
    return "done";
  } catch (error) {
    return failedStep(error);
  } finally {
    setBusy(false);
  }
}

// ---------------------------------------------------------------- output

function clearOutput(): void {
  output = null;
  generatedNetwork = null;
  showDiscardedLabel();
  ui.results.hidden = true;
  ui.logEmpty.hidden = false;
  ui.colorSelect.disabled = true;
  ui.logScale.disabled = true;
  const view = outputViewer();
  if (view) {
    for (const layer of ["final", "removed", "rejected"] as FractureLayer[]) {
      view.setLayer(layer, null);
    }
    view.render();
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
  // The release of a held view makes all options again
  if (isViewHeld) {
    return;
  }
  const isSelected = optionValues.includes(ui.colorSelect.value);
  for (const option of [...ui.colorSelect.options]) {
    if (optionValues.includes(option.value)) {
      option.remove();
    }
  }
  if (isSelected) {
    ui.colorSelect.value = DEFAULT_COLOR_OPTION;
    const view = outputViewer();
    if (view) {
      applyColorChoice(view);
    }
  }
}

/** The flow output belongs to the mesh of one generation */
function clearFlowOutput(): void {
  flowOutput = null;
  flowOutputToml = null;
  ui.flowResults.hidden = true;
  removeColorOptions([PRESSURE_OPTION, FLOW_VELOCITY_OPTION]);
  ui.showParticles.checked = false;
  ui.showParticles.disabled = true;
  outputViewer()?.setFlowParticles(null);
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
  const view = outputViewer();
  if (view) {
    view.setTrajectories(null);
    view.render();
  }
}

/** The triangle mesh of the last mesh step, the mesh of the flow */
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
  const view = outputViewer();
  if (!view || flowOutput === null || mesh === null) {
    return;
  }
  view.setFlowParticles({ points: mesh.points, triangles: mesh.triangles, velocities: flowOutput.darcyVelocities });
  applyLayerVisibility(view);
  view.render();
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
  const view = outputViewer();
  if (!view || transportOutput === null || transportOutput.pathPointCounts.length === 0) {
    return;
  }
  view.setTrajectories({
    points: transportOutput.pathPoints,
    velocities: transportOutput.pathVelocities,
    pointCounts: transportOutput.pathPointCounts,
  });
  applyLayerVisibility(view);
  view.render();
}

/** The layer button of the discarded fractures: the rejected ones only after a network with FRAM on */
function showDiscardedLabel(): void {
  const label = generatedNetwork?.isFramOn ? "Removed and rejected" : "Removed";
  const toggle = ui.showDiscarded.closest("label");
  if (toggle === null) {
    return;
  }
  toggle.title = label;
  ui.showDiscarded.setAttribute("aria-label", label);
  const text = toggle.querySelector(".icon-label");
  if (text !== null) {
    text.textContent = label;
  }
  toggle.classList.toggle("is-without-rejected", !generatedNetwork?.isFramOn);
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
  const view = outputViewer();
  if (!view || !output) {
    return;
  }
  const shapes = output.shapes;
  // Before the mesh step, the polygons of the final fractures
  view.setLayer("final", shapes?.mesh ? meshWithFlowArrays(shapes.mesh) : layerShapes(shapes?.fractures));
  view.setLayer("removed", layerShapes(shapes?.removed));
  view.setLayer("rejected", layerShapes(shapes?.rejected));
  applyLayerVisibility(view);

  const previous = ui.colorSelect.value;
  const options = view
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
  applyColorChoice(view);
  view.render();
}

// ---------------------------------------------------------------- viewer

// The updates of the layer "user" run one after the other: two updates at the
// same time could both add their polygons
let userFracturesUpdate: Promise<void> = Promise.resolve();
/**
 * The user-defined fracture whose card changed: the layer "user" shows only
 * its polygon, until the next network shows the fractures (user decision)
 */
let previewedUserFracture: number | null = null;

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

/** Shows the polygon of the previewed user-defined fracture, if it has a region of the mesh */
function updateUserFracturesInViewer(): void {
  userFracturesUpdate = userFracturesUpdate
    .then(async () => {
      if (!viewer) {
        return;
      }
      const previewed = previewedUserFracture === null ? undefined : state.userFractures[previewedUserFracture];
      const fractures = previewed !== undefined && regionNames.includes(previewed.region) ? [previewed] : [];
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

/** The start of the page: default forms on the first predefined mesh */
async function startFromShape(): Promise<void> {
  const name = meshNames[0];
  if (name === undefined) {
    return;
  }
  try {
    const mesh = await loadMesh(name);
    await loadInput(defaultWorkflow(name, domainBoundarySurfaceNames(mesh.text)), { mesh });
    ui.form.dataset.shape = name;
  } catch (error) {
    showStatus(errorText(error), true);
  }
}

/** Closes the settings of the open step: the focus goes to its segment of the run bar */
function closeStepPanel(): void {
  const segment = ui.stepSegments.find((candidate) => candidate.dataset.stepPanel === openPanel);
  openStepPanel(null);
  segment?.focus();
}

/**
 * The handle bar of the bottom sheet of a phone: a tap or a swipe down closes the settings (the run bar is
 * hidden while they show)
 */
function bindSheetHandle(): void {
  // The start and the last vertical position of a pointer on the bar; the browser can end a touch with
  // `pointercancel`, and the position of `pointerup` can be that of the start
  let swipe: { start: number; last: number } | null = null;
  ui.sheetHandle.addEventListener("pointerdown", (event) => {
    swipe = { start: event.clientY, last: event.clientY };
    ui.sheetHandle.setPointerCapture(event.pointerId);
  });
  ui.sheetHandle.addEventListener("pointermove", (event) => {
    if (swipe !== null) {
      swipe.last = event.clientY;
    }
  });
  const endSwipe = () => {
    if (swipe !== null && swipe.last - swipe.start > SHEET_SWIPE_DISTANCE && openPanel !== null) {
      closeStepPanel();
    }
    swipe = null;
  };
  ui.sheetHandle.addEventListener("pointerup", endSwipe);
  ui.sheetHandle.addEventListener("pointercancel", endSwipe);
  ui.sheetHandle.addEventListener("click", () => {
    if (openPanel !== null) {
      closeStepPanel();
    }
  });
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
  networkChanged();
}

function toggleLog(): void {
  ui.logView.hidden = !ui.logView.hidden;
  ui.logButton.setAttribute("aria-expanded", String(!ui.logView.hidden));
}

/**
 * The parts of the page which the panels cover: the view centers the model in the
 * rest, and `style.css` places the Log panel, the legend and the layers with them.
 * On a wide screen the settings of a step cover the view: the view does not move
 * when they open.
 */
function updateCoveredArea(): void {
  const isSheet = window.matchMedia(SHEET_QUERY).matches;
  const pageHeight = window.innerHeight;
  const coveredBottom = pageHeight - (isSheet ? ui.dock : ui.runPanel).getBoundingClientRect().top;
  ui.layout.style.setProperty("--covered-bottom", `${coveredBottom}px`);
  ui.layout.style.setProperty("--run-panel-height", `${ui.runPanel.offsetHeight}px`);
  viewer?.setCoveredArea({
    left: 0,
    top: isSheet
      ? (ui.viewerToolbar.querySelector(".color-panel")?.getBoundingClientRect().bottom ?? 0)
      : ui.titlePanel.getBoundingClientRect().bottom,
    bottom: coveredBottom,
  });
}

function bindEvents(): void {
  ui.runButton.addEventListener("click", toggleLiveRun);
  ui.resetButton.addEventListener("click", resetAll);

  for (const control of [ui.colorSelect, ui.logScale]) {
    control.addEventListener("change", () => updateViewer(applyColorChoice));
  }
  ui.showDomain.addEventListener("change", () => updateViewer((view) => view.setVisible("domain", ui.showDomain.checked)));
  for (const checkbox of [ui.showMesh, ui.showUserFractures, ui.showDiscarded, ui.showTrajectories, ui.showParticles]) {
    checkbox.addEventListener("change", () => updateViewer(applyLayerVisibility));
  }
  ui.showColorBar.addEventListener("change", () => updateViewer((view) => view.setScalarBarShown(ui.showColorBar.checked)));
  ui.resetCamera.addEventListener("click", () => updateViewer((view) => view.resetCamera()));

  for (const segment of ui.stepSegments) {
    segment.addEventListener("click", () => {
      const name = STEP_PANELS.find((candidate) => candidate === segment.dataset.stepPanel) ?? null;
      // A second click on the open step closes its settings
      openStepPanel(name === openPanel ? null : name);
    });
  }
  // Escape closes the settings of a step; the settings dialog closes itself, and a field keeps its own Escape
  document.addEventListener("keydown", (event) => {
    const isInField = event.target instanceof Element && event.target.matches("input, select, textarea");
    if (event.key === "Escape" && openPanel !== null && !ui.settingsDialog.open && !isInField) {
      closeStepPanel();
    }
  });
  bindSheetHandle();
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
  for (const panel of [ui.dock, ui.runPanel, ui.viewerToolbar]) {
    coveredAreaObserver.observe(panel);
  }
  window.addEventListener("resize", updateCoveredArea);
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
openStepPanel(openPanel);
updateRunBar();
render();
renderFlow();
renderTransport();
void fillMeshList().then(startFromShape);
void startViewer();
