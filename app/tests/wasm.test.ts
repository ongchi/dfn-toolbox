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
import { check_input, run_generation } from "../src/pkg/dfn_wasm.js";
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
    const result = run_generation(files.toml, files.mesh, files.userFractures, 1n, () => {});
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
    const result = run_generation(files.toml, files.mesh, files.userFractures, 1n, () => {});
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
  expect(check_input(toml, files.mesh, files.userFractures)).toMatch(/unknown field `sede`/);
});

test("progress is reported", () => {
  const files = readCase("base");
  const fractions: number[] = [];
  run_generation(files.toml, files.mesh, files.userFractures, 1n, (_count: number, fraction: number) => {
    fractions.push(fraction);
  });
  expect(fractions.at(-1)).toBe(1);
});
