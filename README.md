# dfn-web

A static web app for dfngen. The project needs the repository of the
library, `dfngen-rs`, in the sibling folder `../dfngen-rs`: `dfn-wasm`
uses it as a Cargo path dependency, and the build and the tests use its
test cases (`tests/data`), its binary and its scripts.

The generation runs in the browser (WebAssembly), and the 3D view uses
[VTK.wasm](https://kitware.github.io/vtk-wasm/).
There is no server: `npm run build` gives a folder of static files.

- Input: a form with one field for each key of the input file (see "Input
  file" in `../dfngen-rs/README.md`), and the mesh file and the
  user-defined fracture file. The 27 cases of `tests/data` are examples.
  "Open files…" reads a TOML input file with its mesh and fracture files
  (select all of them; the files are found by their names). "Save TOML"
  writes the input of the form, for the `dfngen` binary.
- "Check input" shows the error of the library for the input, without a
  generation. "Generate" runs the generation in a Web Worker; "Cancel" stops it.
- Output: the 3D view of `fractures.vtp` (color by a cell array),
  `fractures_removed.vtp`, `fractures_rejected.vtp` and the mesh; the log;
  each output file, and all of them as one `.zip`.

The output is that of the `dfngen` binary for the same input and seed.
The math functions of WebAssembly (`libm`) and of the native platform can
round differently in the last digits, thus the decimal numbers can differ
by about 1e-15 (relative). A FRAM decision can then also be different, and
the network changes; the 27 cases have no such difference. The triangle mesh
(`dfn_mesh.vtu`, with `[mesh]`) is different: the mesh step makes a
difference in the last digit large, thus the mesh of WebAssembly can have
other points and triangles than the mesh of the binary. This is accepted.

## Folders

| Folder | Content |
|---|---|
| `dfn-wasm` | Rust crate: `wasm-bindgen` functions of the library (`input_file_names`, `check_input`, `run_generation`). Not a member of a workspace. |
| `app` | Vite + TypeScript front end. |
| `app/src/form` | The input form. `state.ts` has the form state, `toml.ts` the conversion to and from TOML, and one file for each section. |
| `app/src/viewer.ts` | The 3D view (VTK.wasm). |
| `app/src/worker.ts`, `app/src/generationClient.ts` | The Web Worker of the generation, and its interface for the page. |
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

After a change of the library or of `dfn-wasm`: `npm run wasm`.

`fetch-vtk.sh` downloads a fixed weekly build of VTK.wasm (13 MB, with a
SHA-256 check) into `public/vtk`. The app loads it from there, not from a
CDN. To use another build, change `VERSION` and `SHA256` in the script; the
TypeScript types are generated from the bundle.

## Tests

```bash
cargo build --release   # in ../dfngen-rs: the tests compare with the binary
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
- `scripts/e2e.mjs`: in Chrome (headless), each example, a bad input, the
  cancel, and the layers of the view; it saves screenshots.

## VTK.wasm notes

- The bundle has no `vtkDataSetMapper`: the mesh is shown as its cell edges
  (`vtkExtractEdges`).
- The XML readers read from a string (`readFromInputStringOn`,
  `setInputString`), thus the app has no VTK file parser.
- Change VTK objects with their setter methods. An assignment to a property
  (`mapper.scalarVisibility = 1`) can set other properties back: it gave the
  mapper its old lookup table.
- Add 2D actors (scalar bar) with `addViewProp`.
