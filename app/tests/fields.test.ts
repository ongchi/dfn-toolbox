// The values of the slider positions of the form fields.
import { expect, test } from "vitest";
import { sliderPosition, sliderValue } from "../src/form/fields";

test("a linear slider position has no rounding noise of the steps", () => {
  expect(sliderValue(0.1 + 0.2, false)).toBe(0.3);
});

test("a log scale slider position is the exponent of the value", () => {
  expect(sliderValue(sliderPosition(1e-4, true), true)).toBe(1e-4);
});

test("a log scale value has three significant digits", () => {
  expect(sliderValue(-3.9, true)).toBe(0.000126);
});
