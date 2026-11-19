// The input form of the network: one section for each part of `[network]`, in
// three step panels (the domain, the user-defined fractures, and the other
// sections, with the stop condition, FRAM, the clusters and the triangle mesh
// in its advanced part) and the settings dialog (the seed, the fracture shape).
import { clustersSection } from "./clusters";
import type { FormContext } from "./context";
import { familiesSection } from "./families";
import { domainSection, type FileHandlers } from "./files";
import { framSection } from "./fram";
import { generationSection } from "./generation";
import { meshSection } from "./mesh";
import { seedSection } from "./seed";
import { shapeSection } from "./shape";
import type { FormState } from "./state";
import { userFracturesSection } from "./userFractures";

/** The containers of the three step panels of the network input, of its advanced part, and of its sections in the settings dialog */
export interface NetworkTabs {
  domain: HTMLElement;
  fractures: HTMLElement;
  network: HTMLElement;
  advanced: HTMLElement;
  /** The first section of the settings dialog */
  seed: HTMLElement;
  settings: HTMLElement;
}

/** Replaces the sections of a container; its scroll position stays */
function replaceSections(container: HTMLElement, ...sections: HTMLElement[]): void {
  const scrollTop = container.scrollTop;
  container.replaceChildren(...sections);
  container.scrollTop = scrollTop;
}

export function renderForm(tabs: NetworkTabs, state: FormState, context: FormContext, fileHandlers: FileHandlers): void {
  replaceSections(tabs.domain, domainSection(state, context, fileHandlers));
  replaceSections(tabs.fractures, userFracturesSection(state, context));
  replaceSections(tabs.network, familiesSection(state, context));
  replaceSections(tabs.seed, seedSection(state, context));
  replaceSections(tabs.settings, shapeSection(state, context));
  replaceSections(
    tabs.advanced,
    generationSection(state, context),
    framSection(state, context),
    clustersSection(state, context),
    meshSection(state, context),
  );
}
