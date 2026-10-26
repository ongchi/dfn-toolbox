// Fields of an aperture distribution: a family `aperture` (necessary).
import type { FormContext } from "./context";
import { numberField, row, selectField } from "./fields";
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
  const positive = { min: 0, isMinExclusive: true };
  const alpha = (value: number) =>
    numberField({ label: "Factor α (m)", key: "alpha", value, ...positive, onInput: set("alpha") });
  const beta = (value: number) => numberField({ label: "Exponent β", key: "beta", value, onInput: set("beta") });
  const sd = (value: number) =>
    numberField({ label: "Standard deviation", key: "sd", value, min: 0, onInput: set("sd") });

  switch (aperture.distribution) {
    case "constant":
      return [numberField({ label: "Aperture (m)", key: "value", value: aperture.value, ...positive, onInput: set("value") })];
    case "log_normal":
      return [
        numberField({ label: "Mean of ln(b)", key: "log_mean", value: aperture.logMean, onInput: set("logMean") }),
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
  return [row(distribution), row(...parameterFields(options.aperture, context))];
}
