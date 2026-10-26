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
  The four workflow examples of `examples/` run the full workflow; the
  page opens `box_west_east` at the start. The app does not save the
  workflow file or the output files, and it does not write the input files
  of the `dfngen`, `fehm` and `dfntrans` binaries.
- The input of `[network]` is in three tabs: Domain, User fractures and
  DFN; "Generate" is on the DFN tab. The page opens on the Domain tab.
  "Next" goes to the next tab (each tab but Transport); on the DFN tab it
  needs the fracture mesh of a generation, on the Flow tab a solved flow.
  - Domain tab: two radio buttons. "Example" shows the example (a dropdown
    of `examples/`) and its description; an example loads the full
    workflow. "Predefined domain shape" shows the domain mesh: one of the
    predefined meshes of `meshes/` (a dropdown); a new shape replaces only
    the mesh. A switch of the radio buttons resets all the input: "Example"
    loads the example of its dropdown again (the default example if none),
    and "Predefined domain shape" gives the default values of all the forms
    on the last shape (the first mesh at the start).
  - User fractures tab: each user-defined fracture is a card (region,
    center, shape and orientation; see "User-defined fractures").
  - DFN tab: a form with one field for each other key of `[network]`.
    The boundary lines of the regions and the triangle mesh are always on
    (the flow needs them), thus each family needs an aperture.
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
- "Generate", "Solve flow" and "Track particles" run in a Web Worker;
  "Cancel" stops them. An error of the library shows in the status line,
  as a text of the app with the words of the forms (`app/src/errors.ts`:
  one text for each kind of error; a kind which the user cannot cause,
  such as the format of a file, is "Internal error" with the text of the
  library).
- Output: the 3D view of the triangle mesh `dfn_mesh.vtu` of the final
  fractures (layer "Mesh", with its edges; color by a cell array, or by
  the point pressure of the flow: "Pressure", selected when the flow is
  done; "Flow velocity": the magnitude of the `darcy_velocity` of each
  triangle of `pressure.vtu`, m/s; "Transport velocity", with the output
  `velocities` of the transport: the mean speed of the sectors of each
  point in `velocities.vtp`, in m/s), `fractures_removed.vtp`, `fractures_rejected.vtp`, the domain mesh
  (layer "Domain", a wireframe), the polygons of the user-defined
  fractures of the form (layer "User fractures", blue; updated at each
  change of the form, also before "Generate"), the particle paths (layer "Trajectories": tubes, with cones in the direction
  of the velocity at every n-th point, about 20 for each path and at most
  500); the mass flow of each boundary; the particle counts and the volume
  fluxes of the transport.

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
domain = "Box.vtu"                 # the name of a predefined mesh (`meshes/`); no `user_fractures`
[network.generation]               # as [generation]
[network.fram]                     # as [fram]; optional
[network.mesh]                     # optional; no [network.region_boundaries]: the boundary lines are always on
max_size_factor = 5.0              # no `enable`: always on
slope = 0.5
user_fracture_aperture = { distribution = "constant", value = 3e-4 }   # necessary with user fractures
[network.clusters]                 # as [clusters]
[[network.family]]                 # as [[family]]; `aperture` is necessary
[[network.user_fracture]]          # optional; one table for each user-defined fracture, all keys necessary
region = "box"                     # one region of the mesh
center = [5.0, 5.0, 5.0]           # m; in the bounding box of the cells of the region
number_of_points = 4               # as a family: 3 or more, 4 = rectangle
radius = 7.78                      # m; of the circle of the points
aspect_ratio = 0.545               # y radius / x radius
beta = 0.0                         # degrees; rotation in the plane of the fracture
orientation = { theta = 90.0, phi = 90.0 }   # the normal, as a family without kappa

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

### User-defined fractures

dfngen-rs reads user-defined fractures only as polygons (a `.vtp` file).
dfn-web makes the polygon of each `[[network.user_fracture]]` in the same
way as dfngen-rs makes a stochastic fracture (`app/src/userFractures.ts`):
a regular polygon of `number_of_points` on the circle of `radius`, y scaled
by `aspect_ratio`, turned by `beta` in its plane, rotated from the normal
+z to the normal of `orientation`, and moved to `center`. The polygon file
`user_fractures.vtp` of the dfngen input has a cell array
`region__<name>` for each region of the mesh, with 1 for the region of the
fracture. The form limits the center to the bounding box of the cells of
the region; a center in that box but outside the cells (possible in a
region which is not a box) is not checked.

## Examples

`examples/` has one folder for each example, with its workflow file
`<name>.toml` (written by hand). Its domain mesh is a predefined mesh of
`meshes/` (`Box.vtu`, `L-shape.vtu`; ASCII files written by hand); a new
`.vtu` file there is a new item of the dropdown, with its file name
without `.vtu` ("Box", "L-shape"). The in-flow and out-flow boundaries are
boundary surfaces of the domain mesh: surface cells (quads) with the cell
data arrays `boundary__<name>` (see "Domain mesh" in
../dfngen-rs/README.md). Where a fracture crosses such a face, its boundary
line gets the name, thus it is a boundary of the flow. `Box.vtu` has the
region `box` (its hexahedron) for the user-defined fracture of
`user_fractures_stochastic`; `L-shape.vtu` has the regions `west_box`,
`east_box` and `other_boxes`, and only the families of
`l_shape_north_east` have a `region`.

| Example | Content |
|---|---|
| `box_west_east` | A cube of 10 m (`Box.vtu`: one hexahedron and its 6 faces as quads; the face at x = 0 is the boundary surface west, the face at x = 10 east). One family; flow and particles from west to east. |
| `two_families` | The same cube, a family perpendicular and a family parallel to the flow, with a correlated aperture. |
| `l_shape_north_east` | An L-shaped domain of 4 boxes (`L-shape.vtu`: the west, middle and east boxes along x, and the north box at +y of the west box) with the regions `west_box`, `east_box` and `other_boxes` (the middle and the north box); the end face of the north box is the boundary surface north, the end face of the east box east. One family in each region (the region gives only the fracture centers, thus the fractures connect the regions); flow with gravity and particles from north to east. |
| `user_fractures_stochastic` | The same cube, a large user-defined fracture in the region `box` (a rectangle in the plane y = 5) from west to east with a larger aperture, a stochastic family, and matrix diffusion. |

The seeds of the examples give a network which connects the in-flow and
the out-flow boundaries. Many other seeds do not: then no fracture reaches
a boundary, or a part of the network has no connection to a boundary (the
mesh cuts each fracture at the mesh surface, thus two fractures can lose an
intersection outside the mesh), and "Solve flow" reports it.

## Folders

| Folder | Content |
|---|---|
| `dfn-wasm` | Rust crate: `wasm-bindgen` functions of the libraries: `generation.rs` (`input_file_names`, `check_input`, `run_generation`), `flow.rs` (`check_flow_input`, `run_flow`) and `transport.rs` (`check_transport_input`, `run_transport`). `errors.rs`: `ErrorReport`, the kind (`<library>.<variant>`), the values and the text of each library error. Not a member of a workspace. |
| `examples` | The workflow examples (see "Examples"); `build-wasm.sh` copies them into `app/public/examples`. |
| `meshes` | The predefined domain meshes (see "Examples"); `build-wasm.sh` copies them into `app/public/meshes`, with `index.json`. |
| `app` | Vite + TypeScript front end. |
| `app/src/workflow.ts` | The workflow file: reading (strict) and writing of the three sections. |
| `app/src/form` | The network form. `state.ts` has the form state, `toml.ts` the conversion between `[network]` and the state, the dfngen input, and the TOML helpers; one file for each section. |
| `app/src/userFractures.ts` | The polygon file of the user-defined fractures (see "User-defined fractures"). |
| `app/src/flow` | The flow form (`state.ts`, `toml.ts`: `[flow]` and the fehm input, `form.ts`), and `polyData.ts`: the pressure and the flow velocity of `pressure.vtu` in the data of `dfn_mesh.vtu`, and a triangle mesh as PolyData for the view. |
| `app/src/transport` | The transport form (`state.ts`, `toml.ts`: `[transport]` and the dfntrans input, `form.ts`), `trajectories.ts`: `velocity` as the active vectors of `trajectories.vtp`, for the cones of the view, and `velocities.ts`: the speed at each mesh point from `velocities.vtp`. |
| `app/src/viewer.ts` | The 3D view (VTK.wasm). |
| `app/src/errors.ts` | The text for the user of each kind of library error. |
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
  `[network.mesh]`, a family without aperture, a user fracture without
  region or with a bad center, and others).
- `tests/userFractures.test.ts`: the polygons of the user-defined fractures
  against the steps of dfngen-rs (the rectangle of `Poly::new`, `beta`, the
  normals of the three conventions, the half turn for the normal -z), the
  region arrays, and the region boxes of the predefined meshes.
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
- `scripts/e2e.mjs`: in Chrome (headless), the default example and tab,
  the "Next" button, the full workflow of each example, the flow without a
  mesh, the transport without a flow, the choice of a predefined mesh, the
  limits of the center of a new user-defined fracture, a bad input and the
  cancel; it saves screenshots.

## VTK.wasm notes

- The bundle has no `vtkDataSetMapper` and no geometry filter: the domain
  mesh is shown as its cell edges (`vtkExtractEdges`), and `dfn_mesh.vtu`
  (only triangles; with the pressure after the flow) is changed into
  PolyData text before it is read.
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
