// The workflow examples of ../examples (copied by build-wasm.sh). The domain
// of an example is a predefined mesh.
import type { InputFiles } from "./inputFiles";
import { loadMesh } from "./meshes";
import { readDescription, tomlToWorkflow, type Workflow } from "./workflow";

const EXAMPLES_URL = new URL(`${import.meta.env.BASE_URL}examples/`, window.location.href);

export async function listExamples(): Promise<string[]> {
  const response = await fetch(new URL("index.json", EXAMPLES_URL));
  if (!response.ok) {
    throw new Error(`cannot load the list of examples (HTTP ${response.status})`);
  }
  return response.json();
}

async function fetchText(url: URL): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`cannot load ${url.pathname} (HTTP ${response.status})`);
  }
  return response.text();
}

function exampleUrl(name: string): URL {
  return new URL(`${name}/${name}.toml`, EXAMPLES_URL);
}

/** The title of an example: the start of its description up to the first ":", else its name */
export async function loadExampleTitle(name: string): Promise<string> {
  const description = readDescription(await fetchText(exampleUrl(name)));
  const colon = description.indexOf(":");
  return colon > 0 ? description.slice(0, colon) : name;
}

export async function loadExample(name: string): Promise<{ workflow: Workflow; files: InputFiles }> {
  const workflow = tomlToWorkflow(await fetchText(exampleUrl(name)));
  const network = workflow.network;
  return { workflow, files: { mesh: await loadMesh(network.domain) } };
}
