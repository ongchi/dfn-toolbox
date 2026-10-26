// The user-defined fractures: one card for each `[[network.user_fracture]]`.
import type { RegionBounds } from "../inputFiles";
import type { FormContext } from "./context";
import { element, numberField, row, section, selectField } from "./fields";
import { angleFields, conventionField } from "./orientation";
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
  return selectField<string>({
    label: "Region",
    key: "region",
    help: "the center is in the bounding box of its cells",
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
}

/** x, y and z of the center, limited to the bounding box of the region */
function centerFields(fracture: UserFractureState, context: FormContext): HTMLElement[] {
  const bounds = context.regionBounds.find((candidate) => candidate.name === fracture.region);
  return AXES.map((axis, index) =>
    numberField({
      label: `Center ${axis} (m)`,
      help: bounds ? `${bounds.min[index]} to ${bounds.max[index]}` : undefined,
      value: fracture.center[index],
      min: bounds?.min[index],
      max: bounds?.max[index],
      onInput: (value) => {
        fracture.center[index] = value;
        context.changed();
      },
    }),
  );
}

function fractureCard(state: FormState, index: number, context: FormContext): HTMLElement {
  const fracture = state.userFractures[index];
  const card = element("div", "family-card");

  const header = element("div", "family-header");
  header.append(element("h4", undefined, `Fracture ${index + 1}`));
  const actions = element("div", "family-actions");
  const removeButton = element("button", "button-small", "Remove");
  removeButton.type = "button";
  removeButton.title = "Remove this fracture";
  removeButton.addEventListener("click", () => {
    state.userFractures.splice(index, 1);
    context.rerender();
  });
  actions.append(removeButton);
  header.append(actions);
  card.append(header);

  card.append(
    row(regionField(fracture, context)),
    row(...centerFields(fracture, context)),
    row(
      numberField({
        label: "Number of points",
        key: "number_of_points",
        help: "3 or more; 4 = rectangle",
        value: fracture.numberOfPoints,
        isInteger: true,
        min: 3,
        onInput: (value) => {
          fracture.numberOfPoints = value;
          context.changed();
        },
      }),
      numberField({
        label: "Radius (m)",
        key: "radius",
        help: "of the circle of the points",
        value: fracture.radius,
        min: 0,
        isMinExclusive: true,
        onInput: (value) => {
          fracture.radius = value;
          context.changed();
        },
      }),
    ),
    row(
      numberField({
        label: "Aspect ratio",
        key: "aspect_ratio",
        help: "y radius / x radius",
        value: fracture.aspectRatio,
        min: 0,
        isMinExclusive: true,
        onInput: (value) => {
          fracture.aspectRatio = value;
          context.changed();
        },
      }),
      numberField({
        label: "Rotation β (°)",
        key: "beta",
        help: "in the plane of the fracture",
        value: fracture.beta,
        onInput: (value) => {
          fracture.beta = value;
          context.changed();
        },
      }),
    ),
    row(conventionField(fracture.orientation, "normal of the fracture", context)),
    row(...angleFields(fracture.orientation, context)),
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
    context.rerender();
  });
  container.append(addButton);
  return container;
}
