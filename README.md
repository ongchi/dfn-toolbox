# dfn-web

A static web app for dfngen (generation of a discrete fracture network),
fehm (steady water flow in the network) and dfntrans (particle tracking in
the flow): <https://ongchi.github.io/dfn-web/>.
This is a preliminary version.

The project needs the repositories of the three libraries in sibling folders:

- `../dfngen-rs` ([ongchi/dfngen-rs](https://github.com/ongchi/dfngen-rs)):
  `dfn-wasm` uses it as a Cargo path dependency, and the build and the tests
  use its test cases (`tests/data`), its binary and its scripts.
- `../fehm-rs` ([ongchi/fehm-rs](https://github.com/ongchi/fehm-rs)):
  `dfn-wasm` uses it as a Cargo path dependency, and the tests use its
  binary.
- `../dfntrans-rs` ([ongchi/dfntrans-rs](https://github.com/ongchi/dfntrans-rs)):
  `dfn-wasm` uses it as a Cargo path dependency, and the tests use its
  binary.

The generation, the flow and the transport run in the browser (WebAssembly), and the 3D
view uses [VTK.wasm](https://kitware.github.io/vtk-wasm/).
There is no server: `npm run build` gives a folder of static files.

- Network tab: a form with one field for each key of the input file (see
  "Input file" in `../dfngen-rs/README.md`), and the mesh file and the
  user-defined fracture file. The 27 cases of `tests/data` are examples.
  "Open files…" reads a TOML input file with its mesh and fracture files
  (select all of them; the files are found by their names). "Save TOML"
  writes the input of the form, for the `dfngen` binary.
- Flow tab: a form with one field for each key of the fehm input file (see
  "Input file" in `../fehm-rs/README.md`). The mesh is the `dfn_mesh.vtu` of
  the last generation (a network with `[mesh]`); the boundaries are its
  point arrays `boundary__<name>`, each with "use" and a pressure. "Save
  TOML" writes `flow.toml`, for the `fehm` binary with the downloaded
  `dfn_mesh.vtu`. A new generation removes the flow output; a boundary with
  the same name keeps its values.
- Transport tab: a form with one field for each key of the dfntrans input
  file (see "Input file" in `../dfntrans-rs/README.md`). It uses the flow
  of the last "Solve flow": dfntrans solves the flow input of that run
  again. Each boundary array of the mesh is "not used", "in-flow" or
  "out-flow". "Save TOML" writes `transport.toml` with
  `flow = "flow.toml"`. A new flow removes the transport output.
  `trajectories.vtp` has a point for each time step: with many particles
  it is very large (229 MB for 363 particles on the mesh of
  `mesh_regions`), thus the option is off by default.
- "Check input" shows the error of the library for the input of the active
  tab. "Generate", "Solve flow" and "Track particles" run in a Web Worker;
  "Cancel" stops them.
- Output: the 3D view of `fractures.vtp` (color by a cell array),
  `fractures_removed.vtp`, `fractures_rejected.vtp`, the mesh, and the
  pressure of the flow (layer "Pressure"; it hides the fracture layers), the
  particle paths (layer "Trajectories": tubes, with cones in the direction
  of the velocity at every n-th point, about 20 for each path and at most
  500); the logs; the mass flow of each
  boundary; the particle counts and the volume fluxes of the transport; each
  output file, and the output of the generation, of the flow and of the
  transport as one `.zip` each.

The output is that of the `dfngen` binary for the same input and seed.
The math functions of WebAssembly (`libm`) and of the native platform can
round differently in the last digits, thus the decimal numbers can differ
by about 1e-15 (relative). A FRAM decision can then also be different, and
the network changes; the 27 cases have no such difference. The triangle mesh
(`dfn_mesh.vtu`, with `[mesh]`) is different: the mesh step makes a
difference in the last digit large, thus the mesh of WebAssembly can have
other points and triangles than the mesh of the binary. This is accepted.
The flow on the same mesh is that of the `fehm` binary (within 1e-9). The
transport on the same mesh has the particle paths of the `dfntrans` binary
(the same time steps and fractures); the times add up the rounding
differences over thousands of time steps (up to about 1e-6, relative).

## Folders

| Folder | Content |
|---|---|
| `dfn-wasm` | Rust crate: `wasm-bindgen` functions of the libraries: `generation.rs` (`input_file_names`, `check_input`, `run_generation`), `flow.rs` (`check_flow_input`, `run_flow`) and `transport.rs` (`check_transport_input`, `run_transport`). Not a member of a workspace. |
| `app` | Vite + TypeScript front end. |
| `app/src/form` | The network form. `state.ts` has the form state, `toml.ts` the conversion to and from TOML, and one file for each section. |
| `app/src/flow` | The flow form (`state.ts`, `toml.ts`: only to TOML, `form.ts`), and `polyData.ts`: `pressure.vtu` as PolyData for the view. |
| `app/src/transport` | The transport form (`state.ts`, `toml.ts`: only to TOML, `form.ts`), and `trajectories.ts`: `velocity` as the active vectors of `trajectories.vtp`, for the cones of the view. |
| `app/src/viewer.ts` | The 3D view (VTK.wasm). |
| `app/src/worker.ts`, `app/src/generationClient.ts` | The Web Worker of the generation, the flow and the transport, and its interface for the page. |
| `app/tests` | `vitest` tests (Node). |
| `app/scripts/e2e.mjs` | End-to-end check in the local Chrome. |

## Build

Necessary: Node, the Rust target `wasm32-unknown-unknown`, and
`wasm-bindgen-cli` with the version of `wasm-bindgen` in
`dfn-wasm/Cargo.toml`:

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129 --locked
```

Then, in `app`:

```bash
npm ci
npm run setup     # VTK.wasm bundle and its types (fetch-vtk.sh), WebAssembly module and examples (build-wasm.sh)
npm run dev       # development server
npm run build     # static files in dist/
```

After a change of a library or of `dfn-wasm`: `npm run wasm`.

`fetch-vtk.sh` downloads a fixed weekly build of VTK.wasm (13 MB, with a
SHA-256 check) into `public/vtk`. The app loads it from there, not from a
CDN. To use another build, change `VERSION` and `SHA256` in the script; the
TypeScript types are generated from the bundle.

## Publication

`.github/workflows/pages.yml` publishes the site on GitHub Pages at each
push to `master` (or when it is started by hand). It checks out
`dfngen-rs`, `fehm-rs` and `dfntrans-rs` (branch `master`) next to
`dfn-web` and runs
`build-site.sh <base path>`: install, VTK.wasm, WebAssembly module, native
binaries, `npm test`, and `npm run build`. A failed test stops the
workflow before the deploy. The same script makes the site locally
(`npm ci` replaces `app/node_modules`):

```bash
./build-site.sh /dfn-web/   # the site in app/dist, for the path /dfn-web/
```

The Pages source of the repository must be "GitHub Actions".

## Tests

```bash
cargo build --release   # in ../dfngen-rs, ../fehm-rs and ../dfntrans-rs: the tests compare with the binaries
npm test                # in app
npm run dev & npm run e2e -- http://localhost:5173/
```

- `tests/wasm.test.ts`: each case of `tests/data` gives, in WebAssembly, the
  output files of the binary (decimal numbers within 1e-9, with
  `scripts/compare_output.py`), except `dfn_mesh.vtu`: it must be a
  triangle mesh with the arrays of the mesh of the binary; errors and
  progress.
- `tests/form.test.ts`: each case, TOML → form → TOML, is a valid input and
  gives the same output files; an unknown key, a missing key,
  `p32_target` with `n_poly` and an unknown aperture distribution are
  errors of the form.
- `tests/flow.test.ts`: on the mesh of the case `mesh_regions` (generated in
  WebAssembly), the TOML of the flow form is a valid input, the output files
  agree with the `fehm` binary (within 1e-9), the in-flow is equal to the
  out-flow, and a boundary array with no point and no boundary are errors.
- `tests/transport.test.ts`: on the flow of the mesh of `mesh_regions`
  (from north to the mesh surface), the TOML of the transport form is a
  valid input, the output files agree with the `dfntrans` binary (the
  integers exactly, the decimal numbers within 1e-5), some particles exit,
  and no in-flow boundary and an unknown boundary are errors.
- `scripts/e2e.mjs`: in Chrome (headless), each example, a bad input, the
  cancel, the layers of the view, the flow (without a mesh, and on the
  mesh of `mesh_regions`), and the transport (without a flow, and on that
  flow with the trajectories); it saves screenshots.

## VTK.wasm notes

- The bundle has no `vtkDataSetMapper` and no geometry filter: the domain
  mesh is shown as its cell edges (`vtkExtractEdges`), and `pressure.vtu`
  (only triangles) is changed into PolyData text before it is read.
- The XML readers read from a string (`readFromInputStringOn`,
  `setInputString`), thus the app has no VTK file parser.
- Change VTK objects with their setter methods. An assignment to a property
  (`mapper.scalarVisibility = 1`) can set other properties back: it gave the
  mapper its old lookup table.
- Add 2D actors (scalar bar) with `addViewProp`.

## License

dfn-web: LGPL-3.0 (`LICENSE.md`), as dfngen-rs. The site includes compiled
code of [dfngen-rs](https://github.com/ongchi/dfngen-rs) (LGPL-3.0; it is a
port of dfnWorks, LANL), [fehm-rs](https://github.com/ongchi/fehm-rs)
(BSD-3-Clause; based on FEHM, LANL),
[dfntrans-rs](https://github.com/ongchi/dfntrans-rs) (LGPL-3.0; a port of
DFNTrans of dfnWorks, LANL LA-CC-14-091) and
[VTK.wasm](https://kitware.github.io/vtk-wasm/) (BSD-3-Clause).
