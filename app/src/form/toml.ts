// Conversion between the network form state and `[network]` of the workflow
// file, and the dfngen input file of the network. Also the TOML helpers of
// the flow and the transport.
//
// `readNetwork` checks the keys and the types, as the `*Section` structs of
// `../dfngen-rs/src/io/input.rs` do: an unknown key or a missing key is an
// error, so no value of the file is lost in the form. The library checks the
// values ("Generate").

import { parse } from "smol-toml";
import { clustersLine, type BoundaryRoles } from "../boundaryRoles";
import {
  FRAM_DEFAULTS,
  MESH_DEFAULTS,
  ORIENTATION_KEYS,
  defaultAperture,
  defaultFamily,
  type ApertureState,
  type FamilyState,
  type FormState,
  type OrientationConvention,
  type OrientationState,
  type PlaneOrientationState,
  type RadiusState,
  type UserFractureState,
} from "./state";
import { USER_FRACTURES_FILE } from "../userFractures";

/** A TOML text which the form cannot show, with one message for each problem */
export class InputFormError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join("\n"));
  }
}

// ---------------------------------------------------------------- writing

/** TOML float: always with a decimal point or an exponent */
export function float(value: number): string {
  const text = String(value);
  return /[.eE]/.test(text) || !Number.isFinite(value) ? text : `${text}.0`;
}

export function integer(value: number): string {
  return String(Math.trunc(value));
}

/** TOML basic string (the escapes of JSON are valid in TOML) */
export function string(value: string): string {
  return JSON.stringify(value);
}

/** TOML key: a bare key when it can be one, else a quoted key */
export function key(name: string): string {
  return /^[A-Za-z0-9_-]+$/.test(name) ? name : string(name);
}

export function inlineTable(entries: [string, string][]): string {
  return `{ ${entries.map(([key, value]) => `${key} = ${value}`).join(", ")} }`;
}

/** One table of a TOML text: `name` "" = the top table of its parent; `isArray` = [[name]] */
export interface TomlTable {
  name: string;
  isArray: boolean;
  lines: string[];
}

/** The TOML text of the tables, each under the parent table (`parent` "" = the root) */
export function tablesToToml(tables: TomlTable[], parent: string): string {
  const blocks = tables.map((table) => {
    const path = [parent, table.name].filter((part) => part !== "").join(".");
    if (path === "") {
      return table.lines;
    }
    return [table.isArray ? `[[${path}]]` : `[${path}]`, ...table.lines];
  });
  return `${blocks.map((lines) => lines.join("\n")).join("\n\n")}\n`;
}

function radiusEntries(radius: RadiusState): [string, string][] {
  const entries: [string, string][] = [["distribution", string(radius.distribution)]];
  switch (radius.distribution) {
    case "log_normal":
      entries.push(["log_mean", float(radius.logMean)], ["sd", float(radius.sd)]);
      entries.push(["min", float(radius.min)], ["max", float(radius.max)]);
      if (radius.sampling !== null) {
        entries.push(["sampling", string(radius.sampling)]);
      }
      break;
    case "truncated_power_law":
      entries.push(["alpha", float(radius.alpha)], ["min", float(radius.min)], ["max", float(radius.max)]);
      break;
    case "exponential":
      entries.push(["mean", float(radius.mean)], ["min", float(radius.min)], ["max", float(radius.max)]);
      break;
    case "constant":
      entries.push(["value", float(radius.value)]);
      break;
  }
  return entries;
}

function apertureEntries(aperture: ApertureState): [string, string][] {
  const entries: [string, string][] = [["distribution", string(aperture.distribution)]];
  switch (aperture.distribution) {
    case "constant":
      entries.push(["value", float(aperture.value)]);
      break;
    case "log_normal":
      entries.push(["log_mean", float(aperture.logMean)], ["sd", float(aperture.sd)]);
      break;
    case "correlated":
      entries.push(["alpha", float(aperture.alpha)], ["beta", float(aperture.beta)]);
      break;
    case "semi_correlated":
      entries.push(["alpha", float(aperture.alpha)], ["beta", float(aperture.beta)], ["sd", float(aperture.sd)]);
      break;
  }
  return entries;
}

function planeOrientationEntries(orientation: PlaneOrientationState): [string, string][] {
  const [firstKey, secondKey] = ORIENTATION_KEYS[orientation.convention];
  return [
    [firstKey, float(orientation.firstAngle)],
    [secondKey, float(orientation.secondAngle)],
  ];
}

function orientationEntries(orientation: OrientationState): [string, string][] {
  return [...planeOrientationEntries(orientation), ["kappa", float(orientation.kappa)]];
}

function familyLines(family: FamilyState, isP32: boolean): string[] {
  const lines = [
    `number_of_points = ${integer(family.numberOfPoints)}`,
    `probability = ${float(family.probability)}`,
    `aspect_ratio = ${float(family.aspectRatio)}`,
  ];
  if (family.region !== null) {
    lines.push(`region = ${string(family.region)}`);
  }
  if (family.beta !== null) {
    lines.push(`beta = ${float(family.beta)}`);
  }
  if (isP32) {
    lines.push(`p32_target = ${float(family.p32Target)}`);
  }
  lines.push(`aperture = ${inlineTable(apertureEntries(family.aperture))}`);
  lines.push(`radius = ${inlineTable(radiusEntries(family.radius))}`);
  lines.push(`orientation = ${inlineTable(orientationEntries(family.orientation))}`);
  return lines;
}

function userFractureLines(fracture: UserFractureState): string[] {
  return [
    `region = ${string(fracture.region)}`,
    `center = [${fracture.center.map(float).join(", ")}]`,
    `number_of_points = ${integer(fracture.numberOfPoints)}`,
    `radius = ${float(fracture.radius)}`,
    `aspect_ratio = ${float(fracture.aspectRatio)}`,
    `beta = ${float(fracture.beta)}`,
    `aperture = ${float(fracture.aperture)}`,
    `orientation = ${inlineTable(planeOrientationEntries(fracture.orientation))}`,
  ];
}

/** The tables of `[network]` of the workflow file */
export function networkTables(state: FormState): TomlTable[] {
  const isP32 = state.generation.stopCondition === "p32";
  const rootLines = [
    `seed = ${state.seed}`,
    `min_feature_size = ${float(state.minFeatureSize)}`,
    `domain = ${string(state.domain)}`,
  ];
  const tables: TomlTable[] = [{ name: "", isArray: false, lines: rootLines }];

  const generationLines = isP32 ? [] : [`n_poly = ${integer(state.generation.nPoly)}`];
  generationLines.push(`force_large_fractures = ${state.generation.forceLargeFractures}`);
  generationLines.push(`remove_fractures_less_than = ${float(state.generation.removeFracturesLessThan)}`);
  tables.push({ name: "generation", isArray: false, lines: generationLines });

  // Without FRAM, the section is not written: its other keys have no effect
  if (state.fram.enable) {
    const fram = state.fram;
    tables.push({
      name: "fram",
      isArray: false,
      lines: [
        "enable = true",
        `relaxed = ${fram.relaxed}`,
        `triple_intersections = ${fram.tripleIntersections}`,
        `check_user_fractures = ${fram.checkUserFractures}`,
        `write_rejected_fractures = ${fram.writeRejectedFractures}`,
        `rejects_per_fracture = ${integer(fram.rejectsPerFracture)}`,
      ],
    });
  }

  const mesh = state.mesh;
  const meshLines = [`max_size_factor = ${float(mesh.maxSizeFactor)}`, `slope = ${float(mesh.slope)}`];
  tables.push({ name: "mesh", isArray: false, lines: meshLines });

  tables.push({
    name: "clusters",
    isArray: false,
    lines: [`keep_only_largest = ${state.clusters.keepOnlyLargest}`],
  });

  for (const family of state.families) {
    tables.push({ name: "family", isArray: true, lines: familyLines(family, isP32) });
  }
  for (const fracture of state.userFractures) {
    tables.push({ name: "user_fracture", isArray: true, lines: userFractureLines(fracture) });
  }
  return tables;
}

/**
 * The boundary lines are always on in dfn-toolbox and have no other key, thus
 * the workflow file has no section for them; the dfngen input needs it
 */
const REGION_BOUNDARIES_TABLE: TomlTable = { name: "region_boundaries", isArray: false, lines: ["enable = true"] };

/**
 * The dfngen input file of the network. The mesh is always on in dfn-toolbox. The
 * user-defined fractures are the polygons of `USER_FRACTURES_FILE` (made by
 * `userFracturesToVtp`), not tables. The isolated fractures and the clusters
 * which do not connect an in-flow and an out-flow surface are always removed
 * (the particles need a path between them), thus the workflow file has no
 * keys for them.
 */
export function networkToLibraryToml(state: FormState, roles: BoundaryRoles): string {
  const clustersLines = ["keep_isolated_fractures = false", clustersLine(roles)];
  const tables = networkTables(state).flatMap((table) => {
    if (table.name === "") {
      const fileLines = state.userFractures.length === 0 ? [] : [`user_fractures = ${string(USER_FRACTURES_FILE)}`];
      return [{ ...table, lines: [...table.lines, ...fileLines] }];
    }
    if (table.name === "mesh") {
      return [REGION_BOUNDARIES_TABLE, { ...table, lines: ["enable = true", ...table.lines] }];
    }
    if (table.name === "clusters") {
      return [{ ...table, lines: [...table.lines, ...clustersLines] }];
    }
    return table.name === "user_fracture" ? [] : [table];
  });
  return tablesToToml(tables, "");
}

// ---------------------------------------------------------------- reading

export type Table = Record<string, unknown>;

export function isTable(value: unknown): value is Table {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

/** Reads the keys of one table and records each problem with the path of the table */
export class TableReader {
  private readonly usedKeys = new Set<string>();

  constructor(
    private readonly source: Table,
    private readonly path: string,
    private readonly problems: string[],
  ) {}

  private where(key: string): string {
    return this.path === "" ? `\`${key}\`` : `${this.path}: \`${key}\``;
  }

  private value(key: string, isOptional: boolean): unknown {
    this.usedKeys.add(key);
    const value = this.source[key];
    if (value === undefined && !isOptional) {
      this.problems.push(`${this.where(key)} is missing`);
    }
    return value;
  }

  has(key: string): boolean {
    return this.source[key] !== undefined;
  }

  optionalFloat(key: string): number | null {
    const value = this.value(key, true);
    if (value === undefined) {
      return null;
    }
    if (typeof value === "number" || typeof value === "bigint") {
      return Number(value);
    }
    this.problems.push(`${this.where(key)} must be a number`);
    return null;
  }

  float(key: string, fallback: number): number {
    this.value(key, false);
    return this.optionalFloat(key) ?? fallback;
  }

  optionalInteger(key: string): number | null {
    const value = this.value(key, true);
    if (value === undefined) {
      return null;
    }
    if (typeof value === "bigint" || (typeof value === "number" && Number.isInteger(value))) {
      return Number(value);
    }
    this.problems.push(`${this.where(key)} must be an integer`);
    return null;
  }

  integer(key: string, fallback: number): number {
    this.value(key, false);
    return this.optionalInteger(key) ?? fallback;
  }

  /** An unsigned integer of any size, as decimal digits */
  integerDigits(key: string, fallback: string): string {
    const value = this.value(key, false);
    if (value === undefined) {
      return fallback;
    }
    if ((typeof value === "bigint" || typeof value === "number") && Number.isInteger(Number(value)) && value >= 0) {
      return BigInt(value).toString();
    }
    this.problems.push(`${this.where(key)} must be an integer of 0 or more`);
    return fallback;
  }

  boolean(key: string, fallback: boolean, isOptional = false): boolean {
    const value = this.value(key, isOptional);
    if (value === undefined) {
      return fallback;
    }
    if (typeof value === "boolean") {
      return value;
    }
    this.problems.push(`${this.where(key)} must be true or false`);
    return fallback;
  }

  optionalString(key: string): string | null {
    const value = this.value(key, true);
    if (value === undefined) {
      return null;
    }
    if (typeof value === "string") {
      return value;
    }
    this.problems.push(`${this.where(key)} must be a text`);
    return null;
  }

  string(key: string, fallback: string): string {
    this.value(key, false);
    return this.optionalString(key) ?? fallback;
  }

  /** One of the given texts */
  choice<Choice extends string>(key: string, choices: readonly Choice[], fallback: Choice): Choice {
    const value = this.string(key, fallback);
    if ((choices as readonly string[]).includes(value)) {
      return value as Choice;
    }
    this.problems.push(`${this.where(key)} must be ${choices.map((choice) => `"${choice}"`).join(", ")}`);
    return fallback;
  }

  /** Three numbers: x, y and z */
  point(key: string): [number, number, number] {
    const value = this.value(key, false);
    if (value === undefined) {
      return [0, 0, 0];
    }
    if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === "number" || typeof item === "bigint")) {
      return [Number(value[0]), Number(value[1]), Number(value[2])];
    }
    this.problems.push(`${this.where(key)} must be an array of three numbers`);
    return [0, 0, 0];
  }

  stringArray(key: string): string[] {
    const value = this.value(key, false);
    if (value === undefined) {
      return [];
    }
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      return value;
    }
    this.problems.push(`${this.where(key)} must be an array of texts`);
    return [];
  }

  /** A sub-table; an empty table when it is missing or not a table */
  subTable(key: string, isOptional = false): Table {
    const value = this.value(key, isOptional);
    if (value === undefined) {
      return {};
    }
    if (isTable(value)) {
      return value;
    }
    this.problems.push(`${this.where(key)} must be a table`);
    return {};
  }

  /** An optional array of tables ([[key]]); empty when it is missing */
  tables(key: string): Table[] {
    const value = this.value(key, true);
    if (value === undefined) {
      return [];
    }
    if (Array.isArray(value) && value.every(isTable)) {
      return value;
    }
    this.problems.push(`${this.where(key)} must be an array of tables ([[${key}]])`);
    return [];
  }

  /** Records each key which was not read */
  checkUnknownKeys(): void {
    for (const key of Object.keys(this.source)) {
      if (!this.usedKeys.has(key)) {
        this.problems.push(`${this.where(key)} is an unknown key`);
      }
    }
  }
}

function readRadius(table: Table, path: string, problems: string[]): RadiusState {
  const reader = new TableReader(table, path, problems);
  const distribution = reader.string("distribution", "constant");
  let radius: RadiusState;
  switch (distribution) {
    case "log_normal": {
      const sampling = reader.optionalString("sampling");
      if (sampling !== null && sampling !== "rejection" && sampling !== "inverse_cdf") {
        problems.push(`${path}: \`sampling\` must be "rejection" or "inverse_cdf"`);
      }
      radius = {
        distribution,
        logMean: reader.float("log_mean", 0),
        sd: reader.float("sd", 0),
        min: reader.float("min", 0),
        max: reader.float("max", 0),
        sampling: sampling === "rejection" || sampling === "inverse_cdf" ? sampling : null,
      };
      break;
    }
    case "truncated_power_law":
      radius = { distribution, alpha: reader.float("alpha", 0), min: reader.float("min", 0), max: reader.float("max", 0) };
      break;
    case "exponential":
      radius = { distribution, mean: reader.float("mean", 0), min: reader.float("min", 0), max: reader.float("max", 0) };
      break;
    case "constant":
      radius = { distribution, value: reader.float("value", 0) };
      break;
    default:
      problems.push(
        `${path}: \`distribution\` must be "log_normal", "truncated_power_law", "exponential" or "constant"`,
      );
      return defaultFamily().radius;
  }
  reader.checkUnknownKeys();
  return radius;
}

function readAperture(table: Table, path: string, problems: string[]): ApertureState {
  const reader = new TableReader(table, path, problems);
  const distribution = reader.string("distribution", "constant");
  let aperture: ApertureState;
  switch (distribution) {
    case "constant":
      aperture = { distribution, value: reader.float("value", 0) };
      break;
    case "log_normal":
      aperture = { distribution, logMean: reader.float("log_mean", 0), sd: reader.float("sd", 0) };
      break;
    case "correlated":
      aperture = { distribution, alpha: reader.float("alpha", 0), beta: reader.float("beta", 0) };
      break;
    case "semi_correlated":
      aperture = {
        distribution,
        alpha: reader.float("alpha", 0),
        beta: reader.float("beta", 0),
        sd: reader.float("sd", 0),
      };
      break;
    default:
      problems.push(
        `${path}: \`distribution\` must be "constant", "log_normal", "correlated" or "semi_correlated"`,
      );
      return defaultAperture("constant");
  }
  reader.checkUnknownKeys();
  return aperture;
}

/** An optional aperture table; null when the key is missing */
function readOptionalAperture(reader: TableReader, key: string, path: string, problems: string[]): ApertureState | null {
  if (!reader.has(key)) {
    return null;
  }
  return readAperture(reader.subTable(key), path, problems);
}

/** The pair of angles of an orientation table; the reader checks the other keys */
function readPlaneOrientation(reader: TableReader, path: string, problems: string[]): PlaneOrientationState {
  const conventions = (Object.keys(ORIENTATION_KEYS) as OrientationConvention[]).filter((convention) =>
    ORIENTATION_KEYS[convention].some((key) => reader.has(key)),
  );
  if (conventions.length !== 1) {
    problems.push(`${path}: must have one pair: theta and phi, trend and plunge, or dip and strike`);
  }
  const convention = conventions[0] ?? "theta_phi";
  const [firstKey, secondKey] = ORIENTATION_KEYS[convention];
  return { convention, firstAngle: reader.float(firstKey, 0), secondAngle: reader.float(secondKey, 0) };
}

function readOrientation(table: Table, path: string, problems: string[]): OrientationState {
  const reader = new TableReader(table, path, problems);
  const orientation = { ...readPlaneOrientation(reader, path, problems), kappa: reader.float("kappa", 0) };
  reader.checkUnknownKeys();
  return orientation;
}

function readFamily(table: Table, path: string, isP32: boolean, problems: string[]): FamilyState {
  const reader = new TableReader(table, path, problems);
  const p32Target = reader.optionalFloat("p32_target");
  if (isP32 && p32Target === null) {
    problems.push(`${path}: \`p32_target\` is necessary without \`n_poly\``);
  }
  if (!isP32 && p32Target !== null) {
    problems.push(`${path}: \`p32_target\` is not allowed with \`n_poly\``);
  }
  const aperture = readOptionalAperture(reader, "aperture", `${path}: aperture`, problems);
  if (aperture === null) {
    problems.push(`${path}: \`aperture\` is missing`);
  }
  const family: FamilyState = {
    numberOfPoints: reader.integer("number_of_points", 0),
    probability: reader.float("probability", 0),
    aspectRatio: reader.float("aspect_ratio", 0),
    region: reader.optionalString("region"),
    beta: reader.optionalFloat("beta"),
    p32Target: p32Target ?? defaultFamily().p32Target,
    aperture: aperture ?? defaultAperture("constant"),
    radius: readRadius(reader.subTable("radius"), `${path}: radius`, problems),
    orientation: readOrientation(reader.subTable("orientation"), `${path}: orientation`, problems),
  };
  reader.checkUnknownKeys();
  return family;
}

function readUserFracture(table: Table, path: string, problems: string[]): UserFractureState {
  const reader = new TableReader(table, path, problems);
  const orientationReader = new TableReader(reader.subTable("orientation"), `${path}: orientation`, problems);
  const orientation = readPlaneOrientation(orientationReader, `${path}: orientation`, problems);
  orientationReader.checkUnknownKeys();
  const fracture: UserFractureState = {
    region: reader.string("region", ""),
    center: reader.point("center"),
    numberOfPoints: reader.integer("number_of_points", 0),
    radius: reader.float("radius", 0),
    aspectRatio: reader.float("aspect_ratio", 0),
    beta: reader.float("beta", 0),
    aperture: reader.float("aperture", 0),
    orientation,
  };
  reader.checkUnknownKeys();
  return fracture;
}

/** Parses a TOML text; integers which a number cannot hold exactly are bigints. Throws `InputFormError`. */
export function parseToml(text: string): Table {
  try {
    return parse(text, { integersAsBigInt: "asNeeded" }) as Table;
  } catch (error) {
    throw new InputFormError([String(error instanceof Error ? error.message : error)]);
  }
}

/** Reads the `[network]` table of the workflow file into the form state */
export function readNetwork(table: Table, problems: string[]): FormState {
  const reader = new TableReader(table, "[network]", problems);

  const generationReader = new TableReader(reader.subTable("generation"), "[network.generation]", problems);
  const nPoly = generationReader.optionalInteger("n_poly");
  const generation = {
    stopCondition: nPoly === null ? ("p32" as const) : ("n_poly" as const),
    nPoly: nPoly ?? 100,
    forceLargeFractures: generationReader.boolean("force_large_fractures", false),
    removeFracturesLessThan: generationReader.float("remove_fractures_less_than", 0),
  };
  generationReader.checkUnknownKeys();

  const framReader = new TableReader(reader.subTable("fram", true), "[network.fram]", problems);
  const fram = {
    enable: framReader.boolean("enable", FRAM_DEFAULTS.enable, true),
    relaxed: framReader.boolean("relaxed", FRAM_DEFAULTS.relaxed, true),
    tripleIntersections: framReader.boolean("triple_intersections", FRAM_DEFAULTS.tripleIntersections, true),
    checkUserFractures: framReader.boolean("check_user_fractures", FRAM_DEFAULTS.checkUserFractures, true),
    writeRejectedFractures: framReader.boolean(
      "write_rejected_fractures",
      FRAM_DEFAULTS.writeRejectedFractures,
      true,
    ),
    rejectsPerFracture: framReader.optionalInteger("rejects_per_fracture") ?? FRAM_DEFAULTS.rejectsPerFracture,
  };
  framReader.checkUnknownKeys();

  const meshReader = new TableReader(reader.subTable("mesh", true), "[network.mesh]", problems);
  const mesh = {
    maxSizeFactor: meshReader.optionalFloat("max_size_factor") ?? MESH_DEFAULTS.maxSizeFactor,
    slope: meshReader.optionalFloat("slope") ?? MESH_DEFAULTS.slope,
  };
  meshReader.checkUnknownKeys();

  const clustersReader = new TableReader(reader.subTable("clusters"), "[network.clusters]", problems);
  const clusters = {
    keepOnlyLargest: clustersReader.boolean("keep_only_largest", false),
  };
  clustersReader.checkUnknownKeys();

  const families = reader
    .tables("family")
    .map((table, index) =>
      readFamily(table, `network family ${index + 1}`, generation.stopCondition === "p32", problems),
    );

  const state: FormState = {
    seed: reader.integerDigits("seed", "0"),
    minFeatureSize: reader.float("min_feature_size", 0),
    domain: reader.string("domain", ""),
    userFractures: reader
      .tables("user_fracture")
      .map((table, index) => readUserFracture(table, `network user fracture ${index + 1}`, problems)),
    generation,
    fram,
    mesh,
    clusters,
    families,
  };
  reader.checkUnknownKeys();

  return state;
}
