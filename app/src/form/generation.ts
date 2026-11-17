import type { FormContext } from "./context";
import { row, section, selectField } from "./fields";
import type { FormState, StopCondition } from "./state";

export function generationSection(state: FormState, context: FormContext): HTMLElement {
  const generation = state.generation;
  const stopCondition = selectField<StopCondition>({
    label: "Stop condition",
    help: "the number of fractures or the P32 target of each family",
    value: generation.stopCondition,
    choices: [
      ["n_poly", "Number of fractures of each family"],
      ["p32", "P32 target of each family"],
    ],
    onInput: (value) => {
      generation.stopCondition = value;
      context.rerender();
    },
  });
  return section("Generation", row(stopCondition));
}
