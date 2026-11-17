// The values of the slider positions of the form fields, and the pin of the highlight.
import { expect, test } from "vitest";
import { pinAfterChoice, pinAfterClick, sliderPosition, sliderValue, type HighlightItem } from "../src/form/fields";

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
