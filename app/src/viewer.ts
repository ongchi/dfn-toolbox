// 3D view of the network with VTK.wasm.
//
// Each VTK object is changed with its setter methods: an assignment to a
// property (`mapper.scalarVisibility = 1`) can set other properties back
// (it gave the mapper its old lookup table).
//
// The viewer reads the output files of the generation (and the domain mesh)
// with the XML readers of VTK from their text. Thus it shows exactly the
// files which the user downloads.

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

export type FractureLayer = "final" | "removed" | "rejected";

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
  private meshActor: vtkActor | null = null;
  private colorArrayName: string | null = null;

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
    this.scalarBar = this.vtk.vtkScalarBarActor();
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
  async setMesh(vtuText: string): Promise<void> {
    if (this.meshActor) {
      this.renderer.removeActor(this.meshActor);
      this.meshActor = null;
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
    this.meshActor = actor;
  }

  /** Shows a fracture file (text of a .vtp file), or removes the layer (null). */
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
    }
    this.renderer.addActor(actor);
    this.layers.set(layer, { reader, mapper, actor });
    if (layer === "final") {
      await this.colorBy(this.colorArrayName);
    }
  }

  /** Names of the cell data arrays with one component of the final fractures. */
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

  /** Colors the final fractures by a cell data array, or with one color (null). */
  async colorBy(arrayName: string | null): Promise<void> {
    this.colorArrayName = arrayName;
    const final = this.layers.get("final");
    if (!final) {
      this.scalarBar.setVisibility(0);
      return;
    }
    if (arrayName === null) {
      final.mapper.setScalarVisibility(0);
      final.actor.getProperty().setColor(0.95, 0.75, 0.3);
      this.scalarBar.setVisibility(0);
      return;
    }
    const cellData = final.reader.getOutput().getCellData();
    const arrayIndex = [...Array(cellData.getNumberOfArrays()).keys()].find(
      (index) => cellData.getArrayName(index) === arrayName,
    );
    if (arrayIndex === undefined) {
      throw new Error(`fractures.vtp has no cell array ${arrayName}`);
    }
    const range = cellData.getArray(arrayIndex).getRange(0);
    // The mapper selects the array by its name; it does not set the range of
    // the lookup table, thus the range is set there
    final.mapper.setScalarModeToUseCellFieldData();
    final.mapper.setArrayAccessMode(ARRAY_ACCESS_BY_NAME);
    final.mapper.setArrayName(arrayName);
    final.mapper.setArrayComponent(0);
    this.lookupTable.setTableRange(range);
    final.mapper.setLookupTable(this.lookupTable);
    final.mapper.setUseLookupTableScalarRange(1);
    final.mapper.setScalarVisibility(1);
    this.scalarBar.setTitle(arrayName);
    this.scalarBar.setVisibility(1);
  }

  setVisible(layer: FractureLayer | "mesh", isVisible: boolean): void {
    const actor = layer === "mesh" ? this.meshActor : this.layers.get(layer)?.actor;
    if (actor) {
      actor.setVisibility(isVisible ? 1 : 0);
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
