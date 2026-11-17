// Fields of an aperture distribution: a family `aperture` (necessary).
import type { FormContext } from "./context";
import { row, selectField, sliderField } from "./fields";
import { defaultAperture, type ApertureDistribution, type ApertureState } from "./state";

interface ApertureFieldOptions {
  label: string;
  key: string;
  help: string;
  aperture: ApertureState;
  onSelect: (aperture: ApertureState) => void;
}

const DISTRIBUTION_CHOICES: [ApertureDistribution, string][] = [
  ["constant", "Constant"],
  ["log_normal", "Log-normal"],
  ["correlated", "Correlated: α r^β"],
  ["semi_correlated", "Semi-correlated: α r^β e^(sd N)"],
];

function parameterFields(aperture: ApertureState, context: FormContext): HTMLElement[] {
  const set = <K extends string>(key: K) => (value: number) => {
    (aperture as unknown as Record<K, number>)[key] = value;
    context.changed();
  };
  // The range of an aperture of a user fracture
  const metres = { min: 1e-6, max: 1e-2, step: 0.01, isLogScale: true };
  const alpha = (value: number) => sliderField({ label: "Factor α (m)", key: "alpha", value, ...metres, onInput: set("alpha") });
  const beta = (value: number) =>
    sliderField({ label: "Exponent β", key: "beta", value, min: 0, max: 2, step: 0.01, onInput: set("beta") });
  const sd = (value: number) =>
    sliderField({ label: "Standard deviation", key: "sd", value, min: 0, max: 3, step: 0.01, onInput: set("sd") });

  switch (aperture.distribution) {
    case "constant":
      return [sliderField({ label: "Aperture (m)", key: "value", value: aperture.value, ...metres, onInput: set("value") })];
    case "log_normal":
      return [
        sliderField({
          label: "Mean of ln(b)",
          key: "log_mean",
          value: aperture.logMean,
          min: -14,
          max: -4.5,
          step: 0.01,
          onInput: set("logMean"),
        }),
        sd(aperture.sd),
      ];
    case "correlated":
      return [alpha(aperture.alpha), beta(aperture.beta)];
    case "semi_correlated":
      return [alpha(aperture.alpha), beta(aperture.beta), sd(aperture.sd)];
  }
}

export function apertureFields(options: ApertureFieldOptions, context: FormContext): HTMLElement[] {
  const distribution = selectField<ApertureDistribution>({
    label: options.label,
    key: options.key,
    help: options.help,
    value: options.aperture.distribution,
    choices: DISTRIBUTION_CHOICES,
    onInput: (value) => {
      options.onSelect(defaultAperture(value));
      context.rerender();
    },
  });
  // One slider for each row, as a user fracture
  return [row(distribution), ...parameterFields(options.aperture, context).map((field) => row(field))];
}
