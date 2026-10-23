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
import { check_input, run_generation } from "../src/pkg/dfn_wasm.js";
import { tomlToWorkflow } from "../src/workflow";
import { compareOutputFolders, exampleNames, initWasm, readExample, runNativeDfngen } from "./cases";

beforeAll(initWasm);

const UNCOMPARED_FILES = [FLOW_MESH_FILE, "rejections.dat"];
// Milliseconds: two generations of an example (WebAssembly and native)
const GENERATION_TIMEOUT = 60000;

describe.each(exampleNames)("example %s", (exampleName) => {
  test("the dfngen input of the network is valid", () => {
    const example = readExample(exampleName);
    const network = tomlToWorkflow(example.toml).network;
    const userFractures = network.userFractures === null ? undefined : example.readFile(network.userFractures);
    expect(check_input(networkToLibraryToml(network), example.readFile(network.domain), userFractures)).toBeUndefined();
  });

  test("the dfngen input of the network gives the output of the native binary", () => {
    const example = readExample(exampleName);
    const network = tomlToWorkflow(example.toml).network;
    const userFractures = network.userFractures === null ? undefined : example.readFile(network.userFractures);
    const result = run_generation(networkToLibraryToml(network), example.readFile(network.domain), userFractures, 1n, () => {});
    expect(result.error).toBeUndefined();
    const wasmDir = mkdtempSync(join(tmpdir(), `dfn-wasm-${exampleName}-`));
    for (const name of result.file_names.filter((fileName: string) => !UNCOMPARED_FILES.includes(fileName))) {
      writeFileSync(join(wasmDir, name), result.file(name) ?? "");
    }

    // The native binary reads the files at their full paths
    network.domain = example.path(network.domain);
    network.userFractures = network.userFractures === null ? null : example.path(network.userFractures);
    const inputDir = mkdtempSync(join(tmpdir(), `dfngen-input-${exampleName}-`));
    writeFileSync(join(inputDir, "input.toml"), networkToLibraryToml(network));
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

test("enable in [network.region_boundaries] is an error: the boundary lines are always on", () => {
  const toml = BOX.replace("[network.region_boundaries]", "[network.region_boundaries]\nenable = true");
  expect(problemsOf(toml)).toEqual(["[network.region_boundaries]: `enable` is an unknown key"]);
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
