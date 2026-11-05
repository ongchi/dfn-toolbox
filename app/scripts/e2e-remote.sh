#!/usr/bin/env bash
# Runs the end-to-end check (scripts/e2e.mjs) on a remote computer, with its
# own dev server, and copies the screenshots back.
#   E2E_REMOTE_HOST=<ssh host> E2E_REMOTE_ROOT=<folder> scripts/e2e-remote.sh [screenshot folder]
# E2E_REMOTE_ROOT is the copy of the root folder (the parent of this
# repository) on the remote computer, relative to its home folder; rsync
# replaces the content of the four project folders in it.
# The remote computer needs node, npm, Google Chrome, and the tools of
# ../build-wasm.sh (it builds the WebAssembly there). Without a screenshot
# folder, the screenshots go to a new temporary folder. The exit code is that
# of e2e.mjs. When the remote computer is not available, run the local check
# instead (npm run dev, then npm run e2e).
set -euo pipefail

host="${E2E_REMOTE_HOST:?set E2E_REMOTE_HOST to the ssh host of the remote computer}"
remote_root="${E2E_REMOTE_ROOT:?set E2E_REMOTE_ROOT to the folder of the copy, relative to the remote home folder}"
remote_screenshots="$remote_root-e2e-screenshots"
# Another port than a dev server of the user
port=5174

root_dir="$(cd "$(dirname "$0")/../../.." && pwd)"
# The folder of this repository (dfn-toolbox), in the root folder
project_name="$(basename "$(cd "$(dirname "$0")/../.." && pwd)")"
screenshot_dir="${1:-$(mktemp -d -t dfn-e2e)}"
mkdir -p "$screenshot_dir"

if ! ssh -o BatchMode=yes -o ConnectTimeout=5 "$host" true; then
    echo "$host is not available: run npm run dev, then npm run e2e" >&2
    exit 2
fi

# Only the projects of the app: the root folder also has other projects.
# No slash after the names: each folder goes into the remote root, and the
# local target folders are symlinks.
ssh "$host" mkdir -p "$remote_root"
(cd "$root_dir" && rsync -az --delete --exclude target --exclude node_modules --exclude dist \
    dfngen-rs fehm-rs dfntrans-rs "$project_name" "$host:$remote_root/")

status=0
ssh "$host" bash -s -- "$remote_root/$project_name/app" "$remote_screenshots" "$port" <<'REMOTE' || status=$?
set -euo pipefail
app_dir="$1"
screenshot_dir="$2"
port="$3"
cd "$app_dir"
# Install again after a change of the dependencies (npm ci writes node_modules/.package-lock.json)
if [[ package-lock.json -nt node_modules/.package-lock.json ]]; then
    npm ci
fi
npm run wasm
rm -rf "$HOME/$screenshot_dir"
mkdir -p "$HOME/$screenshot_dir"

node_modules/.bin/vite --port "$port" --strictPort > /dev/null 2>&1 &
vite_pid=$!
trap 'kill "$vite_pid" 2> /dev/null || true' EXIT
for _ in $(seq 60); do
    curl -s -o /dev/null "http://localhost:$port/" && break
    sleep 1
done
node scripts/e2e.mjs "http://localhost:$port/" "$HOME/$screenshot_dir"
REMOTE

rsync -az "$host:$remote_screenshots/" "$screenshot_dir/"
echo "Screenshots: $screenshot_dir"
exit "$status"
