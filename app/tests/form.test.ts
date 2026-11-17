// The network of the workflow file: the dfngen input made from `[network]`
// of each test workflow is valid and gives the output of the native binary, and
// the reader of the workflow file refuses what the forms cannot show.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { InputFormError, networkToLibraryToml } from "../src/form/toml";
import { check_input, MeshStep, run_generation } from "../src/pkg/dfn_wasm.js";
import { tomlToWorkflow } from "../src/workflow";
import {
  compareOutputFolders,
  workflowNames,
  initWasm,
  meshPath,
  readWorkflowFile,
  readMesh,
  runNativeDfngen,
  userFracturesFile,
} from "./cases";
import { USER_FRACTURES_FILE } from "../src/userFractures";

beforeAll(initWasm);

// Milliseconds: two generations of a workflow (WebAssembly and native)
const GENERATION_TIMEOUT = 60000;

describe.each(workflowNames)("workflow %s", (workflowName) => {
  test("the dfngen input of the network is valid", () => {
    const workflowFile = readWorkflowFile(workflowName);
    const { network, boundaries } = tomlToWorkflow(workflowFile);
    expect(check_input(networkToLibraryToml(network, boundaries), readMesh(network.domain), userFracturesFile(network))).toBeUndefined();
  });

  test("the dfngen input of the network gives the output of the native binary", () => {
    const workflowFile = readWorkflowFile(workflowName);
    const { network, boundaries } = tomlToWorkflow(workflowFile);
    const userFractures = userFracturesFile(network);
    const result = run_generation(networkToLibraryToml(network, boundaries), readMesh(network.domain), userFractures, 1n, MeshStep.Make, () => {});
    expect(result.error).toBeUndefined();
    const wasmDir = mkdtempSync(join(tmpdir(), `dfn-wasm-${workflowName}-`));
    for (const name of result.file_names) {
      writeFileSync(join(wasmDir, name), result.file(name) ?? "");
    }

    // The native binary reads the mesh at its full path, and the fracture file next to its input
    network.domain = meshPath(network.domain);
    const inputDir = mkdtempSync(join(tmpdir(), `dfngen-input-${workflowName}-`));
    writeFileSync(join(inputDir, USER_FRACTURES_FILE), userFractures);
    writeFileSync(join(inputDir, "input.toml"), networkToLibraryToml(network, boundaries));
    const nativeDir = runNativeDfngen(join(inputDir, "input.toml"));
    expect(compareOutputFolders(nativeDir, wasmDir)).toBe("");
  }, GENERATION_TIMEOUT);
});

function problemsOf(toml: string): string[] {
  try {
    tomlToWorkflow(toml);
  } catch (error) {
    if (error instanceof InputFormError) {
      return error.problems;
    }
    throw error;
  }
  return [];
}

const BOX = readWorkflowFile("box_west_east");

/** The dfngen input of the network of a workflow file */
function networkLibraryToml(toml: string): string {
  const { network, boundaries } = tomlToWorkflow(toml);
  return networkToLibraryToml(network, boundaries);
}

test("an unknown key is an error", () => {
  const toml = BOX.replace("[network.clusters]", "[network.clusters]\nkeep_all = true");
  expect(problemsOf(toml)).toEqual(["[network.clusters]: `keep_all` is an unknown key"]);
});

test("a missing key is an error", () => {
  const toml = BOX.replace(/^min_feature_size = .*$/m, "");
  expect(problemsOf(toml)).toEqual(["[network]: `min_feature_size` is missing"]);
});

test("a missing section is an error", () => {
  const toml = BOX.slice(0, BOX.indexOf("[transport]"));
  expect(problemsOf(toml)).toEqual(["`transport` is missing"]);
});

test("enable in [network.mesh] is an error: the mesh is always on", () => {
  const toml = BOX.replace("[network.mesh]", "[network.mesh]\nenable = true");
  expect(problemsOf(toml)).toEqual(["[network.mesh]: `enable` is an unknown key"]);
});

test("[network.region_boundaries] is an error: the boundary lines are always on and have no key", () => {
  const toml = BOX.replace("[network.mesh]", "[network.region_boundaries]\nenable = true\n\n[network.mesh]");
  expect(problemsOf(toml)).toEqual(["[network]: `region_boundaries` is an unknown key"]);
});

test("keep_only_connected_to in [network.clusters] is an error: the roles of the surfaces give it", () => {
  const toml = BOX.replace("[network.clusters]", '[network.clusters]\nkeep_only_connected_to = [["west"]]');
  expect(problemsOf(toml)).toEqual(["[network.clusters]: `keep_only_connected_to` is an unknown key"]);
});

test("the dfngen input keeps only the clusters which connect the in-flow and the out-flow surfaces", () => {
  expect(networkLibraryToml(BOX)).toMatch(/^keep_only_connected_to = \[\["west"\], \["east"\]\]$/m);
});

test("the roles of the surfaces are read from [boundaries]", () => {
  expect(tomlToWorkflow(BOX).boundaries).toEqual({ inflow: ["west"], outflow: ["east"] });
});

test("a surface in inflow and outflow is an error", () => {
  const toml = BOX.replace('outflow = ["east"]', 'outflow = ["east", "west"]');
  expect(problemsOf(toml)).toContain("[boundaries]: `west` cannot be in inflow and outflow");
});

test("a pressure of a surface with no role is an error", () => {
  const toml = BOX.replace("pressure = { west = 10.1, east = 10.0 }", "pressure = { west = 10.1, east = 10.0, north = 9.0 }");
  expect(problemsOf(toml)).toEqual(["[flow]: pressure: `north` is not an in-flow or out-flow surface of [boundaries]"]);
});

test("a missing pressure of an in-flow surface is an error", () => {
  const toml = BOX.replace("pressure = { west = 10.1, east = 10.0 }", "pressure = { east = 10.0 }");
  expect(problemsOf(toml)).toEqual(["[flow]: pressure: `west` is missing"]);
});

test("inflow in [transport] is an error: the roles are in [boundaries]", () => {
  const toml = BOX.replace("[transport]\n", '[transport]\ninflow = ["west"]\n');
  expect(problemsOf(toml)).toEqual(["[transport]: `inflow` is an unknown key"]);
});

test("a missing [boundaries] section is an error", () => {
  const toml = BOX.replace(/\[boundaries\]\ninflow = .*\noutflow = .*\n/, "");
  expect(problemsOf(toml)).toContain("`boundaries` is missing");
});

test("keep_isolated_fractures in [network.clusters] is an error: the isolated fractures are always removed", () => {
  const toml = BOX.replace("[network.clusters]", "[network.clusters]\nkeep_isolated_fractures = false");
  expect(problemsOf(toml)).toEqual(["[network.clusters]: `keep_isolated_fractures` is an unknown key"]);
});

test("the dfngen input removes the isolated fractures", () => {
  expect(networkLibraryToml(BOX)).toMatch(/^keep_isolated_fractures = false$/m);
});

test("[transport.control_planes] is an error: the transport has no control planes", () => {
  const toml = `${BOX}\n[transport.control_planes]\nshape = "plane"\ndirection = "x"\nspacing = 1.0\n`;
  expect(problemsOf(toml)).toEqual(["[transport]: `control_planes` is an unknown key"]);
});

test("[transport.output] is an error: the trajectories and the velocities are always on", () => {
  const toml = `${BOX}\n[transport.output]\ntrajectories = true\n`;
  expect(problemsOf(toml)).toEqual(["[transport]: `output` is an unknown key"]);
});

test("a family without aperture is an error", () => {
  const toml = BOX.replace(/^aperture = .*$/m, "");
  expect(problemsOf(toml)).toEqual(["network family 1: `aperture` is missing"]);
});

test("p32_target with the stop condition n_poly is an error", () => {
  const toml = BOX.replace("[[network.family]]", "[[network.family]]\np32_target = 1.0");
  expect(problemsOf(toml)).toEqual(["network family 1: `p32_target` is not allowed with the stop condition `n_poly`"]);
});

test("a family without n_poly is an error with the stop condition n_poly", () => {
  const toml = BOX.replace(/^n_poly = 10\n/m, "");
  expect(problemsOf(toml)).toEqual(["network family 1: `n_poly` is necessary with the stop condition `n_poly`"]);
});

test("n_poly of a family with the stop condition p32 is an error", () => {
  const toml = BOX.replace('stop_condition = "n_poly"', 'stop_condition = "p32"').replace(
    "[[network.family]]",
    "[[network.family]]\np32_target = 1.0",
  );
  expect(problemsOf(toml)).toEqual(["network family 1: `n_poly` is not allowed with the stop condition `p32`"]);
});

test("the probability of a family is an unknown key: the numbers of fractures give it", () => {
  const toml = BOX.replace("[[network.family]]", "[[network.family]]\nprobability = 1.0");
  expect(problemsOf(toml)).toEqual(["network family 1: `probability` is an unknown key"]);
});

test("n_poly in [network.generation] is an unknown key: each family has its number", () => {
  const toml = BOX.replace("[network.generation]", "[network.generation]\nn_poly = 10");
  expect(problemsOf(toml)).toEqual(["[network.generation]: `n_poly` is an unknown key"]);
});

const TWO_FAMILIES = readWorkflowFile("two_families");

test("the dfngen n_poly is the sum of the numbers of fractures of the families", () => {
  expect(networkLibraryToml(TWO_FAMILIES)).toMatch(/\[generation\]\nn_poly = 5\n/);
});

test("the probability of a family is its share of the numbers of fractures", () => {
  const probabilities = [...networkLibraryToml(TWO_FAMILIES).matchAll(/^probability = (.*)$/gm)].map((match) => match[1]);
  expect(probabilities).toEqual(["0.4", "0.6"]);
});

test("the dfngen families have no n_poly", () => {
  expect(networkLibraryToml(TWO_FAMILIES).split("[[family]]").slice(1).join("")).not.toMatch(/n_poly/);
});

test("with the stop condition p32 the families have the same probability and no dfngen n_poly", () => {
  const toml = TWO_FAMILIES.replace('stop_condition = "n_poly"', 'stop_condition = "p32"')
    .replace("n_poly = 2", "p32_target = 0.1")
    .replace("n_poly = 3", "p32_target = 0.2");
  const libraryToml = networkLibraryToml(toml);
  const probabilities = [...libraryToml.matchAll(/^probability = (.*)$/gm)].map((match) => match[1]);
  expect({ probabilities, hasNPoly: /n_poly/.test(libraryToml) }).toEqual({ probabilities: ["0.5", "0.5"], hasNPoly: false });
});

test("without a family the dfngen input has no n_poly", () => {
  const { network, boundaries } = tomlToWorkflow(BOX);
  network.families = [];
  expect(networkToLibraryToml(network, boundaries)).not.toMatch(/n_poly/);
});

test("an unknown aperture distribution is an error", () => {
  const toml = BOX.replace('aperture = { distribution = "constant"', 'aperture = { distribution = "cubic"');
  expect(problemsOf(toml)).toEqual([
    'network family 1: aperture: `distribution` must be "constant", "log_normal", "correlated" or "semi_correlated"',
  ]);
});

const USER_FRACTURES = readWorkflowFile("user_fractures_stochastic");

test("the user fracture of the workflow file is read with all its keys", () => {
  expect(tomlToWorkflow(USER_FRACTURES).network.userFractures).toEqual([
    {
      region: "box",
      center: [5, 5, 5],
      radius: 7.78,
      aspectRatio: 0.545,
      beta: 0,
      aperture: 3e-4,
      orientation: { firstAngle: 90, secondAngle: 90 },
    },
  ]);
});

test("orientation_option gives the pair of angles of each orientation table", () => {
  const toml = USER_FRACTURES.replace('orientation_option = "theta_phi"', 'orientation_option = "dip_strike"')
    .replaceAll("theta =", "dip =")
    .replaceAll("phi =", "strike =");
  const { network } = tomlToWorkflow(toml);
  expect(network.orientationConvention).toBe("dip_strike");
  expect(network.userFractures[0].orientation).toEqual({ firstAngle: 90, secondAngle: 90 });
  // The user fractures are polygons in the dfngen input: the family has the pair
  expect(networkLibraryToml(toml)).toMatch(/orientation = \{ dip = 0\.0, strike = 0\.0, kappa = 0\.1 \}/);
});

test("the dfngen input has no orientation_option: dfngen has the pair in each table", () => {
  expect(networkLibraryToml(USER_FRACTURES)).not.toMatch(/orientation_option/);
});

test("another pair than the one of orientation_option is an error", () => {
  const toml = USER_FRACTURES.replace('orientation_option = "theta_phi"', 'orientation_option = "trend_plunge"');
  expect(problemsOf(toml)).toContain("network family 1: orientation: `trend` is missing");
  expect(problemsOf(toml)).toContain("network family 1: orientation: `theta` is an unknown key");
});

test("an unknown orientation_option is an error", () => {
  const toml = USER_FRACTURES.replace('orientation_option = "theta_phi"', 'orientation_option = "strike_dip"');
  expect(problemsOf(toml)).toContain('[network]: `orientation_option` must be "theta_phi", "trend_plunge", "dip_strike"');
});

test("number_of_points of [network] is the number of points of each dfngen family", () => {
  const toml = USER_FRACTURES.replace("number_of_points = 8", "number_of_points = 5");
  expect(tomlToWorkflow(toml).network.numberOfPoints).toBe(5);
  const libraryToml = networkLibraryToml(toml);
  expect(libraryToml).toMatch(/\[\[family\]\]\nnumber_of_points = 5\n/);
  // Not at the top: dfngen has no such key there
  expect(libraryToml.split("[")[0]).not.toMatch(/number_of_points/);
});

test("number_of_points in a family is an unknown key: one value for all fractures", () => {
  const toml = USER_FRACTURES.replace("[[network.family]]", "[[network.family]]\nnumber_of_points = 4");
  expect(problemsOf(toml)).toEqual(["network family 1: `number_of_points` is an unknown key"]);
});

test("the dfngen input has no forced large fractures and removes no fracture for its size", () => {
  expect(networkLibraryToml(BOX)).toMatch(/\[generation\]\nn_poly = 10\nforce_large_fractures = false\nremove_fractures_less_than = 0\.0\n/);
});

test.each(["force_large_fractures = true", "remove_fractures_less_than = 1.0"])("%s in [network.generation] is an unknown key", (line) => {
  const toml = BOX.replace("[network.generation]", `[network.generation]\n${line}`);
  expect(problemsOf(toml)).toEqual([`[network.generation]: \`${line.split(" ")[0]}\` is an unknown key`]);
});

test("number_of_points is necessary", () => {
  const toml = USER_FRACTURES.replace("number_of_points = 8\n", "");
  expect(problemsOf(toml)).toEqual(["[network]: `number_of_points` is missing"]);
});

test("orientation_option is necessary", () => {
  const toml = USER_FRACTURES.replace('orientation_option = "theta_phi"\n', "");
  expect(problemsOf(toml)).toContain("[network]: `orientation_option` is missing");
});

test("a user fracture without aperture is an error", () => {
  const toml = USER_FRACTURES.replace("aperture = 3e-4\n", "");
  expect(problemsOf(toml)).toEqual(["network user fracture 1: `aperture` is missing"]);
});

test("user_fracture_aperture in [network.mesh] is an error: each user fracture has its aperture", () => {
  const toml = USER_FRACTURES.replace(
    "[network.mesh]",
    '[network.mesh]\nuser_fracture_aperture = { distribution = "constant", value = 3e-4 }',
  );
  expect(problemsOf(toml)).toEqual(["[network.mesh]: `user_fracture_aperture` is an unknown key"]);
});

test("a user fracture without region is an error", () => {
  const toml = USER_FRACTURES.replace('region = "box"\n', "");
  expect(problemsOf(toml)).toEqual(["network user fracture 1: `region` is missing"]);
});

test("a center which is not three numbers is an error", () => {
  const toml = USER_FRACTURES.replace("center = [5.0, 5.0, 5.0]", "center = [5.0, 5.0]");
  expect(problemsOf(toml)).toEqual(["network user fracture 1: `center` must be an array of three numbers"]);
});

test("kappa in the orientation of a user fracture is an error", () => {
  const toml = USER_FRACTURES.replace("orientation = { theta = 90.0, phi = 90.0 }", "orientation = { theta = 90.0, phi = 90.0, kappa = 8.0 }");
  expect(problemsOf(toml)).toEqual(["network user fracture 1: orientation: `kappa` is an unknown key"]);
});

test("the key user_fractures (a fracture file) is an error", () => {
  const toml = USER_FRACTURES.replace('domain = "Box.vtu"', 'domain = "Box.vtu"\nuser_fractures = "fractures.vtp"');
  expect(problemsOf(toml)).toEqual(["[network]: `user_fractures` is an unknown key"]);
});

// A new user fracture keeps the text of the dfngen input: a checkpoint of the
// network (its hash) stays valid
test("the dfngen input names the fracture file also without user fractures", () => {
  expect(networkLibraryToml(BOX)).toMatch(/^user_fractures = "user_fractures\.vtp"$/m);
});

test("an unknown key in [flow] is an error", () => {
  const toml = BOX.replace("[flow]", '[flow]\nmesh = "dfn_mesh.vtu"');
  expect(problemsOf(toml)).toEqual(["[flow]: `mesh` is an unknown key"]);
});

test("a pressure which is not a number is an error", () => {
  const toml = BOX.replace("west = 10.1", 'west = "high"');
  expect(problemsOf(toml)).toEqual(["[flow]: pressure: `west` must be a number"]);
});

test("a seeding method is an unknown key: the release points are the only seeding", () => {
  const toml = BOX.replace("[transport.seeding]", '[transport.seeding]\nmethod = "uniform_per_line"');
  expect(problemsOf(toml)).toEqual(["[transport.seeding]: `method` is an unknown key"]);
});

test("a seed larger than 2^53 is kept", () => {
  const toml = BOX.replace(/^\[network\]\nseed = \d+$/m, "[network]\nseed = 18446744073709551615");
  expect(tomlToWorkflow(toml).network.seed).toBe("18446744073709551615");
});
