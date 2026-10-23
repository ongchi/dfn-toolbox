// The workflow examples of ../examples (copied by build-wasm.sh).
import type { InputFiles } from "./inputFiles";
import { tomlToWorkflow, type Workflow } from "./workflow";

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

export async function loadExample(name: string): Promise<{ workflow: Workflow; files: InputFiles }> {
  const tomlUrl = new URL(`${name}/${name}.toml`, EXAMPLES_URL);
  const workflow = tomlToWorkflow(await fetchText(tomlUrl));
  const network = workflow.network;
  const mesh = { name: network.domain, text: await fetchText(new URL(network.domain, tomlUrl)) };
  const userFractures =
    network.userFractures === null
      ? null
      : { name: network.userFractures, text: await fetchText(new URL(network.userFractures, tomlUrl)) };
  return { workflow, files: { mesh, userFractures } };
}
