import { apertureFields } from "./aperture";
import type { FormContext } from "./context";
import { element, numberField, optionalNumberField, row, section, selectField } from "./fields";
import {
  ORIENTATION_KEYS,
  defaultFamily,
  defaultRadius,
  type FamilyState,
  type FormState,
  type LogNormalSampling,
  type OrientationConvention,
  type RadiusDistribution,
  type RadiusState,
} from "./state";

const PROBABILITY_TOLERANCE = 0.001;

function radiusFields(family: FamilyState, context: FormContext): HTMLElement[] {
  const radius = family.radius;
  const set = <K extends string>(key: K) => (value: number) => {
    (radius as unknown as Record<K, number>)[key] = value;
    context.changed();
  };
  const positive = { min: 0, isMinExclusive: true };
  const minMax = () =>
    row(
      numberField({ label: "Minimum", key: "min", value: (radius as { min: number }).min, ...positive, onInput: set("min") }),
      numberField({ label: "Maximum", key: "max", value: (radius as { max: number }).max, ...positive, onInput: set("max") }),
    );

  const distribution = selectField<RadiusDistribution>({
    label: "Radius distribution",
    key: "distribution",
    value: radius.distribution,
    choices: [
      ["truncated_power_law", "Truncated power law"],
      ["log_normal", "Log-normal"],
      ["exponential", "Exponential"],
      ["constant", "Constant"],
    ],
    onInput: (value) => {
      family.radius = changeDistribution(radius, value);
      context.rerender();
    },
  });

  switch (radius.distribution) {
    case "truncated_power_law":
      return [
        row(distribution, numberField({ label: "Exponent", key: "alpha", value: radius.alpha, ...positive, onInput: set("alpha") })),
        minMax(),
      ];
    case "log_normal":
      return [
        row(
          distribution,
          selectField<LogNormalSampling | "">({
            label: "Sampling",
            key: "sampling",
            help: "the two methods give different networks",
            value: radius.sampling ?? "",
            choices: [
              ["", "Default (rejection)"],
              ["rejection", "Rejection"],
              ["inverse_cdf", "Inverse CDF"],
            ],
            onInput: (value) => {
              radius.sampling = value === "" ? null : value;
              context.changed();
            },
          }),
        ),
        row(
          numberField({ label: "Mean of ln(r)", key: "log_mean", value: radius.logMean, onInput: set("logMean") }),
          numberField({ label: "Standard deviation", key: "sd", value: radius.sd, ...positive, onInput: set("sd") }),
        ),
        minMax(),
      ];
    case "exponential":
      return [
        row(distribution, numberField({ label: "Mean", key: "mean", value: radius.mean, ...positive, onInput: set("mean") })),
        minMax(),
      ];
    case "constant":
      return [row(distribution, numberField({ label: "Radius", key: "value", value: radius.value, ...positive, onInput: set("value") }))];
  }
}

/** A new distribution keeps the minimum and the maximum of the old one */
function changeDistribution(old: RadiusState, distribution: RadiusDistribution): RadiusState {
  const radius = defaultRadius(distribution);
  if ("min" in old && "min" in radius) {
    radius.min = old.min;
    radius.max = old.max;
  }
  return radius;
}

const ANGLE_LABELS: Record<OrientationConvention, [string, string]> = {
  theta_phi: ["Theta (°)", "Phi (°)"],
  trend_plunge: ["Trend (°)", "Plunge (°)"],
  dip_strike: ["Dip (°)", "Strike (°)"],
};

function orientationFields(family: FamilyState, context: FormContext): HTMLElement[] {
  const orientation = family.orientation;
  const [firstKey, secondKey] = ORIENTATION_KEYS[orientation.convention];
  const [firstLabel, secondLabel] = ANGLE_LABELS[orientation.convention];
  return [
    row(
      selectField<OrientationConvention>({
        label: "Orientation",
        help: "mean normal of the Fisher distribution",
        value: orientation.convention,
        choices: [
          ["theta_phi", "Theta and phi"],
          ["trend_plunge", "Trend and plunge"],
          ["dip_strike", "Dip and strike"],
        ],
        onInput: (value) => {
          orientation.convention = value;
          context.rerender();
        },
      }),
      numberField({
        label: "Concentration",
        key: "kappa",
        help: "large = all normals near the mean",
        value: orientation.kappa,
        min: 0,
        isMinExclusive: true,
        onInput: (value) => {
          orientation.kappa = value;
          context.changed();
        },
      }),
    ),
    row(
      numberField({
        label: firstLabel,
        key: firstKey,
        value: orientation.firstAngle,
        onInput: (value) => {
          orientation.firstAngle = value;
          context.changed();
        },
      }),
      numberField({
        label: secondLabel,
        key: secondKey,
        value: orientation.secondAngle,
        onInput: (value) => {
          orientation.secondAngle = value;
          context.changed();
        },
      }),
    ),
  ];
}

function regionField(family: FamilyState, context: FormContext): HTMLElement {
  const choices: [string, string][] = [["", "Whole mesh"], ...context.regionNames.map((name): [string, string] => [name, name])];
  if (family.region !== null && !context.regionNames.includes(family.region)) {
    choices.push([family.region, `${family.region} (not in the mesh)`]);
  }
  return selectField<string>({
    label: "Region",
    key: "region",
    help: "the fracture centers are in the cells of the region",
    value: family.region ?? "",
    choices,
    onInput: (value) => {
      family.region = value === "" ? null : value;
      context.changed();
    },
  });
}

function familyCard(state: FormState, index: number, context: FormContext, updateSum: () => void): HTMLElement {
  const family = state.families[index];
  const card = element("div", "family-card");

  const header = element("div", "family-header");
  header.append(element("h4", undefined, `Family ${index + 1}`));
  const actions = element("div", "family-actions");
  const addAction = (label: string, title: string, action: () => void) => {
    const button = element("button", "button-small", label);
    button.type = "button";
    button.title = title;
    button.addEventListener("click", () => {
      action();
      context.rerender();
    });
    actions.append(button);
  };
  addAction("Duplicate", "Add a copy of this family", () => {
    state.families.splice(index + 1, 0, structuredClone(family));
  });
  addAction("Remove", "Remove this family", () => {
    state.families.splice(index, 1);
  });
  header.append(actions);
  card.append(header);

  const isP32 = state.generation.stopCondition === "p32";
  const firstRow = row(
    numberField({
      label: "Probability",
      key: "probability",
      help: "chance to select this family",
      value: family.probability,
      min: 0,
      onInput: (value) => {
        family.probability = value;
        updateSum();
        context.changed();
      },
    }),
  );
  if (isP32) {
    firstRow.append(
      numberField({
        label: "P32 target",
        key: "p32_target",
        help: "fracture area × 2 / region volume",
        value: family.p32Target,
        min: 0,
        isMinExclusive: true,
        onInput: (value) => {
          family.p32Target = value;
          context.changed();
        },
      }),
    );
  }

  card.append(
    firstRow,
    row(
      numberField({
        label: "Number of points",
        key: "number_of_points",
        help: "3 or more; 4 = rectangle",
        value: family.numberOfPoints,
        isInteger: true,
        min: 3,
        onInput: (value) => {
          family.numberOfPoints = value;
          context.changed();
        },
      }),
      numberField({
        label: "Aspect ratio",
        key: "aspect_ratio",
        help: "y radius / x radius",
        value: family.aspectRatio,
        min: 0,
        isMinExclusive: true,
        onInput: (value) => {
          family.aspectRatio = value;
          context.changed();
        },
      }),
    ),
    row(
      regionField(family, context),
      optionalNumberField({
        label: "Rotation β (°)",
        key: "beta",
        help: "empty = uniform rotation",
        placeholder: "uniform",
        value: family.beta,
        onInput: (value) => {
          family.beta = value;
          context.changed();
        },
      }),
    ),
    ...radiusFields(family, context),
    ...orientationFields(family, context),
    ...apertureFields(
      {
        label: "Aperture",
        key: "aperture",
        help: state.mesh.enable ? "necessary with the mesh" : "only for the mesh; no effect without it",
        aperture: family.aperture,
        onSelect: (aperture) => {
          family.aperture = aperture;
        },
      },
      context,
    ),
  );
  return card;
}

/** Shows the sum of the probabilities, with a warning outside 0.999 to 1.001 */
function showProbabilitySum(state: FormState, note: HTMLElement): void {
  const sum = state.families.reduce((total, family) => total + family.probability, 0);
  const isValid = Math.abs(sum - 1) <= PROBABILITY_TOLERANCE;
  note.className = isValid ? "form-note" : "form-note is-warning";
  note.textContent = `Sum of the probabilities: ${Number(sum.toFixed(6))}${isValid ? "" : " (must be 1)"}`;
}

export function familiesSection(state: FormState, context: FormContext): HTMLElement {
  const container = section("Fracture families");
  const sumNote = element("p");
  const updateSum = () => showProbabilitySum(state, sumNote);
  if (state.families.length === 0) {
    container.append(element("p", "form-note", "No stochastic family: the network has only the user-defined fractures."));
  } else {
    updateSum();
    container.append(sumNote);
  }
  state.families.forEach((_family, index) => container.append(familyCard(state, index, context, updateSum)));

  const addButton = element("button", "button", "Add family");
  addButton.type = "button";
  addButton.addEventListener("click", () => {
    state.families.push(defaultFamily());
    context.rerender();
  });
  container.append(addButton);
  return container;
}
