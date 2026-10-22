// The form keeps each value of the input: TOML -> form -> TOML gives the
// same network for each case of tests/data.
import { beforeAll, describe, expect, test } from "vitest";
import { formStateToToml, InputFormError, tomlToFormState } from "../src/form/toml";
import { check_input, run_generation } from "../src/pkg/dfn_wasm.js";
import { caseNames, initWasm, readCase } from "./cases";

beforeAll(initWasm);

function outputFiles(toml: string, caseName: string): Map<string, string> {
  const files = readCase(caseName, toml);
  const result = run_generation(files.toml, files.mesh, files.userFractures, 1n, () => {});
  expect(result.error).toBeUndefined();
  return new Map(result.file_names.map((name: string) => [name, result.file(name) ?? ""]));
}

describe.each(caseNames)("case %s", (caseName) => {
  test("the TOML of the form is a valid input", () => {
    const original = readCase(caseName);
    const toml = formStateToToml(tomlToFormState(original.toml));
    expect(check_input(toml, original.mesh, original.userFractures)).toBeUndefined();
  });

  test("the TOML of the form gives the same network", () => {
    const original = readCase(caseName);
    const toml = formStateToToml(tomlToFormState(original.toml));
    expect(outputFiles(toml, caseName)).toEqual(outputFiles(original.toml, caseName));
  });

  test("a second round trip does not change the TOML", () => {
    const toml = formStateToToml(tomlToFormState(readCase(caseName).toml));
    expect(formStateToToml(tomlToFormState(toml))).toBe(toml);
  });
});

function problemsOf(toml: string): string[] {
  try {
    tomlToFormState(toml);
  } catch (error) {
    if (error instanceof InputFormError) {
      return error.problems;
    }
    throw error;
  }
  return [];
}

test("an unknown key is an error", () => {
  const toml = readCase("base").toml.replace("[clusters]", "[clusters]\nkeep_all = true");
  expect(problemsOf(toml)).toEqual(["[clusters]: `keep_all` is an unknown key"]);
});

test("a missing key is an error", () => {
  const toml = readCase("base").toml.replace(/^min_feature_size = .*$/m, "");
  expect(problemsOf(toml)).toEqual(["`min_feature_size` is missing"]);
});

test("p32_target with n_poly is an error", () => {
  const toml = readCase("base").toml.replace("[[family]]", "[[family]]\np32_target = 1.0");
  expect(problemsOf(toml)).toContain("family 1: `p32_target` is not allowed with `n_poly`");
});

test("an unknown key in [mesh] is an error", () => {
  const toml = readCase("mesh").toml.replace(/^\[mesh\]$/m, "[mesh]\nmin_angle = 20.0");
  expect(problemsOf(toml)).toEqual(["[mesh]: `min_angle` is an unknown key"]);
});

test("an unknown aperture distribution is an error", () => {
  const toml = readCase("mesh").toml.replace('distribution = "correlated"', 'distribution = "cubic"');
  expect(problemsOf(toml)).toEqual([
    'family 2: aperture: `distribution` must be "constant", "log_normal", "correlated" or "semi_correlated"',
  ]);
});

test("a seed larger than 2^53 is kept", () => {
  const toml = readCase("base").toml.replace("seed = 12345", "seed = 18446744073709551615");
  expect(tomlToFormState(toml).seed).toBe("18446744073709551615");
});
