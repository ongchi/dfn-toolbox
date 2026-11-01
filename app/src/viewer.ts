// 3D view of the network with VTK.wasm.
//
// Each VTK object is changed with its setter methods: an assignment to a
// property (`mapper.scalarVisibility = 1`) can set other properties back
// (it gave the mapper its old lookup table).
//
// The viewer reads the output files of the generation, the flow and the transport (and
// the domain mesh) with the XML readers of VTK from their text.

import {
  loadAsync,
  type StandaloneSession,
  type VtkNamespace,
  type vtkActor,
  type vtkCellArray,
  type vtkLookupTable,
  type vtkPoints,
  type vtkPolyData,
  type vtkPolyDataMapper,
  type vtkRenderer,
  type vtkScalarBarActor,
  type vtkWebAssemblyOpenGLRenderWindow,
  type vtkXMLPolyDataReader,
} from "@kitware/vtk-wasm";
import type { FractureBatch } from "./generationClient";
import { vtkBundleUrl } from "./vtkBundle";

// VTK_GET_ARRAY_BY_NAME of vtkMapper
const ARRAY_ACCESS_BY_NAME = 1;
// The default of vtkScalarBarActor, 6 significant digits for the pressure,
// and an exponent for the velocities (they are small)
const DEFAULT_LABEL_FORMAT = "%-#6.3g";
const PRESSURE_LABEL_FORMAT = "%-#.6g";
const VELOCITY_LABEL_FORMAT = "%-#.3e";
// The text of the scalar bar has the size of the text of the page (`:root` of style.css),
// in CSS pixels; the bar is at most this wide
const SCALAR_BAR_FONT_SIZE = 14;
const SCALAR_BAR_WIDTH = 110;
// CSS pixels between the title and the bar
const SCALAR_BAR_TITLE_SPACE = 8;

// The trajectories: tube radius relative to the diagonal of their bounds,
// cone height relative to the tube radius, and the number of cones (for
// each path, and at most). Magenta is not a color of the lookup tables.
const TUBE_RADIUS_FRACTION = 0.003;
const CONE_HEIGHT_FACTOR = 4;
const CONES_PER_PATH = 20;
const MAX_CONE_COUNT = 500;
const TRAJECTORY_COLOR = [0.85, 0.1, 0.85] as const;
// The boundary surfaces of the domain do not hide the fractures behind them
const BOUNDARY_SURFACE_OPACITY = 0.5;
/** Pixels: the outline of a highlighted boundary surface */
const BOUNDARY_OUTLINE_WIDTH = 15;
/** Yellow: one color for the outline of each surface, which stands out from the surface colors */
const BOUNDARY_OUTLINE_COLOR = [1.0, 0.85, 0.0] as const;
// The x, y, z axes in the top-left corner (fractions of the view: x min, y min, x max, y max);
// the scalar bar is at the right
const AXES_VIEWPORT = [0, 0.8, 0.2, 1] as const;
// vtkScalarBarActor: its default position (fractions of the view)
const DEFAULT_SCALAR_BAR_LEFT = 0.82;
const DEFAULT_SCALAR_BAR_BOTTOM = 0.1;
/** The CSS pixels at the right of the left edge of the scalar bar, for its title and labels */
const SCALAR_BAR_MINIMUM_ROOM = 100;
// The fractures of a running generation: one color for each family (family
// 1 has the first one; more families use the colors again). Not red: the
// rejected fractures are red.
const FAMILY_COLORS: readonly (readonly [number, number, number])[] = [
  [0.95, 0.6, 0.15],
  [0.2, 0.6, 0.85],
  [0.35, 0.7, 0.3],
  [0.6, 0.4, 0.8],
  [0.55, 0.45, 0.3],
];

/** "user": the polygons of the user-defined fractures of the form, before the generation */
export type FractureLayer = "final" | "removed" | "rejected" | "user";

/** A data array of the triangle mesh of the final fractures, with one component */
export interface ColorArray {
  name: string;
  association: "cell" | "point";
}

/** The pressure of the flow, which `addPointArray` adds to the mesh */
export const PRESSURE_ARRAY: ColorArray = { name: "pressure", association: "point" };
/** The magnitude of the Darcy velocity of each triangle of the flow */
export const FLOW_VELOCITY_ARRAY: ColorArray = { name: "flow_velocity", association: "cell" };
/** The mean speed of the particle tracking at each point */
export const TRANSPORT_VELOCITY_ARRAY: ColorArray = { name: "transport_velocity", association: "point" };

/** The title and the label format of the scalar bar of the arrays which the app adds; other arrays: their name */
const SCALAR_BARS = new Map<string, { title: string; labelFormat: string }>([
  // The pressure differences are small against the pressure
  [PRESSURE_ARRAY.name, { title: "pressure (MPa)", labelFormat: PRESSURE_LABEL_FORMAT }],
  [FLOW_VELOCITY_ARRAY.name, { title: "flow velocity (m/s)", labelFormat: VELOCITY_LABEL_FORMAT }],
  [TRANSPORT_VELOCITY_ARRAY.name, { title: "transport velocity (m/s)", labelFormat: VELOCITY_LABEL_FORMAT }],
]);

/** A boundary surface of the domain mesh: its PolyData text, and its color as "#rrggbb" */
export interface BoundarySurface {
  name: string;
  vtpText: string;
  color: string;
}

/** The red, green and blue (0 to 1) of a color "#rrggbb" */
function colorComponents(color: string): [number, number, number] {
  return [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16) / 255) as [number, number, number];
}

/** A VTK object which the app created */
interface VtkObject {
  $delete(): boolean;
}

interface PolyDataLayer {
  reader: vtkXMLPolyDataReader;
  mapper: vtkPolyDataMapper;
  actor: vtkActor;
}

/** The fractures of one family of a running generation; each batch adds to them */
interface GenerationFamily {
  points: vtkPoints;
  polygons: vtkCellArray;
  polyData: vtkPolyData;
  actor: vtkActor;
}

export class NetworkViewer {
  private readonly vtk: VtkNamespace;
  private readonly renderer: vtkRenderer;
  private readonly window: vtkWebAssemblyOpenGLRenderWindow;
  private readonly lookupTable: vtkLookupTable;
  private readonly scalarBar: vtkScalarBarActor;
  private readonly layers = new Map<FractureLayer, PolyDataLayer>();
  /** The fractures of a running generation, by family number */
  private readonly generationFamilies = new Map<number, GenerationFamily>();
  /** Tubes and cones */
  private trajectoryActors: vtkActor[] = [];
  /** All VTK objects of the tubes and the cones */
  private trajectoryObjects: VtkObject[] = [];
  /** Objects out of the scene: `render` deletes them, as the old view can use them until then */
  private retiredObjects: VtkObject[] = [];
  private domainActor: vtkActor | null = null;
  /** The boundary surfaces of the domain mesh, by name; part of the layer "domain" */
  private boundarySurfaceActors = new Map<string, vtkActor>();
  /** The outline of each boundary surface, by name; visible only while highlighted */
  private boundaryOutlineActors = new Map<string, vtkActor>();
  private colorArray: ColorArray | null = null;
  private readonly canvas: HTMLCanvasElement;

  private constructor(
    session: StandaloneSession,
    renderer: vtkRenderer,
    window: vtkWebAssemblyOpenGLRenderWindow,
    canvas: HTMLCanvasElement,
  ) {
    this.canvas = canvas;
    this.vtk = session.vtk;
    this.renderer = renderer;
    this.window = window;
    this.lookupTable = this.vtk.vtkLookupTable();
    this.lookupTable.setHueRange(0.667, 0.0);
    this.lookupTable.build();
    this.scalarBar = this.vtk.vtkScalarBarActor();
    this.scalarBar.setLookupTable(this.lookupTable);
    this.scalarBar.setNumberOfLabels(5);
    // A fixed font size, as the text of the page; the default scales the text with the bar
    this.scalarBar.setUnconstrainedFontSize(true);
    // The default text is white, bold, italic and with a shadow; the background is white
    for (const text of [this.scalarBar.getTitleTextProperty(), this.scalarBar.getLabelTextProperty()]) {
      text.setColor(0.1, 0.1, 0.1);
      text.setFontFamilyToArial();
      text.setItalic(0);
      text.setShadow(0);
      text.setBold(0);
    }
    this.scalarBar.getTitleTextProperty().setBold(1);
    this.scalarBar.setVisibility(0);
    this.renderer.addViewProp(this.scalarBar);
    this.bindPinchZoom();
  }

  /**
   * Two fingers zoom the view: the interactor of VTK.wasm does nothing with
   * them. The listener is on the parent, thus the interactor does not get the move.
   */
  private bindPinchZoom(): void {
    let lastDistance: number | null = null;
    const container = this.canvas.parentElement;
    container?.addEventListener("touchstart", () => (lastDistance = null), { capture: true, passive: true });
    container?.addEventListener(
      "touchmove",
      (event) => {
        const [first, second] = Array.from(event.touches);
        if (first === undefined || second === undefined) {
          return;
        }
        event.stopPropagation();
        const distance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
        if (lastDistance !== null && lastDistance > 0 && distance > 0) {
          this.renderer.getActiveCamera().dolly(distance / lastDistance);
          this.renderer.resetCameraClippingRange();
          void this.render();
        }
        lastDistance = distance;
      },
      { capture: true, passive: true },
    );
  }

  static async create(canvas: HTMLCanvasElement): Promise<NetworkViewer> {
    const bundleUrl = await vtkBundleUrl();
    const runtime = await loadAsync({ url: bundleUrl, rendering: "webgl" });
    URL.revokeObjectURL(bundleUrl);
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

    // The x, y, z arrows turn with the camera; the user cannot move or resize them
    const axes = vtk.vtkAxesActor();
    // The default labels are white, italic and with a shadow; the background is white
    for (const caption of [axes.getXAxisCaptionActor2D(), axes.getYAxisCaptionActor2D(), axes.getZAxisCaptionActor2D()]) {
      const text = caption.getCaptionTextProperty();
      text.setColor(0.1, 0.1, 0.1);
      text.setFontFamilyToArial();
      text.setItalic(0);
      text.setShadow(0);
    }
    const axesWidget = vtk.vtkOrientationMarkerWidget();
    axesWidget.setOrientationMarker(axes);
    axesWidget.setInteractor(interactor);
    axesWidget.setViewport(...AXES_VIEWPORT);
    axesWidget.setEnabled(1);
    axesWidget.setInteractive(0);

    return new NetworkViewer(session, renderer, window, canvas);
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
   * Shows the boundary surfaces of the domain mesh, each with its color;
   * replaces the old ones. Each surface also gets its outline (the boundary
   * edges of its cells), hidden until `highlightBoundarySurface`.
   */
  async setBoundarySurfaces(surfaces: BoundarySurface[]): Promise<void> {
    for (const actor of [...this.boundarySurfaceActors.values(), ...this.boundaryOutlineActors.values()]) {
      this.renderer.removeActor(actor);
    }
    this.boundarySurfaceActors.clear();
    this.boundaryOutlineActors.clear();
    for (const { name, vtpText, color } of surfaces) {
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
      property.setColor(...colorComponents(color));
      property.setOpacity(BOUNDARY_SURFACE_OPACITY);
      this.renderer.addActor(actor);
      this.boundarySurfaceActors.set(name, actor);

      // Faces on one plane are one surface: only the outer edges, not the edges between its cells
      const outline = this.vtk.vtkFeatureEdges();
      outline.setInputConnection(0, reader.getOutputPort(0));
      outline.setBoundaryEdges(true);
      outline.setFeatureEdges(false);
      outline.setManifoldEdges(false);
      outline.setNonManifoldEdges(false);
      outline.setColoring(false);
      const outlineMapper = this.vtk.vtkPolyDataMapper();
      outlineMapper.setInputConnection(0, outline.getOutputPort(0));
      outlineMapper.setScalarVisibility(0);
      const outlineActor = this.vtk.vtkActor({ mapper: outlineMapper });
      outlineActor.getProperty().setColor(...BOUNDARY_OUTLINE_COLOR);
      outlineActor.getProperty().setLineWidth(BOUNDARY_OUTLINE_WIDTH);
      // WebGL draws lines 1 pixel wide: as tubes, the line width has an effect
      outlineActor.getProperty().setRenderLinesAsTubes(true);
      outlineActor.setVisibility(0);
      this.renderer.addActor(outlineActor);
      this.boundaryOutlineActors.set(name, outlineActor);
    }
  }

  /** A new color ("#rrggbb") of a boundary surface of the domain mesh */
  setBoundarySurfaceColor(name: string, color: string): void {
    this.boundarySurfaceActors.get(name)?.getProperty().setColor(...colorComponents(color));  }

  /** Shows the outline of one boundary surface; null hides all outlines */
  highlightBoundarySurface(name: string | null): void {
    for (const [surface, actor] of this.boundaryOutlineActors) {
      actor.setVisibility(surface === name ? 1 : 0);
    }
  }

  /**
   * Shows a fracture file (text of a .vtp file), or removes the layer (null).
   * The layer "final" is the triangle mesh, shown with its edges.
   */
  async setLayer(layer: FractureLayer, vtpText: string | null): Promise<void> {
    const old = this.layers.get(layer);
    if (old) {
      this.renderer.removeActor(old.actor);
      this.retiredObjects.push(old.actor, old.mapper, old.reader);
      this.layers.delete(layer);
    }
    if (vtpText === null) {
      // The scalar bar belongs to the triangle mesh
      if (layer === "final") {
        this.updateScalarBar();
      }
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
    } else if (layer === "user") {
      property.setColor(0.2, 0.4, 0.9);
      property.setOpacity(0.5);
      property.setEdgeVisibility(1);
      property.setEdgeColor(0.1, 0.2, 0.6);
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

  /**
   * Adds the fractures which a running generation accepted. They are not
   * read from a file: the generation writes its files only at the end.
   */
  addGenerationFractures(batch: FractureBatch): void {
    const changed = new Set<GenerationFamily>();
    const polygonIds = this.vtk.vtkIdList();
    let pointIndex = 0;
    batch.vertexCounts.forEach((vertexCount, fractureIndex) => {
      const family = this.generationFamily(batch.families[fractureIndex]);
      polygonIds.reset();
      for (let vertex = 0; vertex < vertexCount; vertex++) {
        const start = 3 * (pointIndex + vertex);
        polygonIds.insertNextId(
          family.points.insertNextPoint([batch.points[start], batch.points[start + 1], batch.points[start + 2]]),
        );
      }
      family.polygons.insertNextCell(polygonIds);
      pointIndex += vertexCount;
      changed.add(family);
    });
    for (const family of changed) {
      family.points.modified();
      family.polygons.modified();
      family.polyData.modified();
    }
  }

  /** Removes the fractures of a running generation */
  clearGenerationFractures(): void {
    for (const family of this.generationFamilies.values()) {
      this.renderer.removeActor(family.actor);
    }
    this.generationFamilies.clear();
  }

  /** The fractures of a family of a running generation; a new family gets its actor */
  private generationFamily(familyNumber: number): GenerationFamily {
    const existing = this.generationFamilies.get(familyNumber);
    if (existing) {
      return existing;
    }
    const points = this.vtk.vtkPoints();
    const polygons = this.vtk.vtkCellArray();
    const polyData = this.vtk.vtkPolyData();
    polyData.setPoints(points);
    polyData.setPolys(polygons);
    const mapper = this.vtk.vtkPolyDataMapper();
    mapper.setInputData(polyData);
    mapper.setScalarVisibility(0);
    const actor = this.vtk.vtkActor({ mapper });
    const property = actor.getProperty();
    property.setRepresentationToSurface();
    property.setColor(...FAMILY_COLORS[(familyNumber - 1) % FAMILY_COLORS.length]);
    property.setEdgeVisibility(1);
    property.setEdgeColor(0.2, 0.2, 0.2);
    this.renderer.addActor(actor);
    const family = { points, polygons, polyData, actor };
    this.generationFamilies.set(familyNumber, family);
    return family;
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

  /** The scalar bar of the color array; the arrays of `SCALAR_BARS` have their title and label format */
  private updateScalarBar(): void {
    // The canvas can have more pixels than CSS pixels (a high-resolution screen)
    const pixelRatio = this.canvas.clientWidth > 0 ? this.canvas.width / this.canvas.clientWidth : 1;
    this.scalarBar.getTitleTextProperty().setFontSize(Math.round(SCALAR_BAR_FONT_SIZE * pixelRatio));
    this.scalarBar.getLabelTextProperty().setFontSize(Math.round(SCALAR_BAR_FONT_SIZE * pixelRatio));
    this.scalarBar.setMaximumWidthInPixels(Math.round(SCALAR_BAR_WIDTH * pixelRatio));
    this.scalarBar.setVerticalTitleSeparation(Math.round(SCALAR_BAR_TITLE_SPACE * pixelRatio));
    // The default place, but a narrow view (a phone) keeps the room of the title
    const left = this.canvas.clientWidth > 0 ? 1 - SCALAR_BAR_MINIMUM_ROOM / this.canvas.clientWidth : DEFAULT_SCALAR_BAR_LEFT;
    this.scalarBar.setPosition([Math.min(DEFAULT_SCALAR_BAR_LEFT, left), DEFAULT_SCALAR_BAR_BOTTOM]);
    const isColored = this.colorArray !== null && this.layers.has("final");
    const style = this.colorArray === null ? undefined : SCALAR_BARS.get(this.colorArray.name);
    this.scalarBar.setTitle(style?.title ?? this.colorArray?.name ?? "");
    this.scalarBar.setLabelFormat(style?.labelFormat ?? DEFAULT_LABEL_FORMAT);
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
      throw new Error(`the fracture mesh has no ${association} array ${name}`);
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
    this.retiredObjects.push(...this.trajectoryObjects);
    this.trajectoryObjects = [];
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
    this.trajectoryObjects = [...this.trajectoryActors, tubeMapper, coneMapper, tubes, cones, cone, points, reader];
  }

  setVisible(layer: FractureLayer | "domain" | "trajectories", isVisible: boolean): void {
    const visibility = isVisible ? 1 : 0;
    if (layer === "trajectories") {
      for (const actor of this.trajectoryActors) {
        actor.setVisibility(visibility);
      }
      return;
    }
    if (layer === "domain") {
      for (const actor of this.boundarySurfaceActors.values()) {
        actor.setVisibility(visibility);
      }
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
    // The view angle is vertical: a tall view (a phone) must move back to show the width
    const aspectRatio = this.canvas.clientHeight > 0 ? this.canvas.clientWidth / this.canvas.clientHeight : 1;
    if (aspectRatio < 1) {
      camera.dolly(aspectRatio);
      this.renderer.resetCameraClippingRange();
    }
  }

  async render(): Promise<void> {
    await this.window.render();
    for (const object of this.retiredObjects) {
      object.$delete();
    }
    this.retiredObjects = [];
  }
}
