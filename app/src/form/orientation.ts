// The fields of the pair of angles of an orientation: for the mean normal of
// a family and the normal of a user-defined fracture. The pair is the one of
// the page (settings dialog).
import type { FormContext } from "./context";
import { sliderField } from "./fields";
import { ORIENTATION_KEYS, type OrientationConvention, type PlaneOrientationState } from "./state";

const ANGLE_LABELS: Record<OrientationConvention, [string, string]> = {
  theta_phi: ["Theta (°)", "Phi (°)"],
  trend_plunge: ["Trend (°)", "Plunge (°)"],
  dip_strike: ["Dip (°)", "Strike (°)"],
};

/** The limits of the angles, as `anglesOfNormal` gives them */
const ANGLE_LIMITS: Record<OrientationConvention, [[number, number], [number, number]]> = {
  theta_phi: [
    [0, 180],
    [0, 360],
  ],
  trend_plunge: [
    [0, 360],
    [-90, 90],
  ],
  dip_strike: [
    [0, 180],
    [0, 360],
  ],
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
  const [[firstMin, firstMax], [secondMin, secondMax]] = ANGLE_LIMITS[convention];
  return [
    sliderField({
      label: firstLabel,
      key: firstKey,
      help,
      value: orientation.firstAngle,
      min: firstMin,
      max: firstMax,
      step: 1,
      onInput: (value) => {
        orientation.firstAngle = value;
        context.changed();
      },
    }),
    sliderField({
      label: secondLabel,
      key: secondKey,
      value: orientation.secondAngle,
      min: secondMin,
      max: secondMax,
      step: 1,
      onInput: (value) => {
        orientation.secondAngle = value;
        context.changed();
      },
    }),
  ];
}
