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

## Features

- **Workflow** in four steps: Domain, Fractures, Flow and Transport. The run
  bar at the bottom runs all steps and shows the state of each step; a click
  on a step opens its settings.
- **Live run**: while the run is on, a change of a setting runs again only the
  steps which it affects.
- **Domain**: predefined domain shapes. Each boundary surface is in-flow,
  out-flow or no flow, and the in-flow and out-flow surfaces have a pressure.
- **Fractures**: stochastic fracture families (number of fractures or P32
  target) and user-defined fractures. The advanced settings have the seed,
  the FRAM rules, the cluster selection and the triangle mesh for the flow.
- **Flow**: steady water flow, with temperature and gravity.
- **Transport**: particle tracking from release points, picked on the
  fractures in the 3D view.
- **3D view**: the fractures during the generation, the mesh colored by
  pressure or velocity, moving particles that show the flow, the particle
  paths, and layers to show or hide.
- **Layouts** for computers, tablets and phones.
- **No server**: all runs in the browser, and the app does not save the input
  or the output.

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
