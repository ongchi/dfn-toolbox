#!/usr/bin/env bash
# Downloads the VTK.wasm bundle into app/public/vtk and generates its
# TypeScript types. The bundle is a fixed weekly build of VTK (with the
# type manifests which `vtk-wasm gen-types` needs).
set -euo pipefail

VERSION="9.7.20261025"
SHA256="9fea066b3887f25b4bc82b0d19601511b8f5ddd752b8a033aa574454ccd78f3b"
URL="https://gitlab.kitware.com/api/v4/projects/13/packages/generic/vtk-wasm32-emscripten/${VERSION}/vtk-${VERSION}-wasm32-emscripten.tar.gz"

app_dir="$(cd "$(dirname "$0")/app" && pwd)"
bundle="$app_dir/public/vtk/vtk-wasm32-emscripten.tar.gz"

mkdir -p "$(dirname "$bundle")"
if [[ ! -f "$bundle" ]] || ! echo "$SHA256  $bundle" | shasum -a 256 -c --status; then
    curl -sSLf -o "$bundle" "$URL"
    echo "$SHA256  $bundle" | shasum -a 256 -c
fi

node "$app_dir/node_modules/@kitware/vtk-wasm/bin/vtk-wasm.mjs" gen-types \
    --url "$bundle" --out "$app_dir/src/vtk-wasm.gen.d.ts"
