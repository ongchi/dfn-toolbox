# dfn-toolbox

A static web app for discrete fracture networks:
<https://ongchi.github.io/dfn-toolbox/>. This is a preliminary version.

It runs three libraries in the browser (WebAssembly), and there is no server:

- [dfngen-rs](https://github.com/ongchi/dfngen-rs): generation of the network
  and its triangle mesh.
- [fehm-rs](https://github.com/ongchi/fehm-rs): steady water flow in the network.
- [dfntrans-rs](https://github.com/ongchi/dfntrans-rs): particle tracking in the flow.

The 3D view uses [three.js](https://threejs.org/). After the flow, moving particles
show the direction and the speed of the flow.

## Use

The run bar at the bottom is a media player. Its timeline has one segment
for each step of the workflow; the segment shows the state of its step (not
run, running with its progress, done, or failed). A click on a segment opens
the settings of its step above the bar; a second click, the close button or
Escape closes them. At the start, no settings show. One "Run" button (▶) runs
all steps: the fractures, their triangle mesh, the flow and the transport.
While the run is on (the pause button ❚❚ shows), a change of a setting runs the steps again from the
first step which the change affects, 0.5 s after the last change; the results
of the steps before it stay. For example, a new pressure runs only the flow
and the transport, and a new user-defined fracture keeps the stochastic
fractures of the last run (FRAM does not check them again). "Pause" during the
generation keeps the fractures until the last checkpoint (each 5 s); the next
"Run" adds the others. "Reset" (⏮) removes all results: the next run starts from
the seed. All input is in the page: the app does not save the input or the
output.

- **Domain**: select a predefined domain shape. At the start, the page has
  the first shape with the default values of all forms. Give each
  boundary surface a role (in-flow, out-flow or no-flow); a new shape gets
  the default roles: the first surface is in-flow, the second out-flow. The pointer over the
  row of a surface highlights it in the 3D view; a click on the row keeps it
  highlighted until a second click.
- **Fractures**: set the fracture families and the user-defined fractures.
  With the stop condition (advanced part) "Number of fractures of each
  family", each family has its number of fractures: the run stops at the
  total, and the family of each new fracture is random with the share of its
  number, thus the number of a family is an expected value. With the stop
  condition "P32 target of each family", each family has its P32 target, and
  all families have the same chance. Each user-defined fracture has a region,
  center, shape, aperture and orientation. The cards of the families and of
  the user fractures are an accordion: a click on the header of a card opens
  it and closes the others; a closed card shows its main values in its
  header. The pointer over a Region field highlights its region in the 3D
  view; a click on its name keeps it highlighted until a second click, and a
  new choice moves the highlight to the new region. The network keeps only
  the clusters which connect an in-flow and an out-flow surface. If there is
  no such cluster, a warning shows, and the run stops after the fractures.
  The advanced part (closed at the start) has the stop condition, the FRAM
  rules of the generation, the choice of the clusters and the size of the
  triangles of the mesh for the flow.
- **Flow**: set a pressure for each in-flow and out-flow surface (default:
  11.0 MPa for the default in-flow surface, 10.0 MPa for the others), and the
  fluid (temperature and gravity).
- **Transport**: the particles start only at release points. Click "Pick points", then click on a fracture of the 3D
  view: each click adds a release point and runs the particle tracking. With
  no release point, the run ends after the flow. The path of each particle
  shows, also of a particle which does not exit. The routing of the particles
  at the intersections follows.
- **Settings** (the gear button below the layers of the 3D view): the pair of
  angles of all orientations (theta and phi, trend and plunge, or dip and
  strike). A new choice changes the angles of each family and fracture to the
  same plane. Also the number of points of all fractures (one value for the
  families and the user fractures) and the minimum feature size.

The 3D view shows the fractures during a generation, cut at the domain (the
mesh has the same shape). A change of a user-defined fracture shows its
whole polygon until the next network. Color the mesh by a
property, the pressure or a velocity, and show or hide the layers: mesh, domain,
user fractures, removed and rejected fractures, and particle paths.

The 3D view fills the page, and the controls float over it: the title at the
top left, the colors and the layers at the top right, the run bar at the
bottom left with the settings of the open step above it, and the Log. The
Log has the status of the steps (progress, results, warnings and errors); a
red or yellow dot on the Log button shows an error or a warning. The
settings of a step cover the view and do not move it. On a phone, the run bar
is at the bottom over the full width, and the settings of a step are a sheet
above it with three heights. A touch on the 3D view lowers the sheet to its
header; a tap on the header raises it again, and a swipe on the header moves
it up or down. One finger turns the model, two fingers zoom it, and a
tap on the row of a boundary surface keeps the surface highlighted until a
second tap.

For the same input and seed, the network and the mesh are those of the `dfngen`
binary. The flow agrees with the `fehm` binary within 1e-9. The particles of
the `dfntrans` binary have the same paths, and their times differ a little.

## Domain meshes

The domain meshes are in `meshes/`. Each has boundary surfaces: surface cells
with the cell data arrays `boundary__<name>` (see
[Domain mesh](https://github.com/ongchi/dfngen-rs#domain-mesh)).

The default values of the forms give a network which connects the in-flow
and the out-flow boundaries of each predefined shape. Many other seeds do
not, and then the run stops after the fractures with a warning.

## Folders

| Folder | Content |
|---|---|
| `app` | Vite + TypeScript front end, and its tests. |
| `dfn-wasm` | Rust crate: the `wasm-bindgen` functions of the libraries. |
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
npm run setup     # WebAssembly module and domain meshes
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

`npm test` runs the `vitest` tests of `app/tests`. The workflow files of
`app/tests/data/workflows` are test inputs: each one runs the full workflow,
as do the default forms on each predefined mesh. `npm run e2e` runs
`app/scripts/e2e.mjs` in the local Chrome (headless) and saves screenshots.
`E2E_REMOTE_HOST=<ssh host> E2E_REMOTE_ROOT=<folder> npm run e2e:remote` runs
the same check on another computer with node, npm, Google Chrome and the tools
of `build-wasm.sh` (`app/scripts/e2e-remote.sh`: it copies the root folder
there with rsync, builds the WebAssembly, runs its own dev server, and copies
the screenshots back).

## License

dfn-toolbox: LGPL-3.0 (`LICENSE.md`), as dfngen-rs. The site includes compiled
code of [dfngen-rs](https://github.com/ongchi/dfngen-rs) (LGPL-3.0; it is a
port of dfnWorks, LANL), [fehm-rs](https://github.com/ongchi/fehm-rs)
(BSD-3-Clause; based on FEHM, LANL),
[dfntrans-rs](https://github.com/ongchi/dfntrans-rs) (LGPL-3.0; a port of
DFNTrans of dfnWorks, LANL LA-CC-14-091) and
[three.js](https://threejs.org/) (MIT).
