import { split, splitBy } from "./split.ts";

import { test } from "@libs/testing";
import { expect } from "@std/expect";

// Test for split function
test("all")("split should correctly split valid values and errors", async () => {
  async function* sourceIterator() {
    yield 1;
    yield 2;
    yield new Error("This is an error");
    yield 10;
    throw new Error("Something went wrong");
    return 5
  }

  const [resolved, errored] = split(sourceIterator());

  // Collect resolved values
  const resolvedValues = await Array.fromAsync(resolved);

  // Collect errored values
  const erroredValues = await Array.fromAsync(errored);

  expect(resolvedValues).toEqual([1, 2, new Error("This is an error"), 10]);
  expect(erroredValues).toEqual([new Error("Something went wrong")]);
});

// Test for splitBy function with predicate
test("all")("splitBy should correctly split based on predicate", async () => {
  async function* sourceIterator() {
    yield 1;
    yield 2;
    yield 3;
    yield 4;
  }

  const isEven = (value: number) => value % 2 === 0;
  const [evens, odds] = splitBy<number>(sourceIterator(), isEven);

  // Collect even values
  const evenValues = await Array.fromAsync(evens);

  // Collect odd values
  const oddValues = await Array.fromAsync(odds);

  expect(evenValues).toEqual([2, 4]);
  expect(oddValues).toEqual([1, 3]);
});

// Test for splitBy function with errors
test("all")("splitBy should handle errors correctly", async () => {
  async function* sourceIterator() {
    yield 1;
    yield 2;
    yield new Error("This is an error");
  }

  const handleErrors = (value: number | Error) => {
    return typeof value === "number" && value > 0; // Send positive values to the first iterator
  };

  const [resolved, errored] = splitBy(sourceIterator(), handleErrors);

  // Collect resolved values
  const resolvedValues = await Array.fromAsync(resolved);

  // Collect errored values
  const erroredValues = await Array.fromAsync(errored);

  expect(resolvedValues).toEqual([1, 2]);
  expect(erroredValues).toEqual([new Error("This is an error")]);
});
