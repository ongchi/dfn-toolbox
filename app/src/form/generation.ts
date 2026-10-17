import type { FormContext } from "./context";
import { checkboxField, numberField, row, section, selectField } from "./fields";
import type { FormState, StopCondition } from "./state";

export function generationSection(state: FormState, context: FormContext): HTMLElement {
  const generation = state.generation;
  const stopCondition = selectField<StopCondition>({
    label: "Stop condition",
    help: "P32: each family stops at its `p32_target`",
    value: generation.stopCondition,
    choices: [
      ["n_poly", "Number of fractures (n_poly)"],
      ["p32", "P32 target of each family"],
    ],
    onInput: (value) => {
      generation.stopCondition = value;
      context.rerender();
    },
  });
  const stopFields = [stopCondition];
  if (generation.stopCondition === "n_poly") {
    stopFields.push(
      numberField({
        label: "Number of fractures",
        key: "n_poly",
        help: "accepted fractures",
        value: generation.nPoly,
        isInteger: true,
        min: 1,
        onInput: (value) => {
          generation.nPoly = value;
          context.changed();
        },
      }),
    );
  }

  return section(
    "Generation",
    row(...stopFields),
    numberField({
      label: "Remove fractures smaller than",
      key: "remove_fractures_less_than",
      help: "after the generation, remove the fractures with `x_radius` below it; 0 = none",
      value: generation.removeFracturesLessThan,
      min: 0,
      onInput: (value) => {
        generation.removeFracturesLessThan = value;
        context.changed();
      },
    }),
    checkboxField({
      label: "Force large fractures",
      key: "force_large_fractures",
      help: "each family first gets one fracture with its maximum radius",
      value: generation.forceLargeFractures,
      onInput: (value) => {
        generation.forceLargeFractures = value;
        context.changed();
      },
    }),
  );
}
