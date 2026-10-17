import type { FormContext } from "./context";
import { element, numberField, row, section, textField } from "./fields";
import type { FormState } from "./state";

const MAX_RANDOM_SEED = 2 ** 32;

export function generalSection(state: FormState, context: FormContext): HTMLElement {
  const randomButton = element("button", "button-small", "Random");
  randomButton.type = "button";
  randomButton.title = "Set a new random seed";
  const seed = textField({
    label: "Seed",
    key: "seed",
    help: "0 = a random seed for each run",
    value: state.seed,
    pattern: "[0-9]+",
    button: randomButton,
    onInput: (value) => {
      state.seed = value;
      context.changed();
    },
  });
  randomButton.addEventListener("click", () => {
    state.seed = String(1 + Math.floor(Math.random() * (MAX_RANDOM_SEED - 1)));
    seed.input.value = state.seed;
    seed.input.classList.remove("is-invalid");
    context.changed();
  });

  return section(
    "General",
    row(
      seed.field,
      numberField({
        label: "Minimum feature size",
        key: "min_feature_size",
        help: "> 0; FRAM length limit; minimum radius = 3 × it",
        value: state.minFeatureSize,
        min: 0,
        isMinExclusive: true,
        onInput: (value) => {
          state.minFeatureSize = value;
          context.changed();
        },
      }),
    ),
  );
}
