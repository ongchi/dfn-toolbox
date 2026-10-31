// The network of the workflow file: the dfngen input made from `[network]`
// of each example is valid and gives the output of the native binary, and
// the reader of the workflow file refuses what the forms cannot show.
//
// As in wasm.test.ts, the triangle mesh (dfn_mesh.vtu) is not compared: the
// mesh step makes a rounding difference of WebAssembly large. The counts of
// the FRAM rejection reasons (rejections.dat) are not compared either: in
// the examples, a rounding difference changes the reason of some rejected
// fractures (by a few in thousands); the final network is the same.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { FLOW_MESH_FILE } from "../src/flow/state";
import { InputFormError, networkToLibraryToml } from "../src/form/toml";
import { check_input, MeshStep, run_generation } from "../src/pkg/dfn_wasm.js";
import { tomlToWorkflow } from "../src/workflow";
import {
  compareOutputFolders,
  exampleNames,
  initWasm,
  meshPath,
  readExample,
  readMesh,
  runNativeDfngen,
  userFracturesFile,
} from "./cases";
import { USER_FRACTURES_FILE } from "../src/userFractures";

beforeAll(initWasm);

const UNCOMPARED_FILES = [FLOW_MESH_FILE, "rejections.dat"];
// Milliseconds: two generations of an example (WebAssembly and native)
const GENERATION_TIMEOUT = 60000;

describe.each(exampleNames)("example %s", (exampleName) => {
  test("the dfngen input of the network is valid", () => {
    const example = readExample(exampleName);
    const { network, boundaries } = tomlToWorkflow(example.toml);
    expect(check_input(networkToLibraryToml(network, boundaries), readMesh(network.domain), userFracturesFile(network))).toBeUndefined();
  });

  test("the dfngen input of the network gives the output of the native binary", () => {
    const example = readExample(exampleName);
    const { network, boundaries } = tomlToWorkflow(example.toml);
    const userFractures = userFracturesFile(network);
    const result = run_generation(networkToLibraryToml(network, boundaries), readMesh(network.domain), userFractures, 1n, MeshStep.Make, () => {});
    expect(result.error).toBeUndefined();
    const wasmDir = mkdtempSync(join(tmpdir(), `dfn-wasm-${exampleName}-`));
    for (const name of result.file_names.filter((fileName: string) => !UNCOMPARED_FILES.includes(fileName))) {
      writeFileSync(join(wasmDir, name), result.file(name) ?? "");
    }

    // The native binary reads the mesh at its full path, and the fracture file next to its input
    network.domain = meshPath(network.domain);
    const inputDir = mkdtempSync(join(tmpdir(), `dfngen-input-${exampleName}-`));
    if (userFractures !== undefined) {
      writeFileSync(join(inputDir, USER_FRACTURES_FILE), userFractures);
    }
    writeFileSync(join(inputDir, "input.toml"), networkToLibraryToml(network, boundaries));
    const nativeDir = runNativeDfngen(join(inputDir, "input.toml"));
    for (const name of UNCOMPARED_FILES) {
      rmSync(join(nativeDir, name), { force: true });
    }
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

const BOX = readExample("box_west_east").toml;

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

test("p32_target with n_poly is an error", () => {
  const toml = BOX.replace("[[network.family]]", "[[network.family]]\np32_target = 1.0");
  expect(problemsOf(toml)).toContain("network family 1: `p32_target` is not allowed with `n_poly`");
});

test("an unknown aperture distribution is an error", () => {
  const toml = BOX.replace('aperture = { distribution = "constant"', 'aperture = { distribution = "cubic"');
  expect(problemsOf(toml)).toEqual([
    'network family 1: aperture: `distribution` must be "constant", "log_normal", "correlated" or "semi_correlated"',
  ]);
});

const USER_FRACTURES = readExample("user_fractures_stochastic").toml;

test("the user fracture of the example is read with all its keys", () => {
  expect(tomlToWorkflow(USER_FRACTURES).network.userFractures).toEqual([
    {
      region: "box",
      center: [5, 5, 5],
      numberOfPoints: 4,
      radius: 7.78,
      aspectRatio: 0.545,
      beta: 0,
      aperture: 3e-4,
      orientation: { convention: "theta_phi", firstAngle: 90, secondAngle: 90 },
    },
  ]);
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

test("the dfngen input names the fracture file only with user fractures", () => {
  expect(networkLibraryToml(USER_FRACTURES)).toMatch(/^user_fractures = "user_fractures\.vtp"$/m);
  expect(networkLibraryToml(BOX)).not.toMatch(/^user_fractures =/m);
});

test("an unknown key in [flow] is an error", () => {
  const toml = BOX.replace("[flow]", '[flow]\nmesh = "dfn_mesh.vtu"');
  expect(problemsOf(toml)).toEqual(["[flow]: `mesh` is an unknown key"]);
});

test("a pressure which is not a number is an error", () => {
  const toml = BOX.replace("west = 10.1", 'west = "high"');
  expect(problemsOf(toml)).toEqual(["[flow]: pressure: `west` must be a number"]);
});

test("an unknown seeding method is an error", () => {
  const toml = BOX.replace('method = "uniform_per_line"', 'method = "everywhere"');
  expect(problemsOf(toml)).toContain(
    '[transport.seeding]: `method` must be "uniform_per_line", "equidistant", "random", "flux_weighted", "at_nodes"',
  );
});

test("a seed larger than 2^53 is kept", () => {
  const toml = BOX.replace(/^\[network\]\nseed = \d+$/m, "[network]\nseed = 18446744073709551615");
  expect(tomlToWorkflow(toml).network.seed).toBe("18446744073709551615");
});
