// Form fields: a label, an input element, and a help text with the unit and
// the limits of the key (as in README.md).

export interface FieldOptions {
  label: string;
  /** TOML key, shown in the help text */
  key?: string;
  help?: string;
  isDisabled?: boolean;
  /** A swatch of this CSS color before the label */
  labelColor?: string;
}

export interface NumberFieldOptions extends FieldOptions {
  value: number;
  isInteger?: boolean;
  min?: number;
  /** The value must be above `min` (not equal) */
  isMinExclusive?: boolean;
  max?: number;
  step?: number | "any";
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
  field.append(fieldLabel(options), input);
  appendHelp(field, options);
  return field;
}

function fieldLabel(options: FieldOptions): HTMLElement {
  const title = element("span", "field-label", options.label);
  if (options.labelColor !== undefined) {
    const swatch = element("span", "label-swatch");
    swatch.style.backgroundColor = options.labelColor;
    title.prepend(swatch);
  }
  return title;
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
  return fieldShell(options, input);
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
  field.append(input, fieldLabel(options));
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
