// The fields of the pair of angles of an orientation: for the mean normal of
// a family and the normal of a user-defined fracture. The pair is the one of
// the page (settings dialog).
import type { FormContext } from "./context";
import { numberField } from "./fields";
import { ORIENTATION_KEYS, type OrientationConvention, type PlaneOrientationState } from "./state";

const ANGLE_LABELS: Record<OrientationConvention, [string, string]> = {
  theta_phi: ["Theta (°)", "Phi (°)"],
  trend_plunge: ["Trend (°)", "Plunge (°)"],
  dip_strike: ["Dip (°)", "Strike (°)"],
};

/** The two angles of the convention; `help` (what the normal is) goes to the first */
export function angleFields(
  orientation: PlaneOrientationState,
  convention: OrientationConvention,
  help: string,
  context: FormContext,
): HTMLElement[] {
  const [firstKey, secondKey] = ORIENTATION_KEYS[convention];
  const [firstLabel, secondLabel] = ANGLE_LABELS[convention];
  return [
    numberField({
      label: firstLabel,
      key: firstKey,
      help,
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
