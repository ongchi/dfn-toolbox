// The place of the VTK.wasm bundle. The published site gets it from a CDN, and
// serves its own copy only when the CDN fails. `fetch-vtk.sh` has the same
// version and SHA-256.

/** The commit of the `dist` branch of Kitware/vtk-wasm with VTK 9.7.20261025 */
const VTK_DIST_COMMIT = "4499bb4085cb77a9685f3845b7451d36d6bce13d";
const CDN_BUNDLE_URL = `https://cdn.jsdelivr.net/gh/Kitware/vtk-wasm@${VTK_DIST_COMMIT}/latest/vtk-wasm32-emscripten.tar.gz`;
export const BUNDLE_SHA256 = "9fea066b3887f25b4bc82b0d19601511b8f5ddd752b8a033aa574454ccd78f3b";

const LOCAL_BUNDLE_URL = `${import.meta.env.BASE_URL}vtk/vtk-wasm32-emscripten.tar.gz`;

function hexText(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A blob URL of the bundle of the CDN: a third party serves this code, thus its SHA-256 must be correct */
async function fetchCheckedCdnBundle(): Promise<string> {
  const response = await fetch(CDN_BUNDLE_URL);
  if (!response.ok) {
    throw new Error(`status ${response.status}`);
  }
  const bytes = await response.arrayBuffer();
  const sha256 = hexText(await crypto.subtle.digest("SHA-256", bytes));
  if (sha256 !== BUNDLE_SHA256) {
    throw new Error(`SHA-256 ${sha256}`);
  }
  return URL.createObjectURL(new Blob([bytes], { type: "application/gzip" }));
}

/** The URL for `loadAsync`. The development server uses its own file: a phone test has no HTTPS for `crypto.subtle`. */
export async function vtkBundleUrl(): Promise<string> {
  if (import.meta.env.DEV) {
    return LOCAL_BUNDLE_URL;
  }
  try {
    return await fetchCheckedCdnBundle();
  } catch (error) {
    console.warn("The VTK.wasm bundle of the CDN is not usable; the site's copy is used.", error);
    return LOCAL_BUNDLE_URL;
  }
}
