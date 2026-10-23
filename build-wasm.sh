#!/usr/bin/env bash
# Builds the WebAssembly module of dfngen for the web app, and copies the
# workflow examples of examples/ into the app.
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

# Examples: the folders of examples/, with an index of the examples
examples_dir="$app_dir/public/examples"
rm -rf "$examples_dir"
mkdir -p "$examples_dir"
cp -R "$web_dir/examples/." "$examples_dir/"
{
    echo "["
    first=true
    for case_dir in "$examples_dir"/*/; do
        case_name="$(basename "$case_dir")"
        [[ -f "$case_dir/$case_name.toml" ]] || continue
        $first || echo ","
        first=false
        printf '  "%s"' "$case_name"
    done
    echo
    echo "]"
} > "$examples_dir/index.json"
