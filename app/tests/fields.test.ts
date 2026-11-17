// The values of the slider positions of the form fields, and the pin of the highlight.
import { expect, test } from "vitest";
import {
  getOpenCard,
  openCardAfterRemove,
  openCardAfterToggle,
  pinAfterChoice,
  pinAfterClick,
  resetOpenCards,
  setOpenCard,
  sliderPosition,
  sliderValue,
  type HighlightItem,
} from "../src/form/fields";

test("a linear slider position has no rounding noise of the steps", () => {
  expect(sliderValue(0.1 + 0.2, false)).toBe(0.3);
});

test("a log scale slider position is the exponent of the value", () => {
  expect(sliderValue(sliderPosition(1e-4, true), true)).toBe(1e-4);
});

test("a log scale value has three significant digits", () => {
  expect(sliderValue(-3.9, true)).toBe(0.000126);
});

test("a whole-number slider on a log scale gives whole numbers", () => {
  expect(sliderValue(Math.log10(1400) + 0.004, true, true)).toBe(1410);
});

test("a whole-number slider reaches 1 at its start", () => {
  expect(sliderValue(0.01, true, true)).toBe(1);
});

const WEST: HighlightItem = { kind: "surface", name: "west" };
const NORTH_BOX: HighlightItem = { kind: "region", name: "north_box" };
const EAST_BOX: HighlightItem = { kind: "region", name: "east_box" };

test("a click pins the item", () => {
  expect(pinAfterClick(null, NORTH_BOX)).toEqual(NORTH_BOX);
});

test("a second click removes the pin", () => {
  expect(pinAfterClick({ ...NORTH_BOX }, NORTH_BOX)).toBeNull();
});

test("a pinned region replaces a pinned surface", () => {
  expect(pinAfterClick(WEST, NORTH_BOX)).toEqual(NORTH_BOX);
});

test("a surface and a region with the same name are different items", () => {
  expect(pinAfterClick({ kind: "surface", name: "north_box" }, NORTH_BOX)).toEqual(NORTH_BOX);
});

test("a new choice moves the pin of the old region to the new one", () => {
  expect(pinAfterChoice(NORTH_BOX, NORTH_BOX, EAST_BOX)).toEqual(EAST_BOX);
});

test("a new choice without a region removes the pin of the old region", () => {
  expect(pinAfterChoice(NORTH_BOX, NORTH_BOX, null)).toBeNull();
});

test("a new choice does not change the pin of another item", () => {
  expect(pinAfterChoice(WEST, NORTH_BOX, EAST_BOX)).toEqual(WEST);
});

test("a new choice from no region does not change the pin", () => {
  expect(pinAfterChoice(WEST, null, EAST_BOX)).toEqual(WEST);
});

test("removing a card before the open card keeps that card open", () => {
  expect(openCardAfterRemove(2, 0, 3)).toBe(1);
});

test("removing the open card opens the next card", () => {
  expect(openCardAfterRemove(1, 1, 2)).toBe(1);
});

test("removing the open last card opens the new last card", () => {
  expect(openCardAfterRemove(2, 2, 2)).toBe(1);
});

test("removing a card after the open card keeps the open index", () => {
  expect(openCardAfterRemove(0, 2, 2)).toBe(0);
});

test("removing the only card leaves no open card", () => {
  expect(openCardAfterRemove(0, 0, 0)).toBeNull();
});

test("with all cards closed, a remove opens no card", () => {
  expect(openCardAfterRemove(null, 0, 2)).toBeNull();
});

test("closing the open card leaves no open card", () => {
  expect(openCardAfterToggle(1, 1, false)).toBeNull();
});

test("the close event of another card keeps the open card", () => {
  expect(openCardAfterToggle(2, 0, false)).toBe(2);
});

test("opening a card makes it the open card", () => {
  expect(openCardAfterToggle(0, 3, true)).toBe(3);
});

test("a list with no stored state has its first card open", () => {
  resetOpenCards();
  expect(getOpenCard("families")).toBe(0);
});

test("a stored closed state stays until a new mesh", () => {
  setOpenCard("families", null);
  const closed = getOpenCard("families");
  resetOpenCards();
  expect([closed, getOpenCard("families")]).toEqual([null, 0]);
});
