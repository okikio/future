import { split, splitBy } from "./split.ts";

import { test } from "@libs/testing";
import { expect } from "@std/expect";

// Test for split function
test.only("deno")("split should correctly split valid values and errors", async () => {
  async function* sourceIterator() {
    yield 1;
    yield 2;
    yield new Error("This is an error");
    throw new Error("Something went wrong");
    return 5
  }

  const [resolved, errored] = split(sourceIterator());

  // console.log({
  //   resolved: await Array.fromAsync(resolved),
  //   errored: await Array.fromAsync(errored),
  // })

  // Collect resolved values
  const resolvedValues = await Array.fromAsync(resolved);

  // Collect errored values
  const erroredValues = await Array.fromAsync(errored);

  console.log({
    resolvedValues,
    erroredValues
  });

  // expect(resolvedValues).toEqual([1, 2, new Error("This is an error")]);
  // expect(erroredValues).toEqual([new Error("Something went wrong")]);
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
  const evenValues = [];
  // @ts-ignore a
  for (let value of evens) {
    evenValues.push(value);
  }

  // Collect odd values
  const oddValues = [];
  // @ts-ignore a
  for (let value of odds) {
    oddValues.push(value);
  }

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

  const handleErrors = (value: number) => {
    try {
      return value > 0; // Send positive values to the first iterator
    } catch (error) {
      return false; // Send errors to the second iterator
    }
  };

  // @ts-ignore a
  const [resolved, errored] = await splitBy(sourceIterator(), handleErrors);

  // Collect resolved values
  const resolvedValues = [];
  // @ts-ignore a
  for (let value of resolved) {
    resolvedValues.push(value);
  }

  // Collect errored values
  const erroredValues = [];
  // @ts-ignore a
  for (let error of errored) {
    erroredValues.push(error);
  }

  expect(resolvedValues).toEqual([1, 2]);
  expect(erroredValues).toEqual([new Error("This is an error")]);
});
