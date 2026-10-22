import { apertureFields } from "./aperture";
import type { FormContext } from "./context";
import { checkboxField, numberField, row, section } from "./fields";
import type { FormState } from "./state";

export function meshSection(state: FormState, context: FormContext): HTMLElement {
  const mesh = state.mesh;
  const isOff = !mesh.enable;
  return section(
    "Triangle mesh for fehm-rs",
    checkboxField({
      label: "Mesh on",
      key: "enable",
      help: state.regionBoundaries.enable
        ? "write the triangle mesh of the final fractures (`dfn_mesh.vtu`); each family needs an aperture"
        : "needs the boundary lines of the regions on",
      value: mesh.enable,
      onInput: (value) => {
        mesh.enable = value;
        context.rerender();
      },
    }),
    row(
      numberField({
        label: "Maximum size factor",
        key: "max_size_factor",
        help: "largest triangle size = factor × `min_feature_size`",
        value: mesh.maxSizeFactor,
        min: 1,
        isDisabled: isOff,
        onInput: (value) => {
          mesh.maxSizeFactor = value;
          context.changed();
        },
      }),
      numberField({
        label: "Slope",
        key: "slope",
        help: "growth of the triangle size with the distance from an intersection or a boundary line",
        value: mesh.slope,
        min: 0,
        isMinExclusive: true,
        isDisabled: isOff,
        onInput: (value) => {
          mesh.slope = value;
          context.changed();
        },
      }),
    ),
    ...apertureFields(
      {
        label: "User-defined fracture aperture",
        key: "user_fracture_aperture",
        help: "necessary with a user-defined fracture file",
        isDisabled: isOff,
        aperture: mesh.userFractureAperture,
        onSelect: (aperture) => {
          mesh.userFractureAperture = aperture;
        },
      },
      context,
    ),
  );
}
