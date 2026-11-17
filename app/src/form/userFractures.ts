// The user-defined fractures: one card for each `[[network.user_fracture]]`.
import type { RegionBounds } from "../inputFiles";
import type { FormContext } from "./context";
import { bindRegionHighlight, element, row, section, selectField, sliderField } from "./fields";
import { angleFields } from "./orientation";
import { defaultUserFracture, type FormState, type UserFractureState } from "./state";

const AXES = ["x", "y", "z"] as const;

function boxCenter(bounds: RegionBounds): [number, number, number] {
  return [0, 1, 2].map((axis) => (bounds.min[axis] + bounds.max[axis]) / 2) as [number, number, number];
}

function regionField(fracture: UserFractureState, context: FormContext): HTMLElement {
  const names = context.regionBounds.map((bounds) => bounds.name);
  const choices: [string, string][] = names.map((name) => [name, name]);
  if (!names.includes(fracture.region)) {
    choices.push([fracture.region, `${fracture.region} (not in the mesh)`]);
  }
  const field = selectField<string>({
    label: "Region",
    key: "region",
    help: "the center is in the bounding box of its cells; the pointer highlights it in the 3D view",
    value: fracture.region,
    choices,
    onInput: (value) => {
      fracture.region = value;
      const bounds = context.regionBounds.find((candidate) => candidate.name === value);
      if (bounds) {
        fracture.center = boxCenter(bounds);
      }
      context.rerender();
    },
  });
  bindRegionHighlight(field, names, context.highlight);
  return field;
}

/** A step of the sliders of lengths: the power of 10 near a thousandth of the size */
function lengthStep(size: number): number {
  return 10 ** Math.floor(Math.log10(size / 1000));
}

/** x, y and z of the center, in the bounding box of the region */
function centerFields(fracture: UserFractureState, bounds: RegionBounds | undefined, context: FormContext): HTMLElement[] {
  return AXES.map((axis, index) => {
    const min = bounds?.min[index] ?? fracture.center[index];
    const max = bounds?.max[index] ?? fracture.center[index];
    return sliderField({
      label: `Center ${axis} (m)`,
      help: bounds ? `${min} to ${max}` : "the region is not in the mesh",
      value: fracture.center[index],
      min,
      max,
      step: bounds ? lengthStep(max - min) : 1,
      isDisabled: !bounds,
      onInput: (value) => {
        fracture.center[index] = value;
        context.changed();
      },
    });
  });
}

/** Radius up to the largest side of the bounding box of the region */
function radiusField(fracture: UserFractureState, bounds: RegionBounds | undefined, context: FormContext): HTMLElement {
  const largestSide = bounds ? Math.max(...AXES.map((_axis, index) => bounds.max[index] - bounds.min[index])) : fracture.radius;
  const step = bounds ? lengthStep(largestSide) : 1;
  return sliderField({
    label: "Radius (m)",
    key: "radius",
    help: "of the circle of the points",
    value: fracture.radius,
    min: step,
    max: largestSide,
    step,
    isDisabled: !bounds,
    onInput: (value) => {
      fracture.radius = value;
      context.changed();
    },
  });
}

function fractureCard(state: FormState, index: number, formContext: FormContext): HTMLElement {
  const fracture = state.userFractures[index];
  // A change of a value of the card shows the polygon of this fracture
  const context: FormContext = {
    ...formContext,
    changed: () => {
      formContext.previewUserFracture?.(index);
      formContext.changed();
    },
    rerender: () => {
      formContext.previewUserFracture?.(index);
      formContext.rerender();
    },
  };
  const bounds = context.regionBounds.find((candidate) => candidate.name === fracture.region);
  const card = element("div", "family-card");

  const header = element("div", "family-header");
  header.append(element("h4", undefined, `Fracture ${index + 1}`));
  const actions = element("div", "family-actions");
  const removeButton = element("button", "button-small", "Remove");
  removeButton.type = "button";
  removeButton.title = "Remove this fracture";
  removeButton.addEventListener("click", () => {
    state.userFractures.splice(index, 1);
    formContext.previewUserFracture?.(null);
    formContext.rerender();
  });
  actions.append(removeButton);
  header.append(actions);
  card.append(header);

  card.append(
    row(regionField(fracture, context)),
    ...centerFields(fracture, bounds, context).map((field) => row(field)),
    row(radiusField(fracture, bounds, context)),
    row(
      sliderField({
        label: "Aspect ratio",
        key: "aspect_ratio",
        help: "y radius / x radius",
        value: fracture.aspectRatio,
        min: 0.1,
        max: 1,
        step: 0.01,
        onInput: (value) => {
          fracture.aspectRatio = value;
          context.changed();
        },
      }),
      sliderField({
        label: "Rotation β (°)",
        key: "beta",
        help: "in the plane of the fracture",
        value: fracture.beta,
        min: 0,
        max: 360,
        step: 1,
        onInput: (value) => {
          fracture.beta = value;
          context.changed();
        },
      }),
    ),
    row(
      sliderField({
        label: "Aperture (m)",
        key: "aperture",
        help: "for the flow",
        value: fracture.aperture,
        min: 1e-6,
        max: 1e-2,
        step: 0.01,
        isLogScale: true,
        onInput: (value) => {
          fracture.aperture = value;
          context.changed();
        },
      }),
    ),
    row(...angleFields(fracture.orientation, state.orientationConvention, "normal of the fracture", context)),
  );
  return card;
}

export function userFracturesSection(state: FormState, context: FormContext): HTMLElement {
  const container = section("User-defined fractures");
  const hasRegions = context.regionBounds.length > 0;
  if (state.userFractures.length === 0) {
    container.append(element("p", "form-note", "No user-defined fracture."));
  }
  state.userFractures.forEach((_fracture, index) => container.append(fractureCard(state, index, context)));

  if (!hasRegions) {
    container.append(element("p", "form-note", "The domain mesh has no region: a user-defined fracture needs one."));
  }
  const addButton = element("button", "button", "Add fracture");
  addButton.type = "button";
  addButton.disabled = !hasRegions;
  addButton.addEventListener("click", () => {
    const bounds = context.regionBounds[0];
    state.userFractures.push(defaultUserFracture(bounds.name, boxCenter(bounds)));
    context.previewUserFracture?.(state.userFractures.length - 1);
    context.rerender();
  });
  container.append(addButton);
  return container;
}
