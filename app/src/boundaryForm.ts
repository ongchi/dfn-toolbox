// The boundary surfaces of the Domain panel: three groups (in-flow, out-flow,
// no flow) with the role of each surface, and the pressure of the flow on
// each in-flow and out-flow surface.
import type { SurfaceRole } from "./boundaryRoles";
import type { HighlightItem } from "./form/fields";
import { bindSurfaceHighlight, element, helpText, numberField, section } from "./form/fields";

const ROLE_CHOICES: [SurfaceRole, string][] = [
  ["inflow", "in-flow"],
  ["outflow", "out-flow"],
  ["noflow", "no flow"],
];

const GROUPS: [SurfaceRole, string][] = [
  ["inflow", "In-flow"],
  ["outflow", "Out-flow"],
  ["noflow", "No flow"],
];

export interface BoundarySurfaceHandlers {
  roleOf(name: string): SurfaceRole;
  onRole(name: string, role: SurfaceRole): void;
  /** MPa */
  pressureOf(name: string): number;
  onPressure(name: string, pressure: number): void;
  /** False if the triangle mesh has no point on the surface; true before a triangle mesh */
  hasPoints(name: string): boolean;
  /** A surface is highlighted in the 3D view (`bindSurfaceHighlight`), or the pinned item again; null = none */
  onHover(item: HighlightItem | null): void;
}

function roleSelect(name: string, handlers: BoundarySurfaceHandlers): HTMLSelectElement {
  const select = element("select");
  select.dataset.surface = name;
  select.setAttribute("aria-label", `Role of ${name}`);
  for (const [value, text] of ROLE_CHOICES) {
    const option = new Option(text, value);
    option.selected = value === handlers.roleOf(name);
    select.append(option);
  }
  select.addEventListener("change", () => handlers.onRole(name, select.value as SurfaceRole));
  return select;
}

/** An in-flow or out-flow surface: its name, its pressure and its role */
function pressureRow(name: string, handlers: BoundarySurfaceHandlers): HTMLElement {
  const row = numberField({
    label: name,
    value: handlers.pressureOf(name),
    min: 0.001,
    max: 110,
    onInput: (value) => handlers.onPressure(name, value),
  });
  row.classList.add("boundary-row");
  row.append(element("span", "unit", "MPa"), roleSelect(name, handlers));
  if (!handlers.hasPoints(name)) {
    row.append(element("span", "field-help is-warning", "The network has no point on this surface: the flow does not use it."));
  }
  bindSurfaceHighlight(row, name, handlers.onHover);
  return row;
}

/** A no-flow surface: its name and its role */
function surfaceChip(name: string, handlers: BoundarySurfaceHandlers): HTMLElement {
  const chip = element("label", "surface-chip");
  chip.append(element("span", "field-label", name), roleSelect(name, handlers));
  bindSurfaceHighlight(chip, name, handlers.onHover);
  return chip;
}

function groupSection(role: SurfaceRole, title: string, names: string[], handlers: BoundarySurfaceHandlers): HTMLElement {
  const members = names.filter((name) => handlers.roleOf(name) === role);
  if (members.length === 0) {
    return section(title, element("p", "form-note", "No surface"));
  }
  if (role !== "noflow") {
    return section(title, ...members.map((name) => pressureRow(name, handlers)));
  }
  const chips = element("div", "surface-chips");
  chips.append(...members.map((name) => surfaceChip(name, handlers)));
  return section(title, chips);
}

/** The boundary surfaces of the domain mesh in the groups of their roles */
export function boundarySurfaceSections(names: string[], handlers: BoundarySurfaceHandlers): HTMLElement[] {
  const help = helpText(
    undefined,
    "The pointer over a surface highlights it in the 3D view, and a click (a tap) on its name keeps it highlighted until a second click. The network keeps only the clusters which connect an in-flow and an out-flow surface. The flow has a pressure (0.001 to 110 MPa) on each of them; a point on two surfaces keeps the pressure of the higher surface in this panel. The particles go from the in-flow to the out-flow surfaces.",
  );
  return [...GROUPS.map(([role, title]) => groupSection(role, title, names, handlers)), ...(help ? [help] : [])];
}
