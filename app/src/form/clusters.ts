import type { FormContext } from "./context";
import { checkboxField, element, section } from "./fields";
import type { FormState } from "./state";

export function clustersSection(state: FormState, context: FormContext): HTMLElement {
  const clusters = state.clusters;
  return section(
    "Clusters",
    element(
      "p",
      "form-note",
      "The fractures with no intersection are removed. Only the clusters which connect an in-flow and an out-flow surface (Domain tab) stay.",
    ),
    checkboxField({
      label: "Keep only the largest cluster",
      key: "keep_only_largest",
      value: clusters.keepOnlyLargest,
      onInput: (value) => {
        clusters.keepOnlyLargest = value;
        context.changed();
      },
    }),
  );
}
