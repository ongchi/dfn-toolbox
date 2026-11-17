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

/** A boundary surface or a region of the domain mesh, which the 3D view can highlight */
export interface HighlightItem {
  kind: "surface" | "region";
  name: string;
}

/** The surface or region which a click on its row or field keeps highlighted (one for the page); null = none */
let pinnedItem: HighlightItem | null = null;

export function getPinnedItem(): HighlightItem | null {
  return pinnedItem;
}

/** Another domain mesh: its surfaces and regions are others */
export function clearPinnedItem(): void {
  pinnedItem = null;
}

export function isSameItem(first: HighlightItem | null, second: HighlightItem | null): boolean {
  return first?.kind === second?.kind && first?.name === second?.name;
}

/** The pin after a click on the row or field of `item`: a second click removes it */
export function pinAfterClick(pinned: HighlightItem | null, item: HighlightItem): HighlightItem | null {
  return isSameItem(pinned, item) ? null : item;
}

/** The pin after a new choice in a dropdown: the pin of the old choice goes to the new one (none: no pin) */
export function pinAfterChoice(
  pinned: HighlightItem | null,
  oldItem: HighlightItem | null,
  newItem: HighlightItem | null,
): HighlightItem | null {
  return oldItem !== null && isSameItem(pinned, oldItem) ? newItem : pinned;
}

/** The highlight item of a row or field: its attribute `data-highlight-surface` or `data-highlight-region` */
function targetItem(target: HTMLElement): HighlightItem | null {
  const { highlightSurface, highlightRegion } = target.dataset;
  if (highlightSurface !== undefined) {
    return { kind: "surface", name: highlightSurface };
  }
  return highlightRegion === undefined ? null : { kind: "region", name: highlightRegion };
}

/** The rows and fields of the surfaces and regions show the pin */
function markPinnedTargets(): void {
  for (const target of document.querySelectorAll<HTMLElement>("[data-highlight-surface], [data-highlight-region]")) {
    markPin(target);
  }
}

function markPin(target: HTMLElement): void {
  const item = targetItem(target);
  const isPinned = item !== null && isSameItem(item, pinnedItem);
  target.classList.toggle("is-pinned", isPinned);
  target.setAttribute("aria-pressed", String(isPinned));
}

/**
 * Highlights the item of `target` while the pointer is over it; then the
 * pinned item shows again. A click on `target` pins the item, a second click
 * unpins it; a click in a dropdown or an input only edits its value. On a
 * touch screen the tap is the click, and the hover is not used: the mouse
 * events which a browser makes from a tap must not change the highlight.
 */
function bindHighlight(target: HTMLElement, highlight: (item: HighlightItem | null) => void): void {
  markPin(target);
  target.addEventListener("click", (event) => {
    const item = targetItem(target);
    if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement || item === null) {
      return;
    }
    // The label does not focus its input: on a phone that opens the keyboard
    event.preventDefault();
    pinnedItem = pinAfterClick(pinnedItem, item);
    markPinnedTargets();
    highlight(pinnedItem);
  });
  if (globalThis.matchMedia?.("(hover: none)").matches) {
    return;
  }
  target.addEventListener("mouseenter", () => highlight(targetItem(target)));
  target.addEventListener("mouseleave", () => highlight(pinnedItem));
}

/** The highlight of a boundary surface by its row or field (see `bindHighlight`) */
export function bindSurfaceHighlight(target: HTMLElement, name: string, highlight: (item: HighlightItem | null) => void): void {
  target.dataset.highlightSurface = name;
  bindHighlight(target, highlight);
}

/**
 * The highlight of the region of a Region field (see `bindHighlight`): the
 * region of its dropdown, none for a value which is not in `regionNames`
 * ("Whole mesh", a region which is not in the mesh). A new choice shows the
 * new region at once, and takes the pin of the old one.
 */
export function bindRegionHighlight(field: HTMLElement, regionNames: string[], highlight: (item: HighlightItem | null) => void): void {
  const select = field.querySelector("select");
  if (select === null) {
    return;
  }
  const setRegion = () => {
    if (regionNames.includes(select.value)) {
      field.dataset.highlightRegion = select.value;
    } else {
      delete field.dataset.highlightRegion;
    }
  };
  setRegion();
  select.addEventListener("change", () => {
    const oldItem = targetItem(field);
    setRegion();
    const newItem = targetItem(field);
    pinnedItem = pinAfterChoice(pinnedItem, oldItem, newItem);
    markPinnedTargets();
    highlight(newItem ?? pinnedItem);
  });
  bindHighlight(field, highlight);
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
  /** Whole numbers (a count) */
  isInteger?: boolean;
  onInput: (value: number) => void;
}

/** The value at a slider position, without the rounding noise of the steps; `isInteger` rounds to a whole number */
export function sliderValue(position: number, isLogScale: boolean, isInteger = false): number {
  const value = isLogScale ? 10 ** position : position;
  const rounded = Number(value.toPrecision(isLogScale ? 3 : 12));
  return isInteger ? Math.round(rounded) : rounded;
}

/** A step of the sliders of lengths: the power of 10 near a thousandth of the size */
export function lengthStep(size: number): number {
  return 10 ** Math.floor(Math.log10(size / 1000));
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
    const value = sliderValue(input.valueAsNumber, isLogScale, options.isInteger);
    valueText.textContent = String(value);
    valueText.classList.remove("is-invalid");
    options.onInput(value);
  });
  const sliderRow = element("span", "slider-row");
  sliderRow.append(input, valueText);
  return fieldShell(options, sliderRow);
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
