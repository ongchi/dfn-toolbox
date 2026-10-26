# dfn-web

A static web app for dfngen (generation of a discrete fracture network),
fehm (steady water flow in the network) and dfntrans (particle tracking in
the flow): <https://ongchi.github.io/dfn-web/>.
This is a preliminary version.

The project needs the repositories of the three libraries in sibling folders:

- `../dfngen-rs` ([ongchi/dfngen-rs](https://github.com/ongchi/dfngen-rs)):
  `dfn-wasm` uses it as a Cargo path dependency, and the tests use its test
  cases (`tests/data`), its binary and its scripts.
- `../fehm-rs` ([ongchi/fehm-rs](https://github.com/ongchi/fehm-rs)):
  `dfn-wasm` uses it as a Cargo path dependency, and the tests use its
  binary.
- `../dfntrans-rs` ([ongchi/dfntrans-rs](https://github.com/ongchi/dfntrans-rs)):
  `dfn-wasm` uses it as a Cargo path dependency, and the tests use its
  binary.

The generation, the flow and the transport run in the browser (WebAssembly), and the 3D
view uses [VTK.wasm](https://kitware.github.io/vtk-wasm/).
There is no server: `npm run build` gives a folder of static files.

- The input of the three tabs is one workflow file (see "Workflow file").
  The four workflow examples of `examples/` run the full workflow.
  "Open files…" reads a workflow file with its mesh and fracture files
  (select all of them; the files are found by their names). "Save input"
  writes the workflow file of the three tabs. The app does not write the
  input files of the `dfngen`, `fehm` and `dfntrans` binaries.
- Network tab: a form with one field for each key of `[network]`, and the
  mesh file and the user-defined fracture file. The boundary lines of the
  regions and the triangle mesh are always on (the flow needs them), thus
  each family needs an aperture.
- Flow tab: a form with one field for each key of `[flow]`. The mesh is the
  `dfn_mesh.vtu` of the last generation; the boundaries are its point
  arrays `boundary__<name>`, each with "use" and a pressure. A new
  generation removes the flow output; a boundary with the same name keeps
  its values, and a used boundary of no array stays (fehm then reports it).
- Transport tab: a form with one field for each key of `[transport]`. It
  uses the flow of the last "Solve flow": dfntrans solves the flow input of
  that run again. Each boundary array of the mesh is "not used", "in-flow"
  or "out-flow". A new flow removes the transport output.
  `trajectories.vtp` has a point for each time step: with many particles
  it is very large (about 1 MB for each particle in the examples), thus the
  option is off by default; the examples have it on, with few particles.
- "Check input" shows the error of the library for the input of the active
  tab. "Generate", "Solve flow" and "Track particles" run in a Web Worker;
  "Cancel" stops them.
- Output: the 3D view of the triangle mesh `dfn_mesh.vtu` of the final
  fractures (with its edges; color by a cell array),
  `fractures_removed.vtp`, `fractures_rejected.vtp`, the mesh, and the
  pressure of the flow (layer "Pressure"; it hides the fracture layers), the
  particle paths (layer "Trajectories": tubes, with cones in the direction
  of the velocity at every n-th point, about 20 for each path and at most
  500); the logs; the mass flow of each
  boundary; the particle counts and the volume fluxes of the transport; each
  output file; and one `.zip` with the workflow file (the input of each
  output) and the folders `network/`, `flow/` and `transport/`.

The output is that of the `dfngen` binary for the same input and seed.
The math functions of WebAssembly (`libm`) and of the native platform can
round differently in the last digits, thus the decimal numbers can differ
by about 1e-15 (relative). A FRAM decision can then also be different, and
the network changes; the 27 cases of `tests/data` and the examples have no
such difference. In the examples, the reason of a few rejected fractures is
different (`rejections.dat`), not the network. The triangle mesh
(`dfn_mesh.vtu`) is different: the mesh step makes a difference in the last
digit large, thus the mesh of WebAssembly can have
other points and triangles than the mesh of the binary. This is accepted.
The flow on the same mesh is that of the `fehm` binary (within 1e-9). The
transport on the same mesh has the particle paths of the `dfntrans` binary
(the same time steps and fractures); the times add up the rounding
differences over thousands of time steps (up to about 1e-6, relative).

## Workflow file

One TOML file with three sections. The comment at the top is the
description of the input. The app makes the input files of the libraries
from it: `[network]` → the dfngen input with `[region_boundaries]` and
`[mesh]` on, `[flow]` → the fehm input on `dfn_mesh.vtu`, `[transport]` →
the dfntrans input on that flow.

```toml
# Description of the input.

[network]                          # the dfngen input (see "Input file" in ../dfngen-rs/README.md)
seed = 12345
min_feature_size = 0.4
domain = "box_west_east.vtu"
user_fractures = "fractures.vtp"   # optional
[network.generation]               # as [generation]
[network.fram]                     # as [fram]; optional
[network.mesh]                     # optional; no [network.region_boundaries]: the boundary lines are always on
max_size_factor = 5.0              # no `enable`: always on
slope = 0.5
user_fracture_aperture = { distribution = "constant", value = 3e-4 }   # necessary with user_fractures
[network.clusters]                 # as [clusters]
[[network.family]]                 # as [[family]]; `aperture` is necessary

[flow]                             # the fehm input (see "Input file" in ../fehm-rs/README.md), without `mesh`
temperature = 20.0
gravity = false
pressure = { west = 10.1, east = 10.0 }   # MPa; the used boundaries, in place of [[boundary]]
[flow.solver]                      # optional: tolerance, max_iterations

[transport]                        # the dfntrans input (see "Input file" in ../dfntrans-rs/README.md), without `flow`
seed = 12345
time_unit = "days"
porosity = 1.0
max_time_steps = 1000000
inflow = ["west"]
outflow = ["east"]
routing = "complete_mixing"
[transport.seeding]
[transport.tdrw]                   # optional
[transport.control_planes]         # optional
[transport.output]
```

The reader is strict: an unknown key and a missing key are errors, so the
forms never lose a value. A boundary name of `[flow]` or `[transport]` is
checked only by "Solve flow" and "Track particles": the names are those of
the mesh of the generation.

## Examples

`examples/` has one folder for each example, with its workflow file
`<name>.toml`, its domain mesh and its fracture file (ASCII files, written
by hand). The in-flow and out-flow boundaries are boundary surfaces of the
domain mesh: surface cells (quads) with the cell data arrays
`boundary__<name>` (see "Domain mesh" in ../dfngen-rs/README.md). Where a
fracture crosses such a face, its boundary line gets the name, thus it is a
boundary of the flow. Only the mesh of `l_shape_north_east` has regions,
and only its families have a `region`.

| Example | Content |
|---|---|
| `box_west_east` | A cube of 10 m (`box_west_east.vtu`: one hexahedron and its 6 faces as quads; the face at x = 0 is the boundary surface west, the face at x = 10 east). One family; flow and particles from west to east. |
| `two_families` | The same cube, a family perpendicular and a family parallel to the flow, with a correlated aperture. |
| `l_shape_north_east` | An L-shaped domain of 4 boxes (`l_shape.vtu`: the west, middle and east boxes along x, and the north box at +y of the west box) with the regions `west_box`, `east_box` and `other_boxes` (the middle and the north box); the end face of the north box is the boundary surface north, the end face of the east box east. One family in each region (the region gives only the fracture centers, thus the fractures connect the regions); flow with gravity and particles from north to east. |
| `user_fractures_stochastic` | The same cube, a large user-defined fracture from west to east with a larger aperture, a stochastic family, and matrix diffusion. |

The seeds of the examples give a network which connects the in-flow and
the out-flow boundaries. Many other seeds do not: then no fracture reaches
a boundary, or a part of the network has no connection to a boundary (the
mesh cuts each fracture at the mesh surface, thus two fractures can lose an
intersection outside the mesh), and "Solve flow" reports it.

## Folders

| Folder | Content |
|---|---|
| `dfn-wasm` | Rust crate: `wasm-bindgen` functions of the libraries: `generation.rs` (`input_file_names`, `check_input`, `run_generation`), `flow.rs` (`check_flow_input`, `run_flow`) and `transport.rs` (`check_transport_input`, `run_transport`). Not a member of a workspace. |
| `examples` | The workflow examples (see "Examples"); `build-wasm.sh` copies them into `app/public/examples`. |
| `app` | Vite + TypeScript front end. |
| `app/src/workflow.ts` | The workflow file: reading (strict) and writing of the three sections. |
| `app/src/form` | The network form. `state.ts` has the form state, `toml.ts` the conversion between `[network]` and the state, the dfngen input, and the TOML helpers; one file for each section. |
| `app/src/flow` | The flow form (`state.ts`, `toml.ts`: `[flow]` and the fehm input, `form.ts`), and `polyData.ts`: `pressure.vtu` as PolyData for the view. |
| `app/src/transport` | The transport form (`state.ts`, `toml.ts`: `[transport]` and the dfntrans input, `form.ts`), and `trajectories.ts`: `velocity` as the active vectors of `trajectories.vtp`, for the cones of the view. |
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
- `tests/examples.test.ts`: each example, workflow file → forms → workflow
  file, gives the same state, and in WebAssembly runs the full workflow: the
  mesh has the boundaries of the file, the in-flow is equal to the
  out-flow, and particles exit.
- `tests/form.test.ts`: the dfngen input of each example is valid and gives
  the output files of the binary, except `dfn_mesh.vtu` and
  `rejections.dat` (a rounding difference changes the reason of some FRAM
  rejections; the final network is the same); the errors of the reader of
  the workflow file (an unknown key, a missing key or section, `enable` in
  `[network.mesh]`, a family without aperture, and others).
- `tests/flow.test.ts`: on the mesh of the example `l_shape_north_east`
  (generated in WebAssembly), the fehm input of the flow form is a valid
  input, the output files agree with the `fehm` binary (within 1e-9), the
  in-flow is equal to the out-flow, and a boundary array with no point and
  no boundary are errors.
- `tests/transport.test.ts`: on the flow of that example (from north to
  east), the dfntrans input of the transport form is a valid input,
  the output files agree with the `dfntrans` binary (the integers exactly,
  the decimal numbers within 1e-5), some particles exit, and no in-flow
  boundary and an unknown boundary are errors.
- `scripts/e2e.mjs`: in Chrome (headless), the full workflow of each
  example, the single zip, the save and the open of a workflow file, the
  flow without a mesh, the transport without a flow, a bad input and the
  cancel; it saves screenshots.

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
