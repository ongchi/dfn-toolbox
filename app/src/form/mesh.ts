import { optionalApertureFields } from "./aperture";
import type { FormContext } from "./context";
import { checkboxField, element, numberField, row, section } from "./fields";
import type { FormState } from "./state";

/** The boundary lines and the mesh are always on: the flow needs them */
export function meshSection(state: FormState, context: FormContext): HTMLElement {
  const mesh = state.mesh;
  return section(
    "Triangle mesh for the flow",
    element(
      "p",
      "form-note",
      "The generation always writes the boundary lines of the regions (fracture_boundaries.vtp) and the triangle mesh of the final fractures (dfn_mesh.vtu). The boundary lines give the boundaries of the flow.",
    ),
    checkboxField({
      label: "Use the family region",
      key: "use_family_region",
      help: "off = the lines of each stochastic fracture are at the mesh surface, also if its family has a region",
      value: state.regionBoundaries.useFamilyRegion,
      onInput: (value) => {
        state.regionBoundaries.useFamilyRegion = value;
        context.changed();
      },
    }),
    row(
      numberField({
        label: "Maximum size factor",
        key: "max_size_factor",
        help: "largest triangle size = factor × `min_feature_size`",
        value: mesh.maxSizeFactor,
        min: 1,
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
        onInput: (value) => {
          mesh.slope = value;
          context.changed();
        },
      }),
    ),
    ...optionalApertureFields(
      {
        label: "User-defined fracture aperture",
        key: "user_fracture_aperture",
        help: "necessary with a user-defined fracture file",
        aperture: mesh.userFractureAperture,
        onSelect: (aperture) => {
          mesh.userFractureAperture = aperture;
        },
      },
      context,
    ),
  );
}
