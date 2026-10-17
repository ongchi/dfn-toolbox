#!/usr/bin/env bash
# Builds the WebAssembly module of dfngen for the web app, and copies the
# test cases of tests/data into the app as examples.
#
# Needs: the Rust target wasm32-unknown-unknown, and wasm-bindgen-cli with
# the version of wasm-bindgen in dfngen-wasm/Cargo.toml.
set -euo pipefail

web_dir="$(cd "$(dirname "$0")" && pwd)"
repo_dir="$(dirname "$web_dir")"
app_dir="$web_dir/app"

cargo build --release --target wasm32-unknown-unknown \
    --manifest-path "$web_dir/dfngen-wasm/Cargo.toml"
wasm-bindgen --target web --out-dir "$app_dir/src/pkg" \
    "$web_dir/dfngen-wasm/target/wasm32-unknown-unknown/release/dfngen_wasm.wasm"

# Examples: the folders of tests/data, with an index of the cases
examples_dir="$app_dir/public/examples"
rm -rf "$examples_dir"
mkdir -p "$examples_dir"
cp -R "$repo_dir/tests/data/." "$examples_dir/"
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
