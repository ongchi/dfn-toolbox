// Form fields: a label, an input element, and a help text with the unit and
// the limits of the key (as in README.md).

export interface FieldOptions {
  label: string;
  /** TOML key, shown in the help text */
  key?: string;
  help?: string;
  isDisabled?: boolean;
}

export interface NumberFieldOptions extends FieldOptions {
  value: number;
  isInteger?: boolean;
  min?: number;
  /** The value must be above `min` (not equal) */
  isMinExclusive?: boolean;
  max?: number;
  step?: number | "any";
  /** A button at the right of the input */
  button?: HTMLElement;
  onInput: (value: number) => void;
}

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function fieldShell(options: FieldOptions, input: HTMLElement): HTMLElement {
  const field = element("label", "field");
  if (options.isDisabled) {
    field.classList.add("is-disabled");
  }
  field.append(element("span", "field-label", options.label), input);
  appendHelp(field, options);
  return field;
}

/** The surface which a click on its row or field keeps highlighted (one for the page); null = none */
let pinnedSurface: string | null = null;

export function getPinnedSurface(): string | null {
  return pinnedSurface;
}

/** Another domain mesh: its surfaces are other surfaces */
export function clearPinnedSurface(): void {
  pinnedSurface = null;
}

/** The rows and fields of the surfaces show the pin */
function markPinnedTargets(): void {
  for (const target of document.querySelectorAll<HTMLElement>("[data-highlight-surface]")) {
    const isPinned = target.dataset.highlightSurface === pinnedSurface;
    target.classList.toggle("is-pinned", isPinned);
    target.setAttribute("aria-pressed", String(isPinned));
  }
}

/**
 * Highlights a surface while the pointer is over `target`; then the pinned
 * surface shows again. A click on `target` pins the surface, a second click
 * unpins it; a click in a dropdown or an input only edits its value. On a
 * touch screen the tap is the click, and the hover is not used: the mouse
 * events which a browser makes from a tap must not change the highlight.
 */
export function bindSurfaceHighlight(target: HTMLElement, name: string, highlight: (name: string | null) => void): void {
  target.dataset.highlightSurface = name;
  target.classList.toggle("is-pinned", name === pinnedSurface);
  target.setAttribute("aria-pressed", String(name === pinnedSurface));
  target.addEventListener("click", (event) => {
    if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) {
      return;
    }
    // The label does not focus its input: on a phone that opens the keyboard
    event.preventDefault();
    pinnedSurface = pinnedSurface === name ? null : name;
    markPinnedTargets();
    highlight(pinnedSurface);
  });
  if (globalThis.matchMedia?.("(hover: none)").matches) {
    return;
  }
  target.addEventListener("mouseenter", () => highlight(name));
  target.addEventListener("mouseleave", () => highlight(pinnedSurface));
}

/** Help text: the key and the help, with `code` in backticks; null without both */
export function helpText(key: string | undefined, text: string | undefined): HTMLElement | null {
  const parts = [key ? `\`${key}\`` : "", text ?? ""].filter((part) => part !== "");
  if (parts.length === 0) {
    return null;
  }
  const help = element("span", "field-help");
  help.innerHTML = parts
    .join(" · ")
    .replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character] ?? character)
    .replace(/`([^`]+)`/g, "<code>$1</code>");
  return help;
}

function appendHelp(field: HTMLElement, options: FieldOptions): void {
  const help = helpText(options.key, options.help);
  if (help) {
    field.append(help);
  }
}

/** Number input. An invalid text keeps the last valid value in the state. */
export function numberField(options: NumberFieldOptions): HTMLElement {
  const input = element("input");
  input.type = "number";
  input.value = String(options.value);
  input.step = String(options.step ?? (options.isInteger ? 1 : "any"));
  if (options.min !== undefined && !options.isMinExclusive) {
    input.min = String(options.min);
  }
  if (options.max !== undefined) {
    input.max = String(options.max);
  }
  input.disabled = options.isDisabled ?? false;
  input.required = true;
  const isValid = (value: number) =>
    Number.isFinite(value) &&
    (!options.isInteger || Number.isInteger(value)) &&
    (options.min === undefined || (options.isMinExclusive ? value > options.min : value >= options.min)) &&
    (options.max === undefined || value <= options.max);
  // A value of the state outside the limits (a new limit) is also invalid
  input.classList.toggle("is-invalid", !isValid(options.value));
  input.addEventListener("input", () => {
    const value = input.valueAsNumber;
    input.classList.toggle("is-invalid", !isValid(value));
    if (isValid(value)) {
      options.onInput(value);
    }
  });
  if (!options.button) {
    return fieldShell(options, input);
  }
  const inputRow = element("span", "input-with-button");
  inputRow.append(input, options.button);
  return fieldShell(options, inputRow);
}

export interface SliderFieldOptions extends FieldOptions {
  value: number;
  /** The limits of the value; with `isLogScale` above 0 */
  min: number;
  max: number;
  /** Step of the slider: of the value, or of its base-10 exponent with `isLogScale` */
  step: number;
  isLogScale?: boolean;
  onInput: (value: number) => void;
}

/** The value at a slider position, without the rounding noise of the steps */
export function sliderValue(position: number, isLogScale: boolean): number {
  const value = isLogScale ? 10 ** position : position;
  return Number(value.toPrecision(isLogScale ? 3 : 12));
}

/** The slider position of a value */
export function sliderPosition(value: number, isLogScale: boolean): number {
  return isLogScale ? Math.log10(value) : value;
}

/**
 * Range input with the value as text at its right. A value of the state
 * outside the limits (a loaded file) is invalid until the slider moves.
 */
export function sliderField(options: SliderFieldOptions): HTMLElement {
  const isLogScale = options.isLogScale ?? false;
  const input = element("input");
  input.type = "range";
  input.min = String(sliderPosition(options.min, isLogScale));
  input.max = String(sliderPosition(options.max, isLogScale));
  input.step = String(options.step);
  input.value = String(sliderPosition(options.value, isLogScale));
  input.disabled = options.isDisabled ?? false;
  const valueText = element("output", "slider-value", String(options.value));
  const isOutside = options.value < options.min || options.value > options.max;
  valueText.classList.toggle("is-invalid", isOutside);
  input.addEventListener("input", () => {
    const value = sliderValue(input.valueAsNumber, isLogScale);
    valueText.textContent = String(value);
    valueText.classList.remove("is-invalid");
    options.onInput(value);
  });
  const sliderRow = element("span", "slider-row");
  sliderRow.append(input, valueText);
  return fieldShell(options, sliderRow);
}

/** Number input which can be empty (an optional key) */
export function optionalNumberField(
  options: Omit<NumberFieldOptions, "value" | "onInput"> & {
    value: number | null;
    placeholder: string;
    onInput: (value: number | null) => void;
  },
): HTMLElement {
  const input = element("input");
  input.type = "number";
  input.step = "any";
  input.placeholder = options.placeholder;
  input.value = options.value === null ? "" : String(options.value);
  input.disabled = options.isDisabled ?? false;
  input.addEventListener("input", () => {
    if (input.value.trim() === "") {
      input.classList.remove("is-invalid");
      options.onInput(null);
      return;
    }
    const isValid = Number.isFinite(input.valueAsNumber);
    input.classList.toggle("is-invalid", !isValid);
    if (isValid) {
      options.onInput(input.valueAsNumber);
    }
  });
  return fieldShell(options, input);
}

export function textField(
  options: FieldOptions & {
    value: string;
    pattern?: string;
    /** A button at the right of the input */
    button?: HTMLElement;
    onInput: (value: string) => void;
  },
): { field: HTMLElement; input: HTMLInputElement } {
  const input = element("input");
  input.type = "text";
  input.value = options.value;
  input.disabled = options.isDisabled ?? false;
  input.spellcheck = false;
  if (options.pattern) {
    input.pattern = options.pattern;
  }
  input.addEventListener("input", () => {
    const isValid = options.pattern === undefined || new RegExp(`^(?:${options.pattern})$`).test(input.value);
    input.classList.toggle("is-invalid", !isValid);
    if (isValid) {
      options.onInput(input.value);
    }
  });
  if (!options.button) {
    return { field: fieldShell(options, input), input };
  }
  const inputRow = element("span", "input-with-button");
  inputRow.append(input, options.button);
  return { field: fieldShell(options, inputRow), input };
}

export function checkboxField(options: FieldOptions & { value: boolean; onInput: (value: boolean) => void }): HTMLElement {
  const field = element("label", "field field-checkbox");
  if (options.isDisabled) {
    field.classList.add("is-disabled");
  }
  const input = element("input");
  input.type = "checkbox";
  input.checked = options.value;
  input.disabled = options.isDisabled ?? false;
  input.addEventListener("change", () => options.onInput(input.checked));
  field.append(input, element("span", "field-label", options.label));
  appendHelp(field, options);
  return field;
}

export function selectField<T extends string>(
  options: FieldOptions & { value: T; choices: [T, string][]; onInput: (value: T) => void },
): HTMLElement {
  const select = element("select");
  for (const [value, label] of options.choices) {
    const option = element("option", undefined, label);
    option.value = value;
    option.selected = value === options.value;
    select.append(option);
  }
  select.disabled = options.isDisabled ?? false;
  select.addEventListener("change", () => options.onInput(select.value as T));
  return fieldShell(options, select);
}

/** A group of fields with a title */
export function section(title: string, ...children: HTMLElement[]): HTMLElement {
  const group = element("section", "form-section");
  group.append(element("h3", undefined, title), ...children);
  return group;
}

/** Fields side by side */
export function row(...children: HTMLElement[]): HTMLElement {
  const container = element("div", "field-row");
  container.append(...children);
  return container;
}
