// 3D view of the network with VTK.wasm.
//
// Each VTK object is changed with its setter methods: an assignment to a
// property (`mapper.scalarVisibility = 1`) can set other properties back
// (it gave the mapper its old lookup table).
//
// The viewer reads the output files of the generation, the flow and the transport (and
// the domain mesh) with the XML readers of VTK from their text. Thus it shows
// exactly the files which the user downloads.

import {
  loadAsync,
  type StandaloneSession,
  type VtkNamespace,
  type vtkActor,
  type vtkLookupTable,
  type vtkPolyDataMapper,
  type vtkRenderer,
  type vtkScalarBarActor,
  type vtkWebAssemblyOpenGLRenderWindow,
  type vtkXMLPolyDataReader,
} from "@kitware/vtk-wasm";

const VTK_BUNDLE_URL = `${import.meta.env.BASE_URL}vtk/vtk-wasm32-emscripten.tar.gz`;

// VTK_GET_ARRAY_BY_NAME of vtkMapper
const ARRAY_ACCESS_BY_NAME = 1;
// The default of vtkScalarBarActor, and 6 significant digits for the pressure
const DEFAULT_LABEL_FORMAT = "%-#6.3g";
const PRESSURE_LABEL_FORMAT = "%-#.6g";

// The trajectories: tube radius relative to the diagonal of their bounds,
// cone height relative to the tube radius, and the number of cones (for
// each path, and at most). Magenta is not a color of the lookup tables.
const TUBE_RADIUS_FRACTION = 0.003;
const CONE_HEIGHT_FACTOR = 4;
const CONES_PER_PATH = 20;
const MAX_CONE_COUNT = 500;
const TRAJECTORY_COLOR = [0.85, 0.1, 0.85] as const;

export type FractureLayer = "final" | "removed" | "rejected";

/** A data array of the triangle mesh of the final fractures, with one component */
export interface ColorArray {
  name: string;
  association: "cell" | "point";
}

/** The pressure of the flow, which `addPointArray` adds to the mesh */
export const PRESSURE_ARRAY: ColorArray = { name: "pressure", association: "point" };

interface PolyDataLayer {
  reader: vtkXMLPolyDataReader;
  mapper: vtkPolyDataMapper;
  actor: vtkActor;
}

export class NetworkViewer {
  private readonly vtk: VtkNamespace;
  private readonly renderer: vtkRenderer;
  private readonly window: vtkWebAssemblyOpenGLRenderWindow;
  private readonly lookupTable: vtkLookupTable;
  private readonly scalarBar: vtkScalarBarActor;
  private readonly layers = new Map<FractureLayer, PolyDataLayer>();
  /** Tubes and cones */
  private trajectoryActors: vtkActor[] = [];
  private domainActor: vtkActor | null = null;
  private colorArray: ColorArray | null = null;

  private constructor(
    session: StandaloneSession,
    renderer: vtkRenderer,
    window: vtkWebAssemblyOpenGLRenderWindow,
  ) {
    this.vtk = session.vtk;
    this.renderer = renderer;
    this.window = window;
    this.lookupTable = this.vtk.vtkLookupTable();
    this.lookupTable.setHueRange(0.667, 0.0);
    this.lookupTable.build();
    this.scalarBar =this.vtk.vtkScalarBarActor();
    this.scalarBar.setLookupTable(this.lookupTable);
    this.scalarBar.setNumberOfLabels(5);
    this.scalarBar.setMaximumWidthInPixels(90);
    // The default text is white, and the background is white
    this.scalarBar.getTitleTextProperty().setColor(0.1, 0.1, 0.1);
    this.scalarBar.getLabelTextProperty().setColor(0.1, 0.1, 0.1);
    this.scalarBar.setVisibility(0);
    this.renderer.addViewProp(this.scalarBar);
  }

  static async create(canvas: HTMLCanvasElement): Promise<NetworkViewer> {
    const runtime = await loadAsync({ url: VTK_BUNDLE_URL, rendering: "webgl" });
    const session = runtime.createStandaloneSession();
    const vtk = session.vtk;

    const renderer = vtk.vtkRenderer();
    renderer.setBackground(1.0, 1.0, 1.0);

    const canvasSelector = session.registerCanvas("!dfngen-canvas", canvas);
    const interactor = vtk.vtkWebAssemblyRenderWindowInteractor({ canvasSelector });
    interactor.setInteractorStyle(vtk.vtkInteractorStyleTrackballCamera());
    const window = vtk.vtkWebAssemblyOpenGLRenderWindow({ interactor, canvasSelector });
    window.addRenderer(renderer);
    await window.render();
    interactor.start();

    return new NetworkViewer(session, renderer, window);
  }

  /** Shows the domain mesh (text of an ASCII .vtu file) as a wireframe. */
  async setDomainMesh(vtuText: string): Promise<void> {
    if (this.domainActor) {
      this.renderer.removeActor(this.domainActor);
      this.domainActor = null;
    }
    const reader = this.vtk.vtkXMLUnstructuredGridReader();
    reader.readFromInputStringOn();
    reader.setInputString(vtuText);
    // vtkDataSetMapper is not in the VTK.wasm bundle: show the cell edges
    const edges = this.vtk.vtkExtractEdges();
    edges.setInputConnection(0, reader.getOutputPort(0));
    const mapper = this.vtk.vtkPolyDataMapper();
    mapper.setInputConnection(0, edges.getOutputPort(0));
    mapper.setScalarVisibility(0);
    const actor = this.vtk.vtkActor({ mapper });
    const property = actor.getProperty();
    property.setColor(0.3, 0.3, 0.3);
    this.renderer.addActor(actor);
    this.domainActor = actor;
  }

  /**
   * Shows a fracture file (text of a .vtp file), or removes the layer (null).
   * The layer "final" is the triangle mesh, shown with its edges.
   */
  async setLayer(layer: FractureLayer, vtpText: string | null): Promise<void> {
    const old = this.layers.get(layer);
    if (old) {
      this.renderer.removeActor(old.actor);
      this.layers.delete(layer);
    }
    if (vtpText === null) {
      return;
    }
    const reader = this.vtk.vtkXMLPolyDataReader();
    reader.readFromInputStringOn();
    reader.setInputString(vtpText);
    await reader.update(0);
    const mapper = this.vtk.vtkPolyDataMapper();
    mapper.setInputConnection(0, reader.getOutputPort(0));
    mapper.setScalarVisibility(0);
    const actor = this.vtk.vtkActor({ mapper });
    const property = actor.getProperty();
    property.setRepresentationToSurface();
    if (layer === "removed") {
      property.setColor(0.6, 0.6, 0.6);
      property.setOpacity(0.4);
    } else if (layer === "rejected") {
      property.setColor(0.85, 0.2, 0.2);
      property.setOpacity(0.25);
    } else {
      property.setEdgeVisibility(1);
      property.setEdgeColor(0.2, 0.2, 0.2);
    }
    this.renderer.addActor(actor);
    this.layers.set(layer, { reader, mapper, actor });
    if (layer === "final") {
      await this.colorBy(this.colorArray);
    }
  }

  /** Names of the cell data arrays with one component of the triangle mesh of the final fractures. */
  async cellArrayNames(): Promise<string[]> {
    const final = this.layers.get("final");
    if (!final) {
      return [];
    }
    const cellData = final.reader.getOutput().getCellData();
    const names: string[] = [];
    const count = cellData.getNumberOfArrays();
    for (let index = 0; index < count; index++) {
      const array = cellData.getArray(index);
      if (array && array.getNumberOfComponents() === 1) {
        names.push(cellData.getArrayName(index));
      }
    }
    return names;
  }

  /** The scalar bar of the color array; the pressure has its unit and more digits */
  private updateScalarBar(): void {
    const isColored = this.colorArray !== null && this.layers.has("final");
    const isPressure =
      isColored &&
      this.colorArray?.name === PRESSURE_ARRAY.name &&
      this.colorArray.association === PRESSURE_ARRAY.association;
    this.scalarBar.setTitle(isPressure ? "pressure (MPa)" : (this.colorArray?.name ?? ""));
    // The pressure differences are small against the pressure
    this.scalarBar.setLabelFormat(isPressure ? PRESSURE_LABEL_FORMAT : DEFAULT_LABEL_FORMAT);
    this.scalarBar.setVisibility(isColored ? 1 : 0);
  }

  /** Colors the triangle mesh of the final fractures by a data array, or with one color (null). */
  async colorBy(colorArray: ColorArray | null): Promise<void> {
    this.colorArray = colorArray;
    const final = this.layers.get("final");
    if (!final) {
      this.updateScalarBar();
      return;
    }
    if (colorArray === null) {
      final.mapper.setScalarVisibility(0);
      final.actor.getProperty().setColor(0.95, 0.75, 0.3);
      this.updateScalarBar();
      return;
    }
    const { name, association } = colorArray;
    const output = final.reader.getOutput();
    const data = association === "cell" ? output.getCellData() : output.getPointData();
    const arrayIndex = [...Array(data.getNumberOfArrays()).keys()].find((index) => data.getArrayName(index) === name);
    if (arrayIndex === undefined) {
      throw new Error(`dfn_mesh.vtu has no ${association} array ${name}`);
    }
    const range = data.getArray(arrayIndex).getRange(0);
    // The mapper selects the array by its name; it does not set the range of
    // the lookup table, thus the range is set there
    if (association === "cell") {
      final.mapper.setScalarModeToUseCellFieldData();
    } else {
      final.mapper.setScalarModeToUsePointFieldData();
    }
    final.mapper.setArrayAccessMode(ARRAY_ACCESS_BY_NAME);
    final.mapper.setArrayName(name);
    final.mapper.setArrayComponent(0);
    this.lookupTable.setTableRange(range);
    final.mapper.setLookupTable(this.lookupTable);
    final.mapper.setUseLookupTableScalarRange(1);
    final.mapper.setScalarVisibility(1);
    this.updateScalarBar();
  }

  /**
   * Shows the particle paths (text of `trajectories.vtp` with `velocity` as
   * the active vectors) as tubes, with cones in the direction of the
   * velocity; or removes them (null).
   */
  async setTrajectories(vtpText: string | null): Promise<void> {
    for (const actor of this.trajectoryActors) {
      this.renderer.removeActor(actor);
    }
    this.trajectoryActors = [];
    if (vtpText === null) {
      return;
    }
    const reader = this.vtk.vtkXMLPolyDataReader();
    reader.readFromInputStringOn();
    reader.setInputString(vtpText);
    await reader.update(0);
    const paths = reader.getOutput();
    const tubeRadius = TUBE_RADIUS_FRACTION * paths.getLength();

    const tubes = this.vtk.vtkTubeFilter();
    tubes.setInputConnection(0, reader.getOutputPort(0));
    tubes.setRadius(tubeRadius);
    tubes.setNumberOfSides(8);
    const tubeMapper = this.vtk.vtkPolyDataMapper();
    tubeMapper.setInputConnection(0, tubes.getOutputPort(0));
    tubeMapper.setScalarVisibility(0);

    // Every n-th point (thus not at equal distances); the speeds differ by
    // orders of magnitude, thus all cones have one size
    const coneCount = Math.min(MAX_CONE_COUNT, CONES_PER_PATH * paths.getNumberOfLines());
    const points = this.vtk.vtkMaskPoints();
    points.setInputConnection(0, reader.getOutputPort(0));
    points.setOnRatio(Math.max(1, Math.floor(paths.getNumberOfPoints() / coneCount)));
    const cone = this.vtk.vtkConeSource();
    cone.setResolution(12);
    const cones = this.vtk.vtkGlyph3D();
    cones.setInputConnection(0, points.getOutputPort(0));
    cones.setSourceConnection(0, cone.getOutputPort(0));
    cones.setVectorModeToUseVector();
    cones.setOrient(1);
    cones.setScaleModeToDataScalingOff();
    cones.setScaleFactor(CONE_HEIGHT_FACTOR * tubeRadius);
    const coneMapper = this.vtk.vtkPolyDataMapper();
    coneMapper.setInputConnection(0, cones.getOutputPort(0));
    coneMapper.setScalarVisibility(0);

    for (const mapper of [tubeMapper, coneMapper]) {
      const actor = this.vtk.vtkActor({ mapper });
      actor.getProperty().setColor(...TRAJECTORY_COLOR);
      this.renderer.addActor(actor);
      this.trajectoryActors.push(actor);
    }
  }

  setVisible(layer: FractureLayer | "domain" | "trajectories", isVisible: boolean): void {
    const visibility = isVisible ? 1 : 0;
    if (layer === "trajectories") {
      for (const actor of this.trajectoryActors) {
        actor.setVisibility(visibility);
      }
      return;
    }
    const actor = layer === "domain" ? this.domainActor : this.layers.get(layer)?.actor;
    if (actor) {
      actor.setVisibility(visibility);
    }
  }

  /** Oblique view with z up, which shows all of the domain */
  resetCamera(): void {
    const camera = this.renderer.getActiveCamera();
    camera.setFocalPoint(0, 0, 0);
    camera.setPosition(1, -1.6, 1.1);
    camera.setViewUp(0, 0, 1);
    this.renderer.resetCamera();
  }

  async render(): Promise<void> {
    await this.window.render();
  }
}
