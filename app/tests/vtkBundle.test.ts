// The page and the build must use one VTK.wasm bundle.
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { BUNDLE_SHA256 } from "../src/vtkBundle";

test("the page checks the SHA-256 of the bundle of the build", () => {
  const fetchScript = readFileSync(new URL("../../fetch-vtk.sh", import.meta.url), "utf8");
  expect(fetchScript).toContain(`SHA256="${BUNDLE_SHA256}"`);
});
