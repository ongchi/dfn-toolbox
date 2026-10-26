// The text of the errors of dfngen, fehm and dfntrans for the user: real
// errors of the WebAssembly module (thus the kinds and the values of
// dfn-wasm), and the internal errors.
import { beforeAll, expect, test } from "vitest";
import { toolErrorText, toToolError } from "../src/errors";
import { check_flow_input, check_input, check_transport_input, type ErrorReport } from "../src/pkg/dfn_wasm.js";
import { initWasm, readCase } from "./cases";

beforeAll(initWasm);

/** The user text of a report; a valid input (no report) is a test failure */
function userText(report: ErrorReport | undefined): string {
  expect(report).toBeDefined();
  return toolErrorText(toToolError(report as ErrorReport));
}

/** The user text of the error of the dfngen case `base` with a changed TOML */
function networkErrorText(change: (toml: string) => string): string {
  const files = readCase("base");
  return userText(check_input(change(files.toml), files.mesh, files.userFractures));
}

// A mesh of one triangle with the boundary arrays west (point 0) and none (no point)
const MESH = `<?xml version="1.0"?>
<VTKFile type="UnstructuredGrid" version="1.0" byte_order="LittleEndian">
  <UnstructuredGrid>
    <Piece NumberOfPoints="3" NumberOfCells="1">
      <Points>
        <DataArray type="Float64" NumberOfComponents="3" format="ascii">0 0 0 1 0 0 0 1 0</DataArray>
      </Points>
      <Cells>
        <DataArray type="Int64" Name="connectivity" format="ascii">0 1 2</DataArray>
        <DataArray type="Int64" Name="offsets" format="ascii">3</DataArray>
        <DataArray type="UInt8" Name="types" format="ascii">5</DataArray>
      </Cells>
      <CellData>
        <DataArray type="Int32" Name="fracture_id" format="ascii">1</DataArray>
        <DataArray type="Float64" Name="aperture" format="ascii">1e-3</DataArray>
        <DataArray type="Float64" Name="permeability" format="ascii">1e-12</DataArray>
      </CellData>
      <PointData>
        <DataArray type="Int32" Name="boundary__west" format="ascii">1 0 0</DataArray>
        <DataArray type="Int32" Name="boundary__none" format="ascii">0 0 0</DataArray>
      </PointData>
    </Piece>
  </UnstructuredGrid>
</VTKFile>`;

const FLOW_TOML = `mesh = "mesh.vtu"
temperature = 20.0

[[boundary]]
name = "west"
pressure = 10.0
`;

const TRANSPORT_TOML = `flow = "flow.toml"
seed = 1
time_unit = "days"
porosity = 1.0
max_time_steps = 1000
inflow = ["west"]
outflow = ["none"]
routing = "complete_mixing"

[seeding]
method = "flux_weighted"
particle_count = 10
`;

test("a family region which the mesh does not have names the family and the region", () => {
  const text = networkErrorText((toml) => toml.replace("[[family]]", '[[family]]\nregion = "nowhere"'));
  expect(text).toBe("Family 1 (DFN tab): the domain has no region nowhere. Choose another region.");
});

test("a minimum feature size of 0 names the field of the form", () => {
  const text = networkErrorText((toml) => toml.replace("min_feature_size = 0.1", "min_feature_size = 0.0"));
  expect(text).toBe("Minimum feature size (DFN tab, General) must be greater than 0.");
});

test("a family with 2 points names the family", () => {
  const text = networkErrorText((toml) => toml.replace(/number_of_points = \d+/, "number_of_points = 2"));
  expect(text).toBe("Family 1 (DFN tab): Number of points must be 3 or more.");
});

test("a temperature outside the range gives the range of fehm", () => {
  const text = userText(check_flow_input(FLOW_TOML.replace("20.0", "400.0"), MESH));
  expect(text).toBe("Temperature (Flow tab) must be 15 to 360 °C.");
});

test("a boundary with no point names the boundary", () => {
  const text = userText(check_flow_input(FLOW_TOML.replace('"west"', '"none"'), MESH));
  expect(text).toBe(
    "The boundary none (Flow tab) has no point in the network. Do not use it, or generate another network.",
  );
});

test("a porosity above 1 names the field of the form", () => {
  const text = userText(check_transport_input(TRANSPORT_TOML.replace("porosity = 1.0", "porosity = 2.0"), FLOW_TOML, MESH));
  expect(text).toBe("Porosity (Transport tab) must be above 0 and at most 1.");
});

test("an error of the flow input of the transport is a text of the Flow tab", () => {
  const text = userText(check_transport_input(TRANSPORT_TOML, FLOW_TOML.replace("10.0", "200.0"), MESH));
  expect(text).toBe("The pressure of the boundary west (Flow tab) must be 0.001 to 110 MPa.");
});

test("an error of the file format is an internal error with the text of the library", () => {
  const text = networkErrorText((toml) => toml.replace("seed = 12345", "seed = 12345\nsede = 1"));
  expect(text).toMatch(/^Internal error: Invalid input file: .*unknown field `sede`/s);
});

test("an unknown kind is an internal error", () => {
  expect(toolErrorText({ kind: "dfngen.Other", message: "a defect", fields: {} })).toBe("Internal error: a defect");
});
