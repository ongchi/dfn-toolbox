// The input form: one section for each part of the input file.
import { clustersSection } from "./clusters";
import type { FormContext } from "./context";
import { familiesSection } from "./families";
import { domainSection, type FileHandlers } from "./files";
import { framSection } from "./fram";
import { generalSection } from "./general";
import { generationSection } from "./generation";
import { meshSection } from "./mesh";
import type { FormState } from "./state";
import { userFracturesSection } from "./userFractures";

export function renderForm(
  container: HTMLElement,
  state: FormState,
  context: FormContext,
  fileHandlers: FileHandlers,
): void {
  const scrollTop = container.scrollTop;
  container.replaceChildren(
    domainSection(state, context, fileHandlers),
    userFracturesSection(state, context),
    generalSection(state, context),
    generationSection(state, context),
    framSection(state, context),
    meshSection(state, context),
    clustersSection(state, context),
    familiesSection(state, context),
  );
  container.scrollTop = scrollTop;
}
