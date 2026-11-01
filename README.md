# dfn-toolbox

A static web app for discrete fracture networks:
<https://ongchi.github.io/dfn-toolbox/>. This is a preliminary version.

It runs three libraries in the browser (WebAssembly), and there is no server:

- [dfngen-rs](https://github.com/ongchi/dfngen-rs): generation of the network
  and its triangle mesh.
- [fehm-rs](https://github.com/ongchi/fehm-rs): steady water flow in the network.
- [dfntrans-rs](https://github.com/ongchi/dfntrans-rs): particle tracking in the flow.

The 3D view uses [VTK.wasm](https://kitware.github.io/vtk-wasm/).

## Use

The tabs follow the steps of the workflow. "Next" goes to the next tab. All
input is in the page: the app does not save the input or the output.

- **Domain**: select an example, or a predefined domain shape. Give each
  boundary surface a role (in-flow, out-flow or no-flow) and a color for the 3D view.
- **User fractures**: add fractures, each with a region, center, shape,
  aperture and orientation.
- **DFN**: set the fracture families. "Generate" makes the fractures, and
  "Meshing" makes their triangle mesh. A generation can stop and keep its
  fractures, then continue later. The network keeps only the clusters which
  connect an in-flow and an out-flow surface. If there is no such cluster, a
  warning shows, and you cannot go to the next step.
- **Flow**: set the temperature, the gravity and a pressure for each in-flow
  and out-flow surface, then "Solve flow".
- **Transport**: set the seeding and the routing of the particles, then
  "Track particles".

The 3D view shows the fractures during a generation. Color the mesh by a
property, the pressure or a velocity, and show or hide the layers: mesh, domain,
user fractures, removed and rejected fractures, and particle paths.

On a phone, the app shows one view at a time. One finger turns the model, two
fingers zoom it, and a tap on a boundary surface shows its outline.

For the same input and seed, the network and the mesh are those of the `dfngen`
binary. The flow agrees with the `fehm` binary within 1e-9. The particles of
the `dfntrans` binary have the same paths, and their times differ a little.

## Workflow file

Each example is one TOML file with four sections. The comment at the top is
the description of the input. The app makes the input of each library from it.
An unknown key or a missing key is an error.

```toml
# Description of the input.

[boundaries]                       # the roles of the boundary surfaces of the domain mesh
inflow = ["west"]
outflow = ["east"]                 # a surface in no list is a no-flow surface

[network]                          # the dfngen-rs input (see below)
seed = 12345
min_feature_size = 0.4
domain = "Box.vtu"                 # the name of a predefined mesh; no `user_fractures`
[network.generation]               # as [generation]
[network.fram]                     # as [fram]; optional
[network.mesh]                     # optional; no `enable` and no [network.region_boundaries]: always on
max_size_factor = 5.0
slope = 0.5
[network.clusters]                 # only keep_only_largest
[[network.family]]                 # as [[family]]; `aperture` is necessary
[[network.user_fracture]]          # optional; one table for each user-defined fracture, all keys necessary
region = "box"                     # one region of the mesh
center = [5.0, 5.0, 5.0]           # m; in the bounding box of the cells of the region
number_of_points = 4               # as a family: 3 or more, 4 = rectangle
radius = 7.78                      # m; of the circle of the points
aspect_ratio = 0.545               # y radius / x radius
beta = 0.0                         # degrees; rotation in the plane of the fracture
aperture = 3e-4                    # m; above 0
orientation = { theta = 90.0, phi = 90.0 }   # the normal, as a family without kappa

[flow]                             # the fehm-rs input (see below), without `mesh`
temperature = 20.0
gravity = false
pressure = { west = 10.1, east = 10.0 }   # MPa; each in-flow and out-flow surface, in place of [[boundary]]; no [solver]

[transport]                        # the dfntrans-rs input (see below), without `flow`
seed = 12345
time_unit = "days"
porosity = 1.0
max_time_steps = 1000000
routing = "complete_mixing"        # no inflow, no outflow: [boundaries] gives them
[transport.seeding]                # no [transport.tdrw], no [transport.control_planes], no [transport.output]
```

The keys are those of the input files of
[dfngen-rs](https://github.com/ongchi/dfngen-rs#input-file),
[fehm-rs](https://github.com/ongchi/fehm-rs#input-file) and
[dfntrans-rs](https://github.com/ongchi/dfntrans-rs#input-file).

A user-defined fracture is a regular polygon, made in the same way as a
stochastic fracture of dfngen-rs.

## Examples

| Example | Content |
|---|---|
| `box_west_east` | A cube of 10 m with one family. Flow and particles go from west to east. |
| `two_families` | The same cube, with a family perpendicular and a family parallel to the flow, and a correlated aperture. |
| `l_shape_north_east` | An L-shaped domain of 4 boxes, with one family in each of 3 regions. Flow with gravity and particles go from north to east. |
| `user_fractures_stochastic` | The same cube, with a large user-defined fracture from west to east and a stochastic family. |

The domain meshes are in `meshes/`. Each has boundary surfaces: surface cells
with the cell data arrays `boundary__<name>` (see
[Domain mesh](https://github.com/ongchi/dfngen-rs#domain-mesh)).

The seeds of the examples give a network which connects the in-flow and the
out-flow boundaries. Many other seeds do not, and then "Solve flow" reports it.

## Folders

| Folder | Content |
|---|---|
| `app` | Vite + TypeScript front end, and its tests. |
| `dfn-wasm` | Rust crate: the `wasm-bindgen` functions of the libraries. |
| `examples` | The workflow examples. |
| `meshes` | The predefined domain meshes. |

## Build

Clone [dfngen-rs](https://github.com/ongchi/dfngen-rs),
[fehm-rs](https://github.com/ongchi/fehm-rs) and
[dfntrans-rs](https://github.com/ongchi/dfntrans-rs) in folders next to this
repository. `dfn-wasm` uses them as Cargo git dependencies (branch `master`),
and the tests use their binaries, test data and scripts.

Necessary: Node, the Rust target `wasm32-unknown-unknown`, and
`wasm-bindgen-cli` with the version of `wasm-bindgen` in `dfn-wasm/Cargo.toml`:

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129 --locked
```

Then, in `app`:

```bash
npm ci
npm run setup     # VTK.wasm bundle and its types, WebAssembly module and examples
npm run dev       # development server
npm run build     # static files in dist/
```

After a change of a library or of `dfn-wasm`: `npm run wasm`.

To build the checked-out library branches, a local `.cargo/config.toml` (not in
git) can send the dependencies to those folders with `[patch]`. Do not commit
`dfn-wasm/Cargo.lock` from such a build: it has local paths. After a library
change, push the library, and run `cargo update` with no `[patch]`.

## Publication

`.github/workflows/pages.yml` publishes the site on GitHub Pages at each push
to `master`, or when it is started by hand. A failed test stops the deploy.
The Pages source of the repository must be "GitHub Actions". The same script
makes the site locally (`npm ci` replaces `app/node_modules`):

```bash
./build-site.sh /dfn-toolbox/   # the site in app/dist, for the path /dfn-toolbox/
```

## Tests

Build the binaries first: the tests compare the WebAssembly module with them.

```bash
cargo build --release   # in each of dfngen-rs, fehm-rs and dfntrans-rs
npm test                # in app
npm run dev & npm run e2e -- http://localhost:5173/
```

`npm test` runs the `vitest` tests of `app/tests`. `npm run e2e` runs
`app/scripts/e2e.mjs` in the local Chrome (headless) and saves screenshots.

## License

dfn-toolbox: LGPL-3.0 (`LICENSE.md`), as dfngen-rs. The site includes compiled
code of [dfngen-rs](https://github.com/ongchi/dfngen-rs) (LGPL-3.0; it is a
port of dfnWorks, LANL), [fehm-rs](https://github.com/ongchi/fehm-rs)
(BSD-3-Clause; based on FEHM, LANL),
[dfntrans-rs](https://github.com/ongchi/dfntrans-rs) (LGPL-3.0; a port of
DFNTrans of dfnWorks, LANL LA-CC-14-091) and
[VTK.wasm](https://kitware.github.io/vtk-wasm/) (BSD-3-Clause).
