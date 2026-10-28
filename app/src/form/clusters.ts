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
      "Only the clusters which connect all boundary surfaces of the domain stay. If no cluster connects them, all clusters stay, with a warning.",
    ),
    checkboxField({
      label: "Keep isolated fractures",
      key: "keep_isolated_fractures",
      help: "keep all accepted fractures; off = remove the fractures with no intersection",
      value: clusters.keepIsolatedFractures,
      onInput: (value) => {
        clusters.keepIsolatedFractures = value;
        context.rerender();
      },
    }),
    checkboxField({
      label: "Keep only the largest cluster",
      key: "keep_only_largest",
      help: clusters.keepIsolatedFractures ? "no effect with `keep_isolated_fractures`" : "",
      value: clusters.keepOnlyLargest,
      isDisabled: clusters.keepIsolatedFractures,
      onInput: (value) => {
        clusters.keepOnlyLargest = value;
        context.changed();
      },
    }),
  );
}
