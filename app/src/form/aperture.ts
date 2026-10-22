// Fields of an aperture distribution (a family `aperture`, and
// `mesh.user_fracture_aperture`); "None" = no key.
import type { FormContext } from "./context";
import { numberField, row, selectField } from "./fields";
import { defaultAperture, type ApertureDistribution, type ApertureState } from "./state";

export interface ApertureFieldOptions {
  label: string;
  key: string;
  help: string;
  isDisabled?: boolean;
  aperture: ApertureState | null;
  onSelect: (aperture: ApertureState | null) => void;
}

function parameterFields(aperture: ApertureState, isDisabled: boolean, context: FormContext): HTMLElement[] {
  const set = <K extends string>(key: K) => (value: number) => {
    (aperture as unknown as Record<K, number>)[key] = value;
    context.changed();
  };
  const positive = { min: 0, isMinExclusive: true, isDisabled };
  const alpha = (value: number) =>
    numberField({ label: "Factor α (m)", key: "alpha", value, ...positive, onInput: set("alpha") });
  const beta = (value: number) => numberField({ label: "Exponent β", key: "beta", value, isDisabled, onInput: set("beta") });
  const sd = (value: number) =>
    numberField({ label: "Standard deviation", key: "sd", value, min: 0, isDisabled, onInput: set("sd") });

  switch (aperture.distribution) {
    case "constant":
      return [numberField({ label: "Aperture (m)", key: "value", value: aperture.value, ...positive, onInput: set("value") })];
    case "log_normal":
      return [
        numberField({ label: "Mean of ln(b)", key: "log_mean", value: aperture.logMean, isDisabled, onInput: set("logMean") }),
        sd(aperture.sd),
      ];
    case "correlated":
      return [alpha(aperture.alpha), beta(aperture.beta)];
    case "semi_correlated":
      return [alpha(aperture.alpha), beta(aperture.beta), sd(aperture.sd)];
  }
}

export function apertureFields(options: ApertureFieldOptions, context: FormContext): HTMLElement[] {
  const aperture = options.aperture;
  const isDisabled = options.isDisabled ?? false;
  const distribution = selectField<ApertureDistribution | "">({
    label: options.label,
    key: options.key,
    help: options.help,
    value: aperture?.distribution ?? "",
    isDisabled,
    choices: [
      ["", "None"],
      ["constant", "Constant"],
      ["log_normal", "Log-normal"],
      ["correlated", "Correlated: α r^β"],
      ["semi_correlated", "Semi-correlated: α r^β e^(sd N)"],
    ],
    onInput: (value) => {
      options.onSelect(value === "" ? null : defaultAperture(value));
      context.rerender();
    },
  });
  if (aperture === null) {
    return [row(distribution)];
  }
  return [row(distribution), row(...parameterFields(aperture, isDisabled, context))];
}
