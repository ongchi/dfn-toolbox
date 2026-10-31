// The WebAssembly module gives the same output files as the native binary.
//
// The math functions of wasm32 (libm) and of the native platform can round
// differently, thus the decimal numbers are compared with the tolerance of
// the regression check (scripts/compare_output.py). The mesh step makes a
// difference of the last digit large, thus the triangle mesh (dfn_mesh.vtu)
// is not compared: the test checks that it is a valid mesh with the arrays
// of the native file.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import {
  check_input,
  resume_generation,
  run_generation,
  MeshStep,
  mesh_generation,
  RestartMode,
  type GenerationResult,
} from "../src/pkg/dfn_wasm.js";
import { caseNames, compareOutputFolders, initWasm, readCase, runNativeBinary } from "./cases";

const MESH_FILE = "dfn_mesh.vtu";
const TRIANGLE_TYPE = "5";

beforeAll(initWasm);

interface MeshSummary {
  pointCount: number;
  cellCount: number;
  /** Each cell is a triangle with 3 points of the mesh */
  isTriangleMesh: boolean;
  arrayNames: string[];
}

/** The text of the DataArray with the name, as numbers */
function dataArray(vtuText: string, name: string): number[] {
  const match = new RegExp(`<DataArray[^>]*Name="${name}"[^>]*>([^<]*)</DataArray>`).exec(vtuText);
  return match === null ? [] : match[1].trim().split(/\s+/).map(Number);
}

function summarizeMesh(vtuText: string): MeshSummary {
  const piece = /<Piece NumberOfPoints="(\d+)" NumberOfCells="(\d+)">/.exec(vtuText);
  const pointCount = Number(piece?.[1] ?? 0);
  const cellCount = Number(piece?.[2] ?? 0);
  const connectivity = dataArray(vtuText, "connectivity");
  const types = dataArray(vtuText, "types");
  const isTriangleMesh =
    types.length === cellCount &&
    types.every((type) => String(type) === TRIANGLE_TYPE) &&
    connectivity.length === 3 * cellCount &&
    connectivity.every((index) => Number.isInteger(index) && index >= 0 && index < pointCount);
  const arrayNames = [...vtuText.matchAll(/<DataArray[^>]*Name="([^"]+)"/g)].map((match) => match[1]);
  return { pointCount, cellCount, isTriangleMesh, arrayNames };
}

describe.each(caseNames)("case %s", (caseName) => {
  test("output files agree with the native binary", () => {
    const files = readCase(caseName);
    const result = run_generation(files.toml, files.mesh, files.userFractures, 1n, MeshStep.Make, () => {});
    expect(result.error).toBeUndefined();

    const wasmDir = mkdtempSync(join(tmpdir(), `dfn-wasm-${caseName}-`));
    for (const name of result.file_names) {
      if (name !== MESH_FILE) {
        writeFileSync(join(wasmDir, name), result.file(name) ?? "");
      }
    }
    const nativeDir = runNativeBinary(caseName);
    rmSync(join(nativeDir, MESH_FILE), { force: true });
    expect(compareOutputFolders(nativeDir, wasmDir)).toBe("");
  });

  test("the mesh is a triangle mesh with the arrays of the native mesh", () => {
    const files = readCase(caseName);
    const result = run_generation(files.toml, files.mesh, files.userFractures, 1n, MeshStep.Make, () => {});
    const nativeDir = runNativeBinary(caseName);
    const hasNativeMesh = existsSync(join(nativeDir, MESH_FILE));
    expect(result.file_names.includes(MESH_FILE)).toBe(hasNativeMesh);
    if (!hasNativeMesh) {
      return;
    }

    const wasmMesh = summarizeMesh(result.file(MESH_FILE) ?? "");
    const nativeMesh = summarizeMesh(readFileSync(join(nativeDir, MESH_FILE), "utf8"));
    expect(wasmMesh.cellCount).toBeGreaterThan(0);
    expect(wasmMesh.isTriangleMesh).toBe(true);
    expect(wasmMesh.arrayNames).toEqual(nativeMesh.arrayNames);
  });
});

test("bad input gives the error message of the library", () => {
  const files = readCase("base");
  const toml = files.toml.replace("seed = 12345", "seed = 12345\nsede = 1");
  expect(check_input(toml, files.mesh, files.userFractures)?.message).toMatch(/unknown field `sede`/);
});

test("a network with no connecting cluster keeps its clusters and tells it", () => {
  // With 100 fractures, no cluster of the case connects the faces west and east
  const files = readCase("clusters_connect_surfaces");
  const toml = files.toml.replace(/^n_poly = 300$/m, "n_poly = 100");
  const result = run_generation(toml, files.mesh, files.userFractures, 1n, MeshStep.Make, () => {});
  expect([result.error, result.final_count > 0, result.is_without_connecting_cluster]).toEqual([
    undefined,
    true,
    true,
  ]);
});

test("a network with a connecting cluster does not tell it", () => {
  const files = readCase("clusters_connect_surfaces");
  const result = run_generation(files.toml, files.mesh, files.userFractures, 1n, MeshStep.Make, () => {});
  expect(result.is_without_connecting_cluster).toBe(false);
});

test("progress is reported", () => {
  const files = readCase("base");
  const fractions: number[] = [];
  run_generation(files.toml, files.mesh, files.userFractures, 1n, MeshStep.Make, (_count: number, fraction: number) => {
    fractions.push(fraction);
  });
  expect(fractions.at(-1)).toBe(1);
});

/** All output files of a result, by name */
function outputFiles(result: GenerationResult): Map<string, string> {
  return new Map(result.file_names.map((name: string) => [name, result.file(name) ?? ""]));
}

/** The checkpoint of a run of the case after the accepted stochastic fracture `acceptedCount` */
function checkpointAt(caseName: string, acceptedCount: number): Uint8Array {
  const files = readCase(caseName);
  let checkpoint: Uint8Array | undefined;
  run_generation(
    files.toml,
    files.mesh,
    files.userFractures,
    1n,
    MeshStep.Make,
    (count: number) => count === acceptedCount,
    (bytes: Uint8Array) => {
      checkpoint = bytes;
    },
  );
  expect(checkpoint).toBeDefined();
  return checkpoint as Uint8Array;
}

// The mesh step too: both runs are in WebAssembly
test.each(["base", "mesh"])("a restart of %s from a checkpoint gives the files of a run with no stop", (caseName) => {
  const files = readCase(caseName);
  const full = run_generation(files.toml, files.mesh, files.userFractures, 1n, MeshStep.Make, () => {});
  const restarted = resume_generation(
    files.toml,
    files.mesh,
    files.userFractures,
    checkpointAt(caseName, 40),
    RestartMode.Continue,
    MeshStep.Make,
    () => {},
  );
  expect(restarted.error).toBeUndefined();
  expect(outputFiles(restarted)).toEqual(outputFiles(full));
});

test("the network of a checkpoint has the fractures until the checkpoint", () => {
  const files = readCase("base");
  const result = resume_generation(
    files.toml,
    files.mesh,
    files.userFractures,
    checkpointAt("base", 40),
    RestartMode.Finish,
    MeshStep.Make,
    () => {},
  );
  expect(result.accepted_count).toBe(40);
});

test("a restart with another input gives its error", () => {
  const files = readCase("base");
  const result = resume_generation(
    files.toml.replace("seed = 12345", "seed = 1"),
    files.mesh,
    files.userFractures,
    checkpointAt("base", 40),
    RestartMode.Continue,
    MeshStep.Make,
    () => {},
  );
  expect(result.error?.kind).toBe("dfngen.CheckpointInputChanged");
});

describe("the mesh step after a generation with no mesh", () => {
  /** The checkpoint after the last fracture of a run */
  function lastCheckpoint(caseName: string): Uint8Array | undefined {
    const files = readCase(caseName);
    let checkpoint: Uint8Array | undefined;
    run_generation(
      files.toml,
      files.mesh,
      files.userFractures,
      1n,
      MeshStep.Skip,
      (_count: number, fraction: number) => fraction >= 1,
      (bytes: Uint8Array) => {
        checkpoint = bytes;
      },
    );
    return checkpoint;
  }

  function meshOf(caseName: string, currentToml?: string): GenerationResult {
    const files = readCase(caseName);
    return mesh_generation(
      files.toml,
      currentToml ?? files.toml,
      files.mesh,
      files.userFractures,
      files.userFractures,
      1n,
      lastCheckpoint(caseName),
    );
  }

  test("a generation with no mesh has no mesh file", () => {
    const files = readCase("mesh");
    const result = run_generation(files.toml, files.mesh, files.userFractures, 1n, MeshStep.Skip, () => {});
    expect(result.file_names).not.toContain(MESH_FILE);
  });

  test.each(["mesh", "mesh_regions", "mesh_user_fractures", "clusters_connect_surfaces_mesh"])(
    "%s: the mesh step gives the files of one run",
    (caseName) => {
      const files = readCase(caseName);
      const full = run_generation(files.toml, files.mesh, files.userFractures, 1n, MeshStep.Make, () => {});
      expect(outputFiles(meshOf(caseName))).toEqual(outputFiles(full));
    },
  );

  test("the mesh step after a stop gives the network of the checkpoint", () => {
    const files = readCase("mesh");
    const checkpoint = checkpointAt("mesh", 40);
    const finished = resume_generation(
      files.toml,
      files.mesh,
      files.userFractures,
      checkpoint,
      RestartMode.Finish,
      MeshStep.Make,
      () => {},
    );
    const meshed = mesh_generation(
      files.toml,
      files.toml,
      files.mesh,
      files.userFractures,
      files.userFractures,
      1n,
      checkpoint,
    );
    expect(outputFiles(meshed)).toEqual(outputFiles(finished));
  });

  test("the current mesh options give a new mesh of the same fractures", () => {
    const files = readCase("mesh");
    const full = outputFiles(run_generation(files.toml, files.mesh, files.userFractures, 1n, MeshStep.Make, () => {}));
    const current = files.toml.replace(/^max_size_factor = .*$/m, "max_size_factor = 2");
    expect(current).not.toBe(files.toml);
    const result = meshOf("mesh", current);
    expect(result.error).toBeUndefined();
    const meshed = outputFiles(result);
    expect(meshed.get(MESH_FILE)).not.toEqual(full.get(MESH_FILE));
    expect(meshed.get("fractures.vtp")).toEqual(full.get("fractures.vtp"));
  });

  test("another number of families is an error", () => {
    const files = readCase("mesh");
    const current = files.toml.slice(0, files.toml.lastIndexOf("[[family]]"));
    expect(meshOf("mesh", current).error?.kind).toBe("dfngen.CheckpointInputChanged");
  });
});
