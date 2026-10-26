// The input form of the network: one section for each part of `[network]`, in
// three tabs (the domain, the user-defined fractures, and the other sections).
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

/** The containers of the three tabs of the network input */
export interface NetworkTabs {
  domain: HTMLElement;
  fractures: HTMLElement;
  network: HTMLElement;
}

/** Replaces the sections of a tab; its scroll position stays */
function replaceSections(container: HTMLElement, ...sections: HTMLElement[]): void {
  const scrollTop = container.scrollTop;
  container.replaceChildren(...sections);
  container.scrollTop = scrollTop;
}

export function renderForm(tabs: NetworkTabs, state: FormState, context: FormContext, fileHandlers: FileHandlers): void {
  replaceSections(tabs.domain, domainSection(state, context, fileHandlers));
  replaceSections(tabs.fractures, userFracturesSection(state, context));
  replaceSections(
    tabs.network,
    generalSection(state, context),
    generationSection(state, context),
    framSection(state, context),
    meshSection(state, context),
    clustersSection(state, context),
    familiesSection(state, context),
  );
}
