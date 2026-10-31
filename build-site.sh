#!/usr/bin/env bash
# Builds the static site into app/dist, after the tests. The GitHub Actions
# workflow and a local check run it.
#
# Usage: ./build-site.sh <base path>   (for example /dfn-toolbox/)
#
# Needs: ../dfngen-rs, ../fehm-rs and ../dfntrans-rs, Node, Python 3, the Rust target
# wasm32-unknown-unknown, and wasm-bindgen-cli with the version of
# wasm-bindgen in dfn-wasm/Cargo.toml. `npm ci` replaces app/node_modules.
set -euo pipefail

if [[ $# -ne 1 ]]; then
    echo "Usage: $0 <base path>" >&2
    exit 1
fi
base_path="$1"

web_dir="$(cd "$(dirname "$0")" && pwd)"
projects_dir="$(dirname "$web_dir")"
app_dir="$web_dir/app"

(cd "$app_dir" && npm ci)
"$web_dir/fetch-vtk.sh"
"$web_dir/build-wasm.sh"

# The tests compare the WebAssembly module with the native binaries
cargo build --release --manifest-path "$projects_dir/dfngen-rs/Cargo.toml"
cargo build --release --manifest-path "$projects_dir/fehm-rs/Cargo.toml"
cargo build --release --manifest-path "$projects_dir/dfntrans-rs/Cargo.toml"

cd "$app_dir"
npm test
npm run build -- --base="$base_path"
