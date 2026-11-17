#!/usr/bin/env bash
# Builds the WebAssembly module of dfngen for the web app, and copies the
# domain meshes of meshes/ into the app.
#
# Needs: the Rust target wasm32-unknown-unknown, and wasm-bindgen-cli with
# the version of wasm-bindgen in dfn-wasm/Cargo.toml.
set -euo pipefail

web_dir="$(cd "$(dirname "$0")" && pwd)"
app_dir="$web_dir/app"

cargo build --release --target wasm32-unknown-unknown \
    --manifest-path "$web_dir/dfn-wasm/Cargo.toml"
wasm-bindgen --target web --out-dir "$app_dir/src/pkg" \
    "$web_dir/dfn-wasm/target/wasm32-unknown-unknown/release/dfn_wasm.wasm"

# Predefined domain meshes: the .vtu files of meshes/, with an index of their names
meshes_dir="$app_dir/public/meshes"
rm -rf "$meshes_dir"
mkdir -p "$meshes_dir"
cp "$web_dir/meshes/"*.vtu "$meshes_dir/"
{
    echo "["
    first=true
    for mesh_path in "$meshes_dir"/*.vtu; do
        $first || echo ","
        first=false
        printf '  "%s"' "$(basename "$mesh_path")"
    done
    echo
    echo "]"
} > "$meshes_dir/index.json"
