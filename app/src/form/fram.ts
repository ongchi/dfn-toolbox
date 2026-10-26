import type { FormContext } from "./context";
import { checkboxField, numberField, section } from "./fields";
import type { FormState } from "./state";

export function framSection(state: FormState, context: FormContext): HTMLElement {
  const fram = state.fram;
  const isOff = !fram.enable;
  return section(
    "FRAM",
    checkboxField({
      label: "FRAM on",
      key: "enable",
      help: "off = fractures can intersect with no limit, and the other keys have no effect",
      value: fram.enable,
      onInput: (value) => {
        fram.enable = value;
        context.rerender();
      },
    }),
    checkboxField({
      label: "Relaxed",
      key: "relaxed",
      help: "reject only short intersections and fractures in the same plane",
      value: fram.relaxed,
      isDisabled: isOff,
      onInput: (value) => {
        fram.relaxed = value;
        context.rerender();
      },
    }),
    checkboxField({
      label: "Allow triple intersections",
      key: "triple_intersections",
      help: fram.relaxed ? "no effect with `relaxed`" : "off = reject a fracture which makes a triple intersection",
      value: fram.tripleIntersections,
      isDisabled: isOff || fram.relaxed,
      onInput: (value) => {
        fram.tripleIntersections = value;
        context.changed();
      },
    }),
    checkboxField({
      label: "Check user-defined fractures",
      key: "check_user_fractures",
      help: "off = no FRAM for two user-defined fractures",
      value: fram.checkUserFractures,
      isDisabled: isOff,
      onInput: (value) => {
        fram.checkUserFractures = value;
        context.changed();
      },
    }),
    checkboxField({
      label: "Write rejected fractures",
      key: "write_rejected_fractures",
      help: "keep the rejected fractures (Rejected in the 3D view); they can use much memory",
      value: fram.writeRejectedFractures,
      isDisabled: isOff,
      onInput: (value) => {
        fram.writeRejectedFractures = value;
        context.changed();
      },
    }),
    numberField({
      label: "Rejects per fracture",
      key: "rejects_per_fracture",
      help: "FRAM rejects of a stochastic fracture before it is rejected; it moves after each reject",
      value: fram.rejectsPerFracture,
      isInteger: true,
      min: 0,
      isDisabled: isOff,
      onInput: (value) => {
        fram.rejectsPerFracture = value;
        context.changed();
      },
    }),
  );
}
