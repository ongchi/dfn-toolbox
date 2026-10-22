// The test cases of tests/data as examples (copied by build-wasm.sh).
import { tomlToFormState } from "./form/toml";
import type { FormState } from "./form/state";
import type { InputFiles } from "./inputFiles";

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

/** The comment at the top of the TOML (the feature of a case), or "" */
export function exampleDescription(toml: string): string {
  const lines = toml.split("\n");
  const end = lines.findIndex((line) => !line.startsWith("#"));
  return lines
    .slice(0, end === -1 ? lines.length : end)
    .map((line) => line.replace(/^#\s?/, ""))
    .join(" ");
}

export async function loadExample(
  name: string,
): Promise<{ state: FormState; files: InputFiles; description: string }> {
  const tomlUrl = new URL(`${name}/${name}.toml`, EXAMPLES_URL);
  const toml = await fetchText(tomlUrl);
  const state = tomlToFormState(toml);
  const mesh = { name: state.domain, text: await fetchText(new URL(state.domain, tomlUrl)) };
  const userFractures =
    state.userFractures === null
      ? null
      : { name: state.userFractures, text: await fetchText(new URL(state.userFractures, tomlUrl)) };
  return { state, files: { mesh, userFractures }, description: exampleDescription(toml) };
}
