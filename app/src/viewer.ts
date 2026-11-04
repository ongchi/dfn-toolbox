// 3D view of the network with three.js.
//
// Each shape has positions relative to its own center, and the center as the
// position of its object: large coordinates keep their precision. The view
// draws on request (`render`), and when the user moves the camera.

import {
  AmbientLight,
  ArrowHelper,
  Box3,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ColorManagement,
  ConeGeometry,
  DirectionalLight,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InstancedMesh,
  InterleavedBufferAttribute,
  LinearSRGBColorSpace,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  MOUSE,
  type Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Scene,
  ShaderMaterial,
  Sphere,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import { FlowParticles, type FlowField } from "./flowParticles";
import type { FractureBatch, ShapeArrays } from "./generationClient";
import {
  boundsDiagonal,
  cellEdges,
  cellTriangles,
  colorFraction,
  colorRange,
  localPositions,
  pathTubes,
  scalarBarTicks,
  scalarBarTitle,
  smallestPositiveValue,
  tableColor,
  type CellShapes,
  type CellTriangles,
  type ScalarBarTick,
} from "./viewerGeometry";

// The vertical angle of the view (degrees), and the direction from the center to the camera at the start
const VIEW_ANGLE = 30;
const START_DIRECTION = new Vector3(1, -1.6, 1.1).normalize();
// A light at the camera, and a light from all sides: with both at one full strength, a surface
// which faces the camera has its own color. In three.js a Lambert surface divides the light by π.
const CAMERA_LIGHT = 0.45 * Math.PI;
const AMBIENT_LIGHT = 0.55 * Math.PI;
// Near and far planes around the shapes, as parts of their radius
const DEPTH_MARGIN = 1.2;
const MINIMUM_NEAR_PART = 0.001;
// Panels which leave less than this part of the width or height: the model has the center of all of the view
const MINIMUM_FREE_PART = 0.25;

const SCALAR_BAR_TICK_COUNT = 5;
const SCALAR_BAR_RAMP_STOPS = 33;
const FRACTURE_COLOR = [0.95, 0.75, 0.3] as const;
// The final fractures: translucent, thus the particles on all fractures are visible
const FRACTURE_OPACITY = 0.9;
const FRACTURE_EDGE_OPACITY = 0.6;
const EDGE_COLOR = [0.2, 0.2, 0.2] as const;
// Light lines on the dark background of the view
const BACKGROUND_COLOR = 0x15181d;
const DOMAIN_COLOR = [0.6, 0.62, 0.66] as const;
const REMOVED_COLOR = [0.6, 0.6, 0.6] as const;
const REMOVED_OPACITY = 0.4;
const REJECTED_COLOR = [0.85, 0.2, 0.2] as const;
const REJECTED_OPACITY = 0.25;
const USER_COLOR = [0.2, 0.4, 0.9] as const;
const USER_EDGE_COLOR = [0.45, 0.6, 1.0] as const;
const USER_OPACITY = 0.5;

// The trajectories: tube radius relative to the diagonal of their bounds,
// cone height relative to the tube radius, and the number of cones (for
// each path, and at most). Magenta is not a color of the color table.
const TUBE_RADIUS_FRACTION = 0.003;
const TUBE_SIDES = 8;
const CONE_HEIGHT_FACTOR = 4;
const CONE_SIDES = 12;
const CONES_PER_PATH = 20;
const MAX_CONE_COUNT = 500;
const TRAJECTORY_COLOR = [0.85, 0.1, 0.85] as const;
// The boundary surfaces of the domain do not hide the fractures behind them: three.js sorts them, thus
// all surfaces in front of a fracture add their colors
const BOUNDARY_SURFACE_OPACITY = 0.25;
/** Light gray: one color for all boundary surfaces */
const BOUNDARY_SURFACE_COLOR = [0.75, 0.77, 0.8] as const;
/** The highlighted boundary surface: the accent orange of the panels (`--accent` of `style.css`), more opaque */
const HIGHLIGHT_COLOR = [1.0, 0.54, 0.36] as const;
const HIGHLIGHT_OPACITY = 0.6;
// The x, y, z axes in the top-left corner of the free part of the view: their part of the shorter side of the view, and their scene
const AXES_VIEW_PART = 0.2;
const AXES_CAMERA_DISTANCE = 3;
const AXES_LABEL_SIZE = 0.3;
const AXES_LABEL_PIXELS = 64;
const AXES: readonly { label: string; direction: Vector3; color: number }[] = [
  { label: "X", direction: new Vector3(1, 0, 0), color: 0xd62020 },
  { label: "Y", direction: new Vector3(0, 1, 0), color: 0xd0b000 },
  { label: "Z", direction: new Vector3(0, 0, 1), color: 0x20a020 },
];
// The moving particles of the flow: their number, and the longest time (seconds) of one
// step, thus a slow frame or a hidden page does not make a jump. White: the colors of the data stay visible.
const PARTICLE_COUNT = 1500;
const MAX_PARTICLE_STEP = 0.05;
const PARTICLE_COLOR = [1, 1, 1] as const;
/** CSS pixels */
const PARTICLE_WIDTH = 1;
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

/** The shapes of a layer; the triangle mesh can also have the arrays of the flow and the transport */
export interface LayerShapes extends ShapeArrays {
  pointArrays: [string, Float64Array][];
}

/** The pressure of the flow */
export const PRESSURE_ARRAY: ColorArray = { name: "pressure", association: "point" };
/** The magnitude of the Darcy velocity of each triangle of the flow */
export const FLOW_VELOCITY_ARRAY: ColorArray = { name: "flow_velocity", association: "cell" };
/** The mean speed of the particle tracking at each point */
export const TRANSPORT_VELOCITY_ARRAY: ColorArray = { name: "transport_velocity", association: "point" };

/** The name and the unit in the scalar bar of the arrays which the app adds; other arrays: their name, no unit */
const SCALAR_BARS = new Map<string, { name: string; unit: string }>([
  [PRESSURE_ARRAY.name, { name: "pressure", unit: "MPa" }],
  [FLOW_VELOCITY_ARRAY.name, { name: "flow velocity", unit: "m/s" }],
  [TRANSPORT_VELOCITY_ARRAY.name, { name: "transport velocity", unit: "m/s" }],
]);

/** A boundary surface of the domain mesh: its polygons */
export interface BoundarySurface {
  name: string;
  cells: CellShapes;
}

/** The edges of the cells of the domain mesh */
export interface DomainWireframe {
  points: ArrayLike<number>;
  /** Pairs of point numbers */
  edges: Uint32Array;
}

/** The paths of the particles */
export interface Trajectories {
  /** x, y, z of each point of all paths */
  points: Float64Array;
  /** x, y, z of the velocity at each point of all paths */
  velocities: Float64Array;
  /** Number of points of each path */
  pointCounts: Uint32Array;
}

function freeObject(root: Object3D): void {
  root.traverse((object) => {
    const { geometry, material } = object as Partial<Mesh>;
    geometry?.dispose();
    for (const item of Array.isArray(material) ? material : material ? [material] : []) {
      item.dispose();
    }
    (object as Partial<InstancedMesh>).dispose?.();
  });
}

/** A geometry with positions relative to `origin`, the position of its object */
interface LocalGeometry {
  geometry: BufferGeometry;
  origin: [number, number, number];
}

/** The triangles as separate points: a cell color, and a flat normal, for each triangle */
function triangleGeometry(points: ArrayLike<number>, triangles: CellTriangles): LocalGeometry {
  const { origin, positions } = localPositions(points);
  const corners = new Float32Array(3 * triangles.corners.length);
  triangles.corners.forEach((point, corner) => {
    corners.set(positions.subarray(3 * point, 3 * point + 3), 3 * corner);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(corners, 3));
  geometry.computeVertexNormals();
  return { geometry, origin };
}

function edgeGeometry(points: ArrayLike<number>, edges: Uint32Array): LocalGeometry {
  const { origin, positions } = localPositions(points);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(edges, 1));
  return { geometry, origin };
}

function surfaceMaterial(color: readonly [number, number, number], opacity = 1): MeshLambertMaterial {
  return new MeshLambertMaterial({
    color: new Color(...color),
    side: DoubleSide,
    opacity,
    transparent: opacity < 1,
    depthWrite: opacity === 1,
    // The edges are drawn in front of their surfaces
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

function lineMaterial(color: readonly [number, number, number], opacity = 1): LineBasicMaterial {
  return new LineBasicMaterial({ color: new Color(...color), opacity, transparent: opacity < 1 });
}

function placed<T extends Object3D>(object: T, origin: [number, number, number]): T {
  object.position.set(...origin);
  return object;
}

/** One attribute of a growing geometry: a new size doubles the buffer */
class GrowingAttribute {
  private values = new Float32Array(3 * 1024);
  private attribute: BufferAttribute;
  count = 0;

  constructor(
    private readonly geometry: BufferGeometry,
    private readonly name: string,
  ) {
    this.attribute = this.newAttribute();
  }

  private newAttribute(): BufferAttribute {
    const attribute = new BufferAttribute(this.values, 3).setUsage(DynamicDrawUsage);
    this.geometry.setAttribute(this.name, attribute);
    return attribute;
  }

  append(vectors: readonly number[]): void {
    const needed = this.count + vectors.length;
    if (needed > this.values.length) {
      const grown = new Float32Array(Math.max(needed, 2 * this.values.length));
      grown.set(this.values.subarray(0, this.count));
      this.values = grown;
      // A new buffer: the old one on the graphics card must go
      this.geometry.dispose();
      this.attribute = this.newAttribute();
    }
    this.values.set(vectors, this.count);
    this.count = needed;
    this.attribute.needsUpdate = true;
  }
}

/** The fractures of one family of a running generation; each batch adds to them */
class GenerationFamily {
  readonly group = new Group();
  private readonly surface = new BufferGeometry();
  private readonly lines = new BufferGeometry();
  private readonly surfacePositions = new GrowingAttribute(this.surface, "position");
  private readonly surfaceNormals = new GrowingAttribute(this.surface, "normal");
  private readonly linePositions = new GrowingAttribute(this.lines, "position");

  constructor(
    color: readonly [number, number, number],
    private readonly origin: [number, number, number],
  ) {
    this.group.add(
      placed(new Mesh(this.surface, surfaceMaterial(color)), origin),
      placed(new LineSegments(this.lines, lineMaterial(EDGE_COLOR)), origin),
    );
  }

  /** `polygon`: x, y, z of each vertex */
  add(polygon: Float64Array): void {
    const vertexCount = polygon.length / 3;
    const cell = { points: polygon, vertexCounts: [vertexCount], connectivity: Array.from({ length: vertexCount }, (_, index) => index) };
    const local = (vertex: number, axis: number) => polygon[3 * vertex + axis] - this.origin[axis];
    const vector = (vertex: number) => [0, 1, 2].map((axis) => local(vertex, axis));
    const edgeA = new Vector3(...vector(1)).sub(new Vector3(...vector(0)));
    const edgeB = new Vector3(...vector(vertexCount - 1)).sub(new Vector3(...vector(0)));
    const normal = edgeA.cross(edgeB).normalize().toArray();
    const corners = [...cellTriangles(cell).corners];
    this.surfacePositions.append(corners.flatMap(vector));
    this.surfaceNormals.append(corners.flatMap(() => normal));
    this.linePositions.append(cell.connectivity.flatMap((vertex) => [...vector(vertex), ...vector((vertex + 1) % vertexCount)]));
  }

  /** Call after `add`, once for each batch */
  update(): void {
    this.surface.setDrawRange(0, this.surfacePositions.count / 3);
    this.lines.setDrawRange(0, this.linePositions.count / 3);
    this.surface.computeBoundingBox();
    this.surface.computeBoundingSphere();
    this.lines.computeBoundingSphere();
  }
}

interface ShapeLayer {
  group: Group;
  mesh: Mesh<BufferGeometry, MeshLambertMaterial>;
  shapes: LayerShapes;
  triangles: CellTriangles;
}

/** The scalar bar: an overlay on the view, with the text of the page */
class ScalarBar {
  private readonly root = document.createElement("div");
  private readonly title = document.createElement("div");
  private readonly marks = document.createElement("div");
  private readonly labels = document.createElement("div");

  constructor(parent: HTMLElement) {
    this.root.className = "scalar-bar";
    this.root.dataset.testid = "scalar-bar";
    this.root.hidden = true;
    this.title.className = "scalar-bar-title";
    const body = document.createElement("div");
    body.className = "scalar-bar-body";
    const ramp = document.createElement("div");
    ramp.className = "scalar-bar-ramp";
    const stops = Array.from({ length: SCALAR_BAR_RAMP_STOPS }, (_, index) => {
      const [red, green, blue] = tableColor(index / (SCALAR_BAR_RAMP_STOPS - 1));
      return `rgb(${[red, green, blue].map((component) => Math.round(255 * component)).join(" ")})`;
    });
    ramp.style.background = `linear-gradient(to right, ${stops.join(", ")})`;
    this.marks.className = "scalar-bar-marks";
    this.labels.className = "scalar-bar-labels";
    body.append(ramp, this.marks, this.labels);
    this.root.append(this.title, body);
    parent.append(this.root);
  }

  /**
   * Each tick has a mark under the ramp at its place; its label moves from
   * centered by its fraction, thus the labels at the ends stay in the bar
   */
  show(title: string, ticks: ScalarBarTick[]): void {
    this.title.textContent = title;
    this.marks.replaceChildren(
      ...ticks.map(({ fraction }) => {
        const mark = document.createElement("span");
        mark.style.left = `${100 * fraction}%`;
        return mark;
      }),
    );
    this.labels.replaceChildren(
      ...ticks.map(({ fraction, text }) => {
        const label = document.createElement("span");
        label.textContent = text;
        label.style.left = `${100 * fraction}%`;
        label.style.transform = `translateX(${-100 * fraction}%)`;
        return label;
      }),
    );
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }
}

/** A quad for each segment of a trail: WebGL lines have 1 pixel, and these have `PARTICLE_WIDTH` */
const PARTICLE_VERTEX_SHADER = `
  attribute vec3 segmentStart;
  attribute vec3 segmentEnd;
  attribute float opacityStart;
  attribute float opacityEnd;
  uniform vec2 resolution;
  uniform float width;
  varying float vOpacity;
  void main() {
    vec4 start = projectionMatrix * modelViewMatrix * vec4(segmentStart, 1.0);
    vec4 end = projectionMatrix * modelViewMatrix * vec4(segmentEnd, 1.0);
    if (start.w <= 0.0 || end.w <= 0.0) {
      // Behind the camera: outside the view
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vec2 direction = (end.xy / end.w - start.xy / start.w) * resolution;
    direction = dot(direction, direction) > 0.0 ? normalize(direction) : vec2(1.0, 0.0);
    // position.x: 0 at the start, 1 at the end; position.y: the side of the line
    vOpacity = mix(opacityStart, opacityEnd, position.x);
    vec4 point = mix(start, end, position.x);
    // The trail gets narrow to its old end
    point.xy += vec2(-direction.y, direction.x) * position.y * width * (0.4 + 0.6 * vOpacity) / resolution * point.w;
    gl_Position = point;
  }`;

const PARTICLE_FRAGMENT_SHADER = `
  uniform vec3 color;
  varying float vOpacity;
  void main() {
    gl_FragColor = vec4(color, vOpacity);
  }`;

/** The moving particles of the flow, as trails which fade to their old end */
class ParticleLines {
  readonly object: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  /** The bounds of the mesh points, in world coordinates: the geometry is only one quad */
  readonly bounds: Box3;
  private readonly positions: Float32Array;
  private readonly opacities: Float32Array;
  private readonly positionBuffer: InstancedInterleavedBuffer;
  private readonly opacityBuffer: InstancedInterleavedBuffer;
  private readonly origin: [number, number, number];

  constructor(private readonly particles: FlowParticles, points: ArrayLike<number>) {
    this.origin = localPositions(points).origin;
    this.bounds = new Box3().setFromArray(points);
    const segmentCount = particles.segmentCount;
    this.positions = new Float32Array(6 * segmentCount);
    this.opacities = new Float32Array(2 * segmentCount);
    this.positionBuffer = new InstancedInterleavedBuffer(this.positions, 6).setUsage(DynamicDrawUsage);
    this.opacityBuffer = new InstancedInterleavedBuffer(this.opacities, 2).setUsage(DynamicDrawUsage);
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(Float32Array.of(0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0), 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute("segmentStart", new InterleavedBufferAttribute(this.positionBuffer, 3, 0));
    geometry.setAttribute("segmentEnd", new InterleavedBufferAttribute(this.positionBuffer, 3, 3));
    geometry.setAttribute("opacityStart", new InterleavedBufferAttribute(this.opacityBuffer, 1, 0));
    geometry.setAttribute("opacityEnd", new InterleavedBufferAttribute(this.opacityBuffer, 1, 1));
    geometry.instanceCount = segmentCount;
    this.object = placed(
      new Mesh(
        geometry,
        new ShaderMaterial({
          transparent: true,
          depthWrite: false,
          side: DoubleSide,
          uniforms: {
            color: { value: new Color(...PARTICLE_COLOR) },
            resolution: { value: new Vector2(1, 1) },
            width: { value: PARTICLE_WIDTH },
          },
          vertexShader: PARTICLE_VERTEX_SHADER,
          fragmentShader: PARTICLE_FRAGMENT_SHADER,
        }),
      ),
      this.origin,
    );
    // The particles are in the mesh, and on top of the translucent shapes
    this.object.frustumCulled = false;
    this.object.renderOrder = 1;
    this.advance(0);
  }

  /** The size of the view in CSS pixels */
  setResolution(width: number, height: number): void {
    (this.object.material.uniforms.resolution.value as Vector2).set(width, height);
  }

  advance(seconds: number): void {
    this.particles.advance(seconds);
    this.particles.writeTrails(this.origin, this.positions, this.opacities);
    this.positionBuffer.needsUpdate = true;
    this.opacityBuffer.needsUpdate = true;
  }
}

/** The x, y, z arrows in a small scene: they turn with the camera */
function axesScene(): Scene {
  const scene = new Scene();
  for (const { label, direction, color } of AXES) {
    scene.add(new ArrowHelper(direction, new Vector3(), 1, color, 0.25, 0.12));
    const canvas = document.createElement("canvas");
    canvas.width = AXES_LABEL_PIXELS;
    canvas.height = AXES_LABEL_PIXELS;
    const context = canvas.getContext("2d");
    if (context) {
      context.font = `${AXES_LABEL_PIXELS * 0.7}px Arial`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillStyle = "#e6e6e6";
      context.fillText(label, AXES_LABEL_PIXELS / 2, AXES_LABEL_PIXELS / 2);
    }
    const sprite = new Sprite(new SpriteMaterial({ map: new CanvasTexture(canvas) }));
    sprite.position.copy(direction).multiplyScalar(1.2);
    sprite.scale.setScalar(AXES_LABEL_SIZE);
    scene.add(sprite);
  }
  return scene;
}

/** The pixels at the sides of the view which panels cover */
export interface CoveredArea {
  left: number;
  top: number;
  bottom: number;
}

export class NetworkViewer {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(VIEW_ANGLE);
  private readonly controls: TrackballControls;
  private readonly axes = axesScene();
  private readonly axesCamera = new OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 2 * AXES_CAMERA_DISTANCE);
  private readonly scalarBar: ScalarBar;
  private readonly layers = new Map<FractureLayer, ShapeLayer>();
  /** The fractures of a running generation, by family number */
  private readonly generationFamilies = new Map<number, GenerationFamily>();
  private domain: LineSegments | null = null;
  /** The boundary surfaces of the domain mesh, by name; part of the layer "domain" */
  private readonly boundarySurfaces = new Map<string, Mesh<BufferGeometry, MeshLambertMaterial>>();
  /** Tubes and cones */
  private trajectories: Group | null = null;
  private particleLines: ParticleLines | null = null;
  private lastFrameTime: number | null = null;
  private colorArray: ColorArray | null = null;
  private isLogScale = false;
  private isScalarBarShown = true;
  /** The camera moved: the next animation frame draws */
  private isDrawPending = false;
  private coveredArea: CoveredArea = { left: 0, top: 0, bottom: 0 };
  private readonly canvas: HTMLCanvasElement;

  private constructor(canvas: HTMLCanvasElement, renderer: WebGLRenderer, parent: HTMLElement) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.scalarBar = new ScalarBar(parent);

    const light = new DirectionalLight(0xffffff, CAMERA_LIGHT);
    this.camera.add(light, light.target);
    light.target.position.set(0, 0, -1);
    this.scene.add(this.camera, new AmbientLight(0xffffff, AMBIENT_LIGHT));

    this.controls = new TrackballControls(this.camera, canvas);
    this.controls.staticMoving = true;
    this.controls.rotateSpeed = 3;
    this.controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.DOLLY };
    this.controls.addEventListener("change", () => (this.isDrawPending = true));

    new ResizeObserver(() => this.resize()).observe(parent);
    this.resize();
    this.renderer.setAnimationLoop((time) => this.animate(time));
  }

  static create(canvas: HTMLCanvasElement): NetworkViewer {
    const parent = canvas.parentElement;
    if (parent === null) {
      throw new Error("the canvas has no parent");
    }
    // The colors of the app are the colors on the screen, with no conversion
    ColorManagement.enabled = false;
    const renderer = new WebGLRenderer({ canvas, antialias: true });
    renderer.outputColorSpace = LinearSRGBColorSpace;
    renderer.setClearColor(BACKGROUND_COLOR);
    renderer.autoClear = false;
    return new NetworkViewer(canvas, renderer, parent);
  }

  private resize(): void {
    const { clientWidth: width, clientHeight: height } = this.canvas;
    if (width === 0 || height === 0) {
      return;
    }
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.controls.handleResize();
    this.particleLines?.setResolution(width, height);
    this.render();
  }

  /** The animation runs only for visible particles: other views draw on request */
  private animate(time: number): void {
    this.controls.update();
    const lastTime = this.lastFrameTime;
    this.lastFrameTime = time;
    if (this.particleLines?.object.visible && lastTime !== null) {
      this.particleLines.advance(Math.min(MAX_PARTICLE_STEP, (time - lastTime) / 1000));
      this.isDrawPending = true;
    }
    if (this.isDrawPending) {
      this.render();
    }
  }

  /** Shows moving particles in the flow; null removes them */
  setFlowParticles(field: FlowField | null): void {
    if (this.particleLines) {
      this.removeObject(this.particleLines.object);
      this.particleLines = null;
    }
    if (field === null) {
      return;
    }
    const particles = new FlowParticles(field, PARTICLE_COUNT, Math.random);
    if (particles.particleCount > 0) {
      this.particleLines = new ParticleLines(particles, field.points);
      this.particleLines.setResolution(this.canvas.clientWidth, this.canvas.clientHeight);
      this.scene.add(this.particleLines.object);
    }
  }

  /** Shows the edges of the cells of the domain mesh. */
  setDomainMesh(wireframe: DomainWireframe): void {
    this.removeObject(this.domain);
    const { geometry, origin } = edgeGeometry(wireframe.points, wireframe.edges);
    this.domain = placed(new LineSegments(geometry, lineMaterial(DOMAIN_COLOR)), origin);
    this.scene.add(this.domain);
  }

  private removeObject(object: Object3D | null): void {
    if (object !== null) {
      this.scene.remove(object);
      freeObject(object);
    }
  }

  /** Shows the boundary surfaces of the domain mesh in one color; replaces the old ones */
  setBoundarySurfaces(surfaces: BoundarySurface[]): void {
    for (const object of this.boundarySurfaces.values()) {
      this.removeObject(object);
    }
    this.boundarySurfaces.clear();
    for (const { name, cells } of surfaces) {
      const { geometry, origin } = triangleGeometry(cells.points, cellTriangles(cells));
      const mesh = placed(new Mesh(geometry, surfaceMaterial(BOUNDARY_SURFACE_COLOR, BOUNDARY_SURFACE_OPACITY)), origin);
      this.scene.add(mesh);
      this.boundarySurfaces.set(name, mesh);
    }
  }

  /** Fills one boundary surface with the highlight color; null = no surface */
  highlightBoundarySurface(name: string | null): void {
    for (const [surface, mesh] of this.boundarySurfaces) {
      const isHighlighted = surface === name;
      const [red, green, blue] = isHighlighted ? HIGHLIGHT_COLOR : BOUNDARY_SURFACE_COLOR;
      mesh.material.color.setRGB(red, green, blue);
      mesh.material.opacity = isHighlighted ? HIGHLIGHT_OPACITY : BOUNDARY_SURFACE_OPACITY;
    }
  }

  /**
   * Shows the shapes of a layer, or removes the layer (null). The layers
   * "final" and "user" show their edges.
   */
  setLayer(layer: FractureLayer, shapes: LayerShapes | null): void {
    const old = this.layers.get(layer);
    if (old) {
      this.removeObject(old.group);
      this.layers.delete(layer);
    }
    if (shapes === null) {
      // The scalar bar belongs to the triangle mesh
      if (layer === "final") {
        this.updateScalarBar();
      }
      return;
    }
    const group = new Group();
    const triangles = cellTriangles(shapes);
    const { geometry, origin } = triangleGeometry(shapes.points, triangles);
    const mesh = placed(new Mesh(geometry, NetworkViewer.layerMaterial(layer)), origin);
    group.add(mesh);
    if (layer === "final" || layer === "user") {
      const edges = edgeGeometry(shapes.points, cellEdges(shapes, shapes.points.length / 3));
      const lines = new LineSegments(
        edges.geometry,
        layer === "user" ? lineMaterial(USER_EDGE_COLOR) : lineMaterial(EDGE_COLOR, FRACTURE_EDGE_OPACITY),
      );
      group.add(placed(lines, edges.origin));
    }
    this.scene.add(group);
    this.layers.set(layer, { group, mesh, shapes, triangles });
    if (layer === "final") {
      this.colorBy(this.colorArray);
    }
  }

  private static layerMaterial(layer: FractureLayer): MeshLambertMaterial {
    switch (layer) {
      case "removed":
        return surfaceMaterial(REMOVED_COLOR, REMOVED_OPACITY);
      case "rejected":
        return surfaceMaterial(REJECTED_COLOR, REJECTED_OPACITY);
      case "user":
        return surfaceMaterial(USER_COLOR, USER_OPACITY);
      case "final":
        return surfaceMaterial(FRACTURE_COLOR, FRACTURE_OPACITY);
    }
  }

  /** Adds the fractures which a running generation accepted */
  addGenerationFractures(batch: FractureBatch): void {
    const changed = new Set<GenerationFamily>();
    let pointIndex = 0;
    batch.vertexCounts.forEach((vertexCount, fractureIndex) => {
      const polygon = batch.points.subarray(3 * pointIndex, 3 * (pointIndex + vertexCount));
      const family = this.generationFamily(batch.families[fractureIndex], polygon);
      family.add(polygon);
      pointIndex += vertexCount;
      changed.add(family);
    });
    for (const family of changed) {
      family.update();
    }
  }

  /** Removes the fractures of a running generation */
  clearGenerationFractures(): void {
    for (const family of this.generationFamilies.values()) {
      this.removeObject(family.group);
    }
    this.generationFamilies.clear();
  }

  /** The fractures of a family of a running generation; a new family has its origin at its first fracture */
  private generationFamily(familyNumber: number, polygon: Float64Array): GenerationFamily {
    const existing = this.generationFamilies.get(familyNumber);
    if (existing) {
      return existing;
    }
    const color = FAMILY_COLORS[(familyNumber - 1) % FAMILY_COLORS.length];
    const family = new GenerationFamily(color, [polygon[0], polygon[1], polygon[2]]);
    this.scene.add(family.group);
    this.generationFamilies.set(familyNumber, family);
    return family;
  }

  /** Names of the cell arrays of the shapes of the final fractures, without the arrays which the app adds. */
  cellArrayNames(): string[] {
    return this.layers.get("final")?.shapes.cellArrays.map(([name]) => name) ?? [];
  }

  /** The user's choice; a view with one color has no scalar bar in any case */
  setScalarBarShown(isShown: boolean): void {
    this.isScalarBarShown = isShown;
    this.updateScalarBar();
  }

  private colorValues(colorArray: ColorArray): Float64Array {
    const shapes = this.layers.get("final")?.shapes;
    const arrays = colorArray.association === "cell" ? shapes?.cellArrays : shapes?.pointArrays;
    const values = arrays?.find(([name]) => name === colorArray.name)?.[1];
    if (values === undefined) {
      throw new Error(`the fracture mesh has no ${colorArray.association} array ${colorArray.name}`);
    }
    return values;
  }

  /** The scalar bar of the color array; the arrays of `SCALAR_BARS` have their name and unit */
  private updateScalarBar(): void {
    if (this.colorArray === null || !this.layers.has("final") || !this.isScalarBarShown) {
      this.scalarBar.hide();
      return;
    }
    const style = SCALAR_BARS.get(this.colorArray.name);
    const { factorExponent, ticks } = scalarBarTicks(
      colorRange(this.colorValues(this.colorArray), this.isLogScale),
      SCALAR_BAR_TICK_COUNT,
    );
    this.scalarBar.show(scalarBarTitle(style?.name ?? this.colorArray.name, style?.unit ?? null, factorExponent), ticks);
  }

  /** The next `colorBy` uses a log scale of the values */
  setLogScale(isLogScale: boolean): void {
    this.isLogScale = isLogScale;
  }

  /** True if the color array has a positive value: a log scale needs one */
  canUseLogScale(): boolean {
    return (
      this.colorArray !== null &&
      this.layers.has("final") &&
      smallestPositiveValue(this.colorValues(this.colorArray)) !== null
    );
  }

  /** Colors the triangle mesh of the final fractures by a data array, or with one color (null). */
  colorBy(colorArray: ColorArray | null): void {
    this.colorArray = colorArray;
    const final = this.layers.get("final");
    if (!final) {
      this.updateScalarBar();
      return;
    }
    const { mesh, triangles } = final;
    if (colorArray === null) {
      mesh.geometry.deleteAttribute("color");
      mesh.material.vertexColors = false;
    } else {
      const values = this.colorValues(colorArray);
      const range = colorRange(values, this.isLogScale);
      const colors = new Float32Array(3 * triangles.corners.length);
      triangles.corners.forEach((point, corner) => {
        const value = colorArray.association === "cell" ? values[triangles.cells[Math.floor(corner / 3)]] : values[point];
        colors.set(tableColor(colorFraction(value, range)), 3 * corner);
      });
      mesh.geometry.setAttribute("color", new BufferAttribute(colors, 3));
      mesh.material.vertexColors = true;
    }
    mesh.material.needsUpdate = true;
    this.updateScalarBar();
  }

  /** Shows the paths of the particles as tubes, with cones in the direction of the velocity; or removes them (null). */
  setTrajectories(paths: Trajectories | null): void {
    this.removeObject(this.trajectories);
    this.trajectories = null;
    if (paths === null) {
      return;
    }
    const tubeRadius = TUBE_RADIUS_FRACTION * boundsDiagonal(paths.points);
    const { origin, positions } = localPositions(paths.points);
    const tube = pathTubes(positions, paths.pointCounts, tubeRadius, TUBE_SIDES);
    const tubeGeometry = new BufferGeometry();
    tubeGeometry.setAttribute("position", new BufferAttribute(tube.positions, 3));
    tubeGeometry.setAttribute("normal", new BufferAttribute(tube.normals, 3));
    tubeGeometry.setIndex(new BufferAttribute(tube.indices, 1));
    const group = new Group();
    group.add(placed(new Mesh(tubeGeometry, surfaceMaterial(TRAJECTORY_COLOR)), origin));
    group.add(placed(NetworkViewer.pathCones(paths, positions, tubeRadius), origin));
    this.scene.add(group);
    this.trajectories = group;
  }

  /**
   * Cones at every n-th point (thus not at equal distances); the speeds differ
   * by orders of magnitude, thus all cones have one size.
   */
  private static pathCones(paths: Trajectories, positions: Float32Array, tubeRadius: number): InstancedMesh {
    const pointCount = positions.length / 3;
    const coneCount = Math.min(MAX_CONE_COUNT, CONES_PER_PATH * paths.pointCounts.length);
    const step = Math.max(1, Math.floor(pointCount / Math.max(1, coneCount)));
    const size = CONE_HEIGHT_FACTOR * tubeRadius;
    const coneGeometry = new ConeGeometry(0.5, 1, CONE_SIDES);
    const cones = new InstancedMesh(coneGeometry, surfaceMaterial(TRAJECTORY_COLOR), Math.ceil(pointCount / step));
    const up = new Vector3(0, 1, 0);
    const matrix = new Matrix4();
    for (let point = 0; point < pointCount; point += step) {
      const position = new Vector3().fromArray(positions, 3 * point);
      const direction = new Vector3().fromArray(paths.velocities, 3 * point).normalize();
      const rotation = new Quaternion().setFromUnitVectors(up, direction.lengthSq() > 0 ? direction : up);
      cones.setMatrixAt(point / step, matrix.compose(position, rotation, new Vector3().setScalar(size)));
    }
    return cones;
  }

  setVisible(layer: FractureLayer | "domain" | "trajectories" | "particles", isVisible: boolean): void {
    if (layer === "particles") {
      if (this.particleLines) {
        this.particleLines.object.visible = isVisible;
      }
      return;
    }
    if (layer === "trajectories") {
      if (this.trajectories) {
        this.trajectories.visible = isVisible;
      }
      return;
    }
    if (layer === "domain") {
      for (const mesh of this.boundarySurfaces.values()) {
        mesh.visible = isVisible;
      }
      if (this.domain) {
        this.domain.visible = isVisible;
      }
      return;
    }
    const shapes = this.layers.get(layer);
    if (shapes) {
      shapes.group.visible = isVisible;
    }
  }

  /** The bounds of the visible shapes, in world coordinates */
  private visibleBounds(): Box3 {
    const bounds = new Box3();
    this.scene.updateMatrixWorld();
    this.scene.traverseVisible((object) => {
      if (object === this.particleLines?.object) {
        bounds.union(this.particleLines.bounds);
        return;
      }
      const { geometry } = object as Partial<Mesh>;
      if (geometry === undefined || object instanceof InstancedMesh) {
        return;
      }
      if (geometry.boundingBox === null) {
        geometry.computeBoundingBox();
      }
      if (geometry.boundingBox !== null && !geometry.boundingBox.isEmpty()) {
        bounds.union(geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
      }
    });
    return bounds;
  }

  /** The panels over the view: the model has its center in the free part */
  setCoveredArea(area: CoveredArea): void {
    this.coveredArea = area;
    this.render();
  }

  /** The free part of the view, in pixels; all of the view if the panels leave too little */
  private freeArea(): { left: number; top: number; width: number; height: number } {
    const { clientWidth: width, clientHeight: height } = this.canvas;
    const { left, top, bottom } = this.coveredArea;
    const freeWidth = width - left;
    const freeHeight = height - top - bottom;
    if (freeWidth < MINIMUM_FREE_PART * width || freeHeight < MINIMUM_FREE_PART * height) {
      return { left: 0, top: 0, width, height };
    }
    return { left, top, width: freeWidth, height: freeHeight };
  }

  /** Oblique view with z up, which shows all of the domain in the free part of the view */
  resetCamera(): void {
    const sphere = this.visibleBounds().getBoundingSphere(new Sphere());
    const radius = sphere.radius > 0 ? sphere.radius : 1;
    // The view angle is of all of the height: a narrow or low free part must move the camera back
    const free = this.freeArea();
    const height = this.canvas.clientHeight || 1;
    const halfTangent = (Math.tan((VIEW_ANGLE * Math.PI) / 360) * Math.min(free.width, free.height)) / height;
    const distance = radius / Math.sin(Math.atan(halfTangent));
    this.camera.up.set(0, 0, 1);
    this.camera.position.copy(sphere.center).addScaledVector(START_DIRECTION, distance);
    this.camera.lookAt(sphere.center);
    this.controls.target.copy(sphere.center);
  }

  /** Draws the view at once */
  render(): void {
    this.isDrawPending = false;
    const sphere = this.visibleBounds().getBoundingSphere(new Sphere());
    const radius = sphere.radius > 0 ? sphere.radius : 1;
    const distance = this.camera.position.distanceTo(sphere.center);
    this.camera.near = Math.max(distance - DEPTH_MARGIN * radius, MINIMUM_NEAR_PART * radius);
    this.camera.far = distance + DEPTH_MARGIN * radius;

    const { clientWidth: width, clientHeight: height } = this.canvas;
    // The center of the view moves to the center of the free part
    const free = this.freeArea();
    const offsetX = width / 2 - (free.left + free.width / 2);
    const offsetY = height / 2 - (free.top + free.height / 2);
    this.camera.setViewOffset(width, height, offsetX, offsetY, width, height);
    this.camera.updateProjectionMatrix();

    this.renderer.setViewport(0, 0, width, height);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.drawAxes(height, free);
    this.canvas.dataset.geometryCount = String(this.renderer.info.memory.geometries);
  }

  private drawAxes(height: number, free: { left: number; top: number; width: number; height: number }): void {
    const side = AXES_VIEW_PART * Math.min(free.width, free.height);
    this.axesCamera.position
      .copy(this.camera.position)
      .sub(this.controls.target)
      .setLength(AXES_CAMERA_DISTANCE);
    this.axesCamera.up.copy(this.camera.up);
    this.axesCamera.lookAt(0, 0, 0);
    this.renderer.clearDepth();
    this.renderer.setViewport(free.left, height - free.top - side, side, side);
    this.renderer.render(this.axes, this.axesCamera);
  }
}
