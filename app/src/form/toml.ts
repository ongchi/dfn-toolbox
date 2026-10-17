// Conversion between the form state and the TOML text of the input file.
//
// `tomlToFormState` checks the keys and the types, as the `*Section` structs
// of `src/io/input.rs` do: an unknown key or a missing key is an error, so
// no value of the file is lost in the form. The library checks the values
// ("Check input").

import { parse } from "smol-toml";
import {
  FRAM_DEFAULTS,
  ORIENTATION_KEYS,
  defaultFamily,
  type FamilyState,
  type FormState,
  type OrientationConvention,
  type OrientationState,
  type RadiusState,
} from "./state";

/** A TOML text which the form cannot show, with one message for each problem */
export class InputFormError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join("\n"));
  }
}

// ---------------------------------------------------------------- writing

/** TOML float: always with a decimal point or an exponent */
function float(value: number): string {
  const text = String(value);
  return /[.eE]/.test(text) || !Number.isFinite(value) ? text : `${text}.0`;
}

function integer(value: number): string {
  return String(Math.trunc(value));
}

/** TOML basic string (the escapes of JSON are valid in TOML) */
function string(value: string): string {
  return JSON.stringify(value);
}

function inlineTable(entries: [string, string][]): string {
  return `{ ${entries.map(([key, value]) => `${key} = ${value}`).join(", ")} }`;
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

function orientationEntries(orientation: OrientationState): [string, string][] {
  const [firstKey, secondKey] = ORIENTATION_KEYS[orientation.convention];
  return [
    [firstKey, float(orientation.firstAngle)],
    [secondKey, float(orientation.secondAngle)],
    ["kappa", float(orientation.kappa)],
  ];
}

function familyLines(family: FamilyState, isP32: boolean): string[] {
  const lines = [
    "[[family]]",
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
  lines.push(`radius = ${inlineTable(radiusEntries(family.radius))}`);
  lines.push(`orientation = ${inlineTable(orientationEntries(family.orientation))}`);
  return lines;
}

export function formStateToToml(state: FormState): string {
  const isP32 = state.generation.stopCondition === "p32";
  const lines = [
    `seed = ${state.seed}`,
    `min_feature_size = ${float(state.minFeatureSize)}`,
    `domain = ${string(state.domain)}`,
  ];
  if (state.userFractures !== null) {
    lines.push(`user_fractures = ${string(state.userFractures)}`);
  }

  lines.push("", "[generation]");
  if (!isP32) {
    lines.push(`n_poly = ${integer(state.generation.nPoly)}`);
  }
  lines.push(`force_large_fractures = ${state.generation.forceLargeFractures}`);
  lines.push(`remove_fractures_less_than = ${float(state.generation.removeFracturesLessThan)}`);

  // Without FRAM, the section is not written: its other keys have no effect
  if (state.fram.enable) {
    const fram = state.fram;
    lines.push("", "[fram]", "enable = true");
    lines.push(`relaxed = ${fram.relaxed}`);
    lines.push(`triple_intersections = ${fram.tripleIntersections}`);
    lines.push(`check_user_fractures = ${fram.checkUserFractures}`);
    lines.push(`write_rejected_fractures = ${fram.writeRejectedFractures}`);
    lines.push(`rejects_per_fracture = ${integer(fram.rejectsPerFracture)}`);
  }

  lines.push("", "[clusters]");
  lines.push(`keep_only_largest = ${state.clusters.keepOnlyLargest}`);
  lines.push(`keep_isolated_fractures = ${state.clusters.keepIsolatedFractures}`);

  for (const family of state.families) {
    lines.push("", ...familyLines(family, isP32));
  }
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------- reading

type Table = Record<string, unknown>;

function isTable(value: unknown): value is Table {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

/** Reads the keys of one table and records each problem with the path of the table */
class TableReader {
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

function readOrientation(table: Table, path: string, problems: string[]): OrientationState {
  const reader = new TableReader(table, path, problems);
  const conventions = (Object.keys(ORIENTATION_KEYS) as OrientationConvention[]).filter((convention) =>
    ORIENTATION_KEYS[convention].some((key) => reader.has(key)),
  );
  if (conventions.length !== 1) {
    problems.push(`${path}: must have one pair: theta and phi, trend and plunge, or dip and strike`);
  }
  const convention = conventions[0] ?? "theta_phi";
  const [firstKey, secondKey] = ORIENTATION_KEYS[convention];
  const orientation = {
    convention,
    firstAngle: reader.float(firstKey, 0),
    secondAngle: reader.float(secondKey, 0),
    kappa: reader.float("kappa", 0),
  };
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
  const family: FamilyState = {
    numberOfPoints: reader.integer("number_of_points", 0),
    probability: reader.float("probability", 0),
    aspectRatio: reader.float("aspect_ratio", 0),
    region: reader.optionalString("region"),
    beta: reader.optionalFloat("beta"),
    p32Target: p32Target ?? defaultFamily().p32Target,
    radius: readRadius(reader.subTable("radius"), `${path}: radius`, problems),
    orientation: readOrientation(reader.subTable("orientation"), `${path}: orientation`, problems),
  };
  reader.checkUnknownKeys();
  return family;
}

/** Reads a TOML input file into the form state. Throws `InputFormError`. */
export function tomlToFormState(text: string): FormState {
  let root: Table;
  try {
    root = parse(text, { integersAsBigInt: "asNeeded" }) as Table;
  } catch (error) {
    throw new InputFormError([String(error instanceof Error ? error.message : error)]);
  }

  const problems: string[] = [];
  const reader = new TableReader(root, "", problems);

  const generationReader = new TableReader(reader.subTable("generation"), "[generation]", problems);
  const nPoly = generationReader.optionalInteger("n_poly");
  const generation = {
    stopCondition: nPoly === null ? ("p32" as const) : ("n_poly" as const),
    nPoly: nPoly ?? 100,
    forceLargeFractures: generationReader.boolean("force_large_fractures", false),
    removeFracturesLessThan: generationReader.float("remove_fractures_less_than", 0),
  };
  generationReader.checkUnknownKeys();

  const framReader = new TableReader(reader.subTable("fram", true), "[fram]", problems);
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

  const clustersReader = new TableReader(reader.subTable("clusters"), "[clusters]", problems);
  const clusters = {
    keepOnlyLargest: clustersReader.boolean("keep_only_largest", false),
    keepIsolatedFractures: clustersReader.boolean("keep_isolated_fractures", false),
  };
  clustersReader.checkUnknownKeys();

  const families = reader
    .tables("family")
    .map((table, index) =>
      readFamily(table, `family ${index + 1}`, generation.stopCondition === "p32", problems),
    );

  const state: FormState = {
    seed: reader.integerDigits("seed", "0"),
    minFeatureSize: reader.float("min_feature_size", 0),
    domain: reader.string("domain", ""),
    userFractures: reader.optionalString("user_fractures"),
    generation,
    fram,
    clusters,
    families,
  };
  reader.checkUnknownKeys();

  if (problems.length > 0) {
    throw new InputFormError(problems);
  }
  return state;
}
