// The input form: one section for each part of the input file.
import { clustersSection } from "./clusters";
import type { FormContext } from "./context";
import { familiesSection } from "./families";
import { filesSection, type FileHandlers } from "./files";
import { framSection } from "./fram";
import { generalSection } from "./general";
import { generationSection } from "./generation";
import { meshSection } from "./mesh";
import { regionBoundariesSection } from "./regionBoundaries";
import type { InputFiles } from "../inputFiles";
import type { FormState } from "./state";

export function renderForm(
  container: HTMLElement,
  state: FormState,
  files: InputFiles,
  context: FormContext,
  fileHandlers: FileHandlers,
): void {
  const scrollTop = container.scrollTop;
  container.replaceChildren(
    filesSection(state, files, fileHandlers),
    generalSection(state, context),
    generationSection(state, context),
    framSection(state, context),
    regionBoundariesSection(state, context),
    meshSection(state, context),
    clustersSection(state, context),
    familiesSection(state, context),
  );
  container.scrollTop = scrollTop;
}
