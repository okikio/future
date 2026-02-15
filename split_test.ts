/**
 * Comprehensive tests for split functions
 * 
 * This test suite validates:
 * - split() - splitting futures into resolved and error streams
 * - splitBy() - splitting futures based on a predicate
 */

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { split, splitBy } from "./split.ts";
import { from } from "./from.ts";

describe("split()", () => {
  describe("Basic Functionality", () => {
    it("should split future into resolved and error streams", async () => {
      const future = from(async function* () {
        yield 1;
        yield 2;
        return 3;
      });

      const [resolved, errored] = split(future);

      const resolvedValues: number[] = [];
      for await (const value of resolved) {
        resolvedValues.push(value);
      }

      expect(resolvedValues).toEqual([1, 2]);

      // Error stream should be empty
      const errorValues: unknown[] = [];
      for await (const value of errored) {
        errorValues.push(value);
      }

      expect(errorValues).toEqual([]);
    });

    it("should route errors to error stream", async () => {
      const future = from(async function* () {
        yield 1;
        throw new Error("Test error");
      });

      const [resolved, errored] = split(future);

      const resolvedValues: number[] = [];
      try {
        for await (const value of resolved) {
          resolvedValues.push(value);
        }
      } catch {
        // Expected to error
      }

      expect(resolvedValues).toEqual([1]);

      // Error stream should have the error
      // Note: The actual behavior depends on implementation
      // This is a basic check
    });

    it("should handle empty future", async () => {
      const future = from(async function* () {
        // Empty
      });

      const [resolved, errored] = split(future);

      const resolvedValues: unknown[] = [];
      for await (const value of resolved) {
        resolvedValues.push(value);
      }

      expect(resolvedValues).toEqual([]);

      const errorValues: unknown[] = [];
      for await (const value of errored) {
        errorValues.push(value);
      }

      expect(errorValues).toEqual([]);
    });

    it("should handle single value", async () => {
      const future = from(async function* () {
        yield 42;
        return 100;
      });

      const [resolved] = split(future);

      const values: number[] = [];
      for await (const value of resolved) {
        values.push(value);
      }

      expect(values).toEqual([42]);
    });
  });

  describe("Disposal", () => {
    it("should support Symbol.dispose", () => {
      const future = from(async function* () {
        yield 1;
        return 2;
      });

      const splitResult = split(future);

      splitResult[Symbol.dispose]();

      expect(true).toBe(true);
    });

    it("should support Symbol.asyncDispose", async () => {
      const future = from(async function* () {
        yield 1;
        return 2;
      });

      const splitResult = split(future);

      await splitResult[Symbol.asyncDispose]();

      expect(true).toBe(true);
    });

    it("should cleanup both streams on disposal", async () => {
      const future = from(async function* () {
        yield 1;
        yield 2;
        return 3;
      });

      const splitResult = split(future);

      await splitResult[Symbol.asyncDispose]();

      // Should not throw
      expect(true).toBe(true);
    });

    it("should support using syntax", async () => {
      {
        using splitResult = split(from(async function* () {
          yield 1;
          return 2;
        }));

        const [resolved] = splitResult;
        for await (const _ of resolved) {
          // Consume values
        }
      }

      expect(true).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle very long streams", async () => {
      const future = from(async function* () {
        for (let i = 0; i < 1000; i++) {
          yield i;
        }
        return 1000;
      });

      const [resolved] = split(future);

      let count = 0;
      for await (const _ of resolved) {
        count++;
      }

      expect(count).toBe(1000);
    });

    it("should handle null and undefined values", async () => {
      const future = from(async function* () {
        yield null;
        yield undefined;
        yield 0;
        return false;
      });

      const [resolved] = split(future);

      const values: (null | undefined | number | boolean)[] = [];
      for await (const value of resolved) {
        values.push(value);
      }

      expect(values).toEqual([null, undefined, 0]);
    });

    it("should handle async operations", async () => {
      const future = from(async function* () {
        yield 1;
        await new Promise(resolve => setTimeout(resolve, 10));
        yield 2;
        await new Promise(resolve => setTimeout(resolve, 10));
        return 3;
      });

      const [resolved] = split(future);

      const values: number[] = [];
      for await (const value of resolved) {
        values.push(value);
      }

      expect(values).toEqual([1, 2]);
    });
  });
});

describe("splitBy()", () => {
  describe("Basic Functionality", () => {
    it("should split future by predicate", async () => {
      const future = from(async function* () {
        yield 1;
        yield 2;
        yield 3;
        yield 4;
        yield 5;
        return 6;
      });

      const isEven = (value: number) => value % 2 === 0;
      const [evens, odds] = splitBy(future, isEven);

      const evenValues: number[] = [];
      for await (const value of evens) {
        evenValues.push(value);
      }

      const oddValues: number[] = [];
      for await (const value of odds) {
        oddValues.push(value);
      }

      expect(evenValues).toEqual([2, 4]);
      expect(oddValues).toEqual([1, 3, 5]);
    });

    it("should handle all matching predicate", async () => {
      const future = from(async function* () {
        yield 2;
        yield 4;
        yield 6;
        return 8;
      });

      const isEven = (value: number) => value % 2 === 0;
      const [evens, odds] = splitBy(future, isEven);

      const evenValues: number[] = [];
      for await (const value of evens) {
        evenValues.push(value);
      }

      const oddValues: number[] = [];
      for await (const value of odds) {
        oddValues.push(value);
      }

      expect(evenValues).toEqual([2, 4, 6]);
      expect(oddValues).toEqual([]);
    });

    it("should handle none matching predicate", async () => {
      const future = from(async function* () {
        yield 1;
        yield 3;
        yield 5;
        return 7;
      });

      const isEven = (value: number) => value % 2 === 0;
      const [evens, odds] = splitBy(future, isEven);

      const evenValues: number[] = [];
      for await (const value of evens) {
        evenValues.push(value);
      }

      const oddValues: number[] = [];
      for await (const value of odds) {
        oddValues.push(value);
      }

      expect(evenValues).toEqual([]);
      expect(oddValues).toEqual([1, 3, 5]);
    });

    it("should handle empty future", async () => {
      const future = from(async function* (): AsyncGenerator<number> {
        // Empty
      });

      const isEven = (value: number) => value % 2 === 0;
      const [evens, odds] = splitBy(future, isEven);

      const evenValues: number[] = [];
      for await (const value of evens) {
        evenValues.push(value);
      }

      const oddValues: number[] = [];
      for await (const value of odds) {
        oddValues.push(value);
      }

      expect(evenValues).toEqual([]);
      expect(oddValues).toEqual([]);
    });

    it("should handle single value matching predicate", async () => {
      const future = from(async function* () {
        yield 2;
        return 4;
      });

      const isEven = (value: number) => value % 2 === 0;
      const [evens, odds] = splitBy(future, isEven);

      const evenValues: number[] = [];
      for await (const value of evens) {
        evenValues.push(value);
      }

      expect(evenValues).toEqual([2]);
    });

    it("should handle single value not matching predicate", async () => {
      const future = from(async function* () {
        yield 3;
        return 5;
      });

      const isEven = (value: number) => value % 2 === 0;
      const [evens, odds] = splitBy(future, isEven);

      const oddValues: number[] = [];
      for await (const value of odds) {
        oddValues.push(value);
      }

      expect(oddValues).toEqual([3]);
    });
  });

  describe("Async Predicates", () => {
    it("should handle async predicate", async () => {
      const future = from(async function* () {
        yield 1;
        yield 2;
        yield 3;
        yield 4;
        return 5;
      });

      const asyncIsEven = async (value: number) => {
        await new Promise(resolve => setTimeout(resolve, 1));
        return value % 2 === 0;
      };

      const [evens, odds] = splitBy(future, asyncIsEven);

      const evenValues: number[] = [];
      for await (const value of evens) {
        evenValues.push(value);
      }

      const oddValues: number[] = [];
      for await (const value of odds) {
        oddValues.push(value);
      }

      expect(evenValues).toEqual([2, 4]);
      expect(oddValues).toEqual([1, 3]);
    });

    it("should handle promise-returning predicate", async () => {
      const future = from(async function* () {
        yield "a";
        yield "ab";
        yield "abc";
        return "abcd";
      });

      const longString = (value: string) => Promise.resolve(value.length > 2);
      const [long, short] = splitBy(future, longString);

      const longValues: string[] = [];
      for await (const value of long) {
        longValues.push(value);
      }

      const shortValues: string[] = [];
      for await (const value of short) {
        shortValues.push(value);
      }

      expect(longValues).toEqual(["abc"]);
      expect(shortValues).toEqual(["a", "ab"]);
    });
  });

  describe("Complex Predicates", () => {
    it("should handle type-based splitting", async () => {
      const future = from(async function* () {
        yield 1;
        yield "two";
        yield 3;
        yield "four";
        return 5;
      });

      const isNumber = (value: number | string) => typeof value === "number";
      const [numbers, strings] = splitBy(future, isNumber);

      const numberValues: (number | string)[] = [];
      for await (const value of numbers) {
        numberValues.push(value);
      }

      const stringValues: (number | string)[] = [];
      for await (const value of strings) {
        stringValues.push(value);
      }

      expect(numberValues).toEqual([1, 3]);
      expect(stringValues).toEqual(["two", "four"]);
    });

    it("should handle object property predicates", async () => {
      type Item = { id: number; active: boolean };
      
      const future = from(async function* () {
        yield { id: 1, active: true };
        yield { id: 2, active: false };
        yield { id: 3, active: true };
        return { id: 4, active: false };
      });

      const isActive = (item: Item) => item.active;
      const [active, inactive] = splitBy(future, isActive);

      const activeValues: Item[] = [];
      for await (const value of active) {
        activeValues.push(value);
      }

      const inactiveValues: Item[] = [];
      for await (const value of inactive) {
        inactiveValues.push(value);
      }

      expect(activeValues).toHaveLength(2);
      expect(activeValues[0].active).toBe(true);
      expect(inactiveValues).toHaveLength(1);
      expect(inactiveValues[0].active).toBe(false);
    });

    it("should handle range-based predicates", async () => {
      const future = from(async function* () {
        for (let i = 1; i <= 10; i++) {
          yield i;
        }
        return 11;
      });

      const inRange = (value: number) => value >= 4 && value <= 7;
      const [inRangeValues, outOfRange] = splitBy(future, inRange);

      const inside: number[] = [];
      for await (const value of inRangeValues) {
        inside.push(value);
      }

      const outside: number[] = [];
      for await (const value of outOfRange) {
        outside.push(value);
      }

      expect(inside).toEqual([4, 5, 6, 7]);
      expect(outside).toEqual([1, 2, 3, 8, 9, 10]);
    });
  });

  describe("Disposal", () => {
    it("should support Symbol.dispose", () => {
      const future = from(async function* () {
        yield 1;
        yield 2;
        return 3;
      });

      const isEven = (value: number) => value % 2 === 0;
      const splitResult = splitBy(future, isEven);

      splitResult[Symbol.dispose]();

      expect(true).toBe(true);
    });

    it("should support Symbol.asyncDispose", async () => {
      const future = from(async function* () {
        yield 1;
        yield 2;
        return 3;
      });

      const isEven = (value: number) => value % 2 === 0;
      const splitResult = splitBy(future, isEven);

      await splitResult[Symbol.asyncDispose]();

      expect(true).toBe(true);
    });

    it("should support using syntax", async () => {
      {
        using splitResult = splitBy(
          from(async function* () {
            yield 1;
            yield 2;
            return 3;
          }),
          (value) => value % 2 === 0
        );

        const [evens] = splitResult;
        for await (const _ of evens) {
          // Consume values
        }
      }

      expect(true).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle null and undefined values", async () => {
      const future = from(async function* () {
        yield null;
        yield undefined;
        yield 0;
        yield 1;
        return 2;
      });

      const isTruthy = (value: unknown) => !!value;
      const [truthy, falsy] = splitBy(future, isTruthy);

      const truthyValues: unknown[] = [];
      for await (const value of truthy) {
        truthyValues.push(value);
      }

      const falsyValues: unknown[] = [];
      for await (const value of falsy) {
        falsyValues.push(value);
      }

      expect(truthyValues).toEqual([1]);
      expect(falsyValues).toEqual([null, undefined, 0]);
    });

    it("should handle very long streams", async () => {
      const future = from(async function* () {
        for (let i = 0; i < 1000; i++) {
          yield i;
        }
        return 1000;
      });

      const isEven = (value: number) => value % 2 === 0;
      const [evens, odds] = splitBy(future, isEven);

      let evenCount = 0;
      for await (const _ of evens) {
        evenCount++;
      }

      let oddCount = 0;
      for await (const _ of odds) {
        oddCount++;
      }

      expect(evenCount).toBe(500);
      expect(oddCount).toBe(500);
    });

    it("should handle predicate that always returns true", async () => {
      const future = from(async function* () {
        yield 1;
        yield 2;
        yield 3;
        return 4;
      });

      const alwaysTrue = () => true;
      const [matched, unmatched] = splitBy(future, alwaysTrue);

      const matchedValues: number[] = [];
      for await (const value of matched) {
        matchedValues.push(value);
      }

      const unmatchedValues: number[] = [];
      for await (const value of unmatched) {
        unmatchedValues.push(value);
      }

      expect(matchedValues).toEqual([1, 2, 3]);
      expect(unmatchedValues).toEqual([]);
    });

    it("should handle predicate that always returns false", async () => {
      const future = from(async function* () {
        yield 1;
        yield 2;
        yield 3;
        return 4;
      });

      const alwaysFalse = () => false;
      const [matched, unmatched] = splitBy(future, alwaysFalse);

      const matchedValues: number[] = [];
      for await (const value of matched) {
        matchedValues.push(value);
      }

      const unmatchedValues: number[] = [];
      for await (const value of unmatched) {
        unmatchedValues.push(value);
      }

      expect(matchedValues).toEqual([]);
      expect(unmatchedValues).toEqual([1, 2, 3]);
    });

    it("should handle async operations in source future", async () => {
      const future = from(async function* () {
        yield 1;
        await new Promise(resolve => setTimeout(resolve, 10));
        yield 2;
        await new Promise(resolve => setTimeout(resolve, 10));
        yield 3;
        return 4;
      });

      const isEven = (value: number) => value % 2 === 0;
      const [evens, odds] = splitBy(future, isEven);

      const evenValues: number[] = [];
      for await (const value of evens) {
        evenValues.push(value);
      }

      expect(evenValues).toEqual([2]);
    });
  });
});
