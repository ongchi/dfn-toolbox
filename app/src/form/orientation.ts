// The fields of the pair of angles of an orientation: for the mean normal of
// a family and the normal of a user-defined fracture.
import type { FormContext } from "./context";
import { numberField, selectField } from "./fields";
import { ORIENTATION_KEYS, type OrientationConvention, type PlaneOrientationState } from "./state";

const ANGLE_LABELS: Record<OrientationConvention, [string, string]> = {
  theta_phi: ["Theta (°)", "Phi (°)"],
  trend_plunge: ["Trend (°)", "Plunge (°)"],
  dip_strike: ["Dip (°)", "Strike (°)"],
};

/** The select of the convention; a new convention shows its angle fields */
export function conventionField(orientation: PlaneOrientationState, help: string, context: FormContext): HTMLElement {
  return selectField<OrientationConvention>({
    label: "Orientation",
    help,
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
  });
}

/** The two angles of the convention */
export function angleFields(orientation: PlaneOrientationState, context: FormContext): HTMLElement[] {
  const [firstKey, secondKey] = ORIENTATION_KEYS[orientation.convention];
  const [firstLabel, secondLabel] = ANGLE_LABELS[orientation.convention];
  return [
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
  ];
}
