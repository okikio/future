/**
 * Comprehensive tests for the scope() function
 * 
 * This test suite validates:
 * - Sequential execution of futures
 * - Error propagation through scope
 * - Resource disposal within scope
 * - Iteration behavior
 * - Edge cases
 */

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { scope } from "./scope.ts";
import { Future } from "./future.ts";
import { from } from "./from.ts";

describe("scope()", () => {
  describe("Basic Functionality", () => {
    it("should execute futures sequentially", async () => {
      const executionOrder: number[] = [];

      const futures = [
        from(async function* () {
          executionOrder.push(1);
          yield 1;
          return 10;
        }),
        from(async function* () {
          executionOrder.push(2);
          yield 2;
          return 20;
        }),
        from(async function* () {
          executionOrder.push(3);
          yield 3;
          return 30;
        }),
      ];

      await scope(futures).toPromise();

      // Should execute in order: 1, 2, 3
      expect(executionOrder).toEqual([1, 2, 3]);
    });

    it("should return array of all results", async () => {
      const futures = [
        from(async function* () {
          yield 1;
          return 10;
        }),
        from(async function* () {
          yield 2;
          return 20;
        }),
        from(async function* () {
          yield 3;
          return 30;
        }),
      ];

      const results = await scope(futures).toPromise();

      expect(results).toEqual([10, 20, 30]);
    });

    it("should yield intermediate values from each future", async () => {
      const futures = [
        from(async function* () {
          yield 1;
          yield 2;
          return 10;
        }),
        from(async function* () {
          yield 3;
          yield 4;
          return 20;
        }),
      ];

      const scopeFuture = scope(futures);
      const values: number[] = [];

      for await (const value of scopeFuture) {
        values.push(value);
      }

      expect(values).toEqual([1, 2, 3, 4]);
    });

    it("should handle empty array of futures", async () => {
      const results = await scope([]).toPromise();
      expect(results).toEqual([]);
    });

    it("should handle single future", async () => {
      const futures = [
        from(async function* () {
          yield 1;
          return 10;
        }),
      ];

      const results = await scope(futures).toPromise();
      expect(results).toEqual([10]);
    });
  });

  describe("Sequential Execution Timing", () => {
    it("should execute sequentially, not concurrently", async () => {
      let active = 0;
      let maxActive = 0;

      const createFuture = (value: number) =>
        from(async function* () {
          active++;
          maxActive = Math.max(maxActive, active);

          yield value;
          await new Promise(resolve => setTimeout(resolve, 50));

          active--;
          return value;
        });

      const futures = [
        createFuture(1),
        createFuture(2),
        createFuture(3),
      ];

      await scope(futures).toPromise();

      // Should never have more than 1 active
      expect(maxActive).toBe(1);
    });

    it("should take sequential time, not parallel time", async () => {
      const delay = 50;
      const count = 3;

      const startTime = Date.now();

      const futures = Array.from({ length: count }, (_, i) =>
        from(async function* () {
          await new Promise(resolve => setTimeout(resolve, delay));
          return i;
        })
      );

      await scope(futures).toPromise();

      const duration = Date.now() - startTime;

      // Should take ~delay*count (sequential), not ~delay (parallel)
      expect(duration).toBeGreaterThan(delay * count * 0.8);
    });
  });

  describe("Error Handling", () => {
    it("should propagate errors from futures", async () => {
      const futures = [
        from(async function* () {
          yield 1;
          return 10;
        }),
        from(async function* () {
          yield 2;
          throw new Error("Scope error");
        }),
        from(async function* () {
          yield 3;
          return 30;
        }),
      ];

      await expect(scope(futures).toPromise()).rejects.toThrow("Scope error");
    });

    it("should stop execution on error", async () => {
      const executionOrder: number[] = [];

      const futures = [
        from(async function* () {
          executionOrder.push(1);
          yield 1;
          return 10;
        }),
        from(async function* () {
          executionOrder.push(2);
          throw new Error("Early error");
        }),
        from(async function* () {
          executionOrder.push(3);
          yield 3;
          return 30;
        }),
      ];

      try {
        await scope(futures).toPromise();
      } catch {
        // Expected
      }

      // Third future should not execute
      expect(executionOrder).toEqual([1, 2]);
      expect(executionOrder).not.toContain(3);
    });

    it("should handle error in first future", async () => {
      const futures = [
        from(async function* () {
          throw new Error("First error");
        }),
        from(async function* () {
          yield 2;
          return 20;
        }),
      ];

      await expect(scope(futures).toPromise()).rejects.toThrow("First error");
    });

    it("should handle error in last future", async () => {
      const futures = [
        from(async function* () {
          yield 1;
          return 10;
        }),
        from(async function* () {
          throw new Error("Last error");
        }),
      ];

      await expect(scope(futures).toPromise()).rejects.toThrow("Last error");
    });
  });

  describe("Resource Management and Disposal", () => {
    it("should dispose futures in scope", async () => {
      let disposed1 = false;
      let disposed2 = false;

      const futures = [
        from(async function* (_, stack) {
          stack.defer(() => { disposed1 = true; });
          yield 1;
          return 10;
        }),
        from(async function* (_, stack) {
          stack.defer(() => { disposed2 = true; });
          yield 2;
          return 20;
        }),
      ];

      const scopeFuture = scope(futures);
      await scopeFuture.toPromise();
      await scopeFuture.dispose();

      expect(disposed1).toBe(true);
      expect(disposed2).toBe(true);
    });

    it("should cleanup on error", async () => {
      let disposed1 = false;
      let disposed2 = false;

      const futures = [
        from(async function* (_, stack) {
          stack.defer(() => { disposed1 = true; });
          yield 1;
          return 10;
        }),
        from(async function* (_, stack) {
          stack.defer(() => { disposed2 = true; });
          throw new Error("Cleanup error");
        }),
      ];

      const scopeFuture = scope(futures);

      try {
        await scopeFuture.toPromise();
      } catch {
        // Expected
      }

      await scopeFuture.dispose();

      // Both should be disposed
      expect(disposed1).toBe(true);
      expect(disposed2).toBe(true);
    });

    it("should support using syntax for automatic disposal", async () => {
      let disposed = false;

      {
        await using scopeFuture = scope([
          from(async function* (_, stack) {
            stack.defer(() => { disposed = true; });
            yield 1;
            return 10;
          }),
        ]);

        await scopeFuture.toPromise();
      }

      // Should be automatically disposed
      expect(disposed).toBe(true);
    });
  });

  describe("Iteration and Yielding", () => {
    it("should yield values in order from all futures", async () => {
      const futures = [
        from(async function* () {
          yield 1;
          yield 2;
          return 10;
        }),
        from(async function* () {
          yield 3;
          yield 4;
          return 20;
        }),
        from(async function* () {
          yield 5;
          yield 6;
          return 30;
        }),
      ];

      const scopeFuture = scope(futures);
      const values: number[] = [];

      for await (const value of scopeFuture) {
        values.push(value);
      }

      // Should get all yields in sequential order
      expect(values).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it("should handle futures with no yields", async () => {
      const futures = [
        from(async function* () {
          return 10;
        }),
        from(async function* () {
          return 20;
        }),
      ];

      const scopeFuture = scope(futures);
      const values: number[] = [];

      for await (const value of scopeFuture) {
        values.push(value);
      }

      expect(values).toEqual([]);

      const results = await scopeFuture.toPromise();
      expect(results).toEqual([10, 20]);
    });

    it("should handle futures with only yields (no return)", async () => {
      const futures = [
        from(async function* () {
          yield 1;
          yield 2;
        }),
        from(async function* () {
          yield 3;
          yield 4;
        }),
      ];

      const scopeFuture = scope(futures);
      const values: number[] = [];

      for await (const value of scopeFuture) {
        values.push(value);
      }

      expect(values).toEqual([1, 2, 3, 4]);
    });
  });

  describe("Edge Cases", () => {
    it("should handle very long chains", async () => {
      const count = 100;
      const futures = Array.from({ length: count }, (_, i) =>
        from(async function* () {
          yield i;
          return i * 10;
        })
      );

      const results = await scope(futures).toPromise();

      expect(results).toHaveLength(count);
      expect(results[99]).toBe(990);
    });

    it("should handle futures returning different types", async () => {
      const futures = [
        from(async function* () {
          yield 1;
          return 10;
        }),
        from(async function* () {
          yield "two";
          return "twenty";
        }),
        from(async function* () {
          yield true;
          return false;
        }),
      ];

      const results = await scope(futures).toPromise();

      expect(results).toEqual([10, "twenty", false]);
    });

    it("should handle async operations within futures", async () => {
      const futures = [
        from(async function* () {
          await new Promise(resolve => setTimeout(resolve, 10));
          yield 1;
          return 10;
        }),
        from(async function* () {
          await new Promise(resolve => setTimeout(resolve, 20));
          yield 2;
          return 20;
        }),
      ];

      const results = await scope(futures).toPromise();

      expect(results).toEqual([10, 20]);
    });

    it("should handle null and undefined returns", async () => {
      const futures = [
        from(async function* () {
          yield 1;
          return null;
        }),
        from(async function* () {
          yield 2;
          return undefined;
        }),
        from(async function* () {
          yield 3;
          return 0;
        }),
      ];

      const results = await scope(futures).toPromise();

      expect(results).toEqual([null, undefined, 0]);
    });

    it("should handle nested scopes", async () => {
      const innerScope1 = scope([
        from(async function* () {
          yield 1;
          return 10;
        }),
        from(async function* () {
          yield 2;
          return 20;
        }),
      ]);

      const innerScope2 = scope([
        from(async function* () {
          yield 3;
          return 30;
        }),
        from(async function* () {
          yield 4;
          return 40;
        }),
      ]);

      const outerScope = scope([innerScope1, innerScope2]);
      const results = await outerScope.toPromise();

      expect(results).toEqual([[10, 20], [30, 40]]);
    });
  });

  describe("Cancellation and Control", () => {
    it("should support cancellation", async () => {
      const futures = [
        from(async function* (abort) {
          yield 1;
          await new Promise(resolve => setTimeout(resolve, 50));
          abort.signal.throwIfAborted();
          return 10;
        }),
        from(async function* () {
          yield 2;
          return 20;
        }),
      ];

      const scopeFuture = scope(futures);
      const promise = scopeFuture.toPromise();

      setTimeout(() => scopeFuture.cancel(), 30);

      await expect(promise).rejects.toThrow();
    });

    it("should support pause and resume", async () => {
      const futures = [
        from(async function* () {
          yield 1;
          return 10;
        }),
        from(async function* () {
          yield 2;
          return 20;
        }),
      ];

      const scopeFuture = scope(futures);

      // Start iteration
      const iterator = scopeFuture[Symbol.asyncIterator]();
      const result1 = await iterator.next();
      expect(result1.value).toBe(1);

      // Pause
      scopeFuture.pause();

      // Resume
      setTimeout(() => scopeFuture.resume(), 50);

      const result2 = await iterator.next();
      expect(result2.value).toBe(2);
    });

    it("should propagate cancellation to inner futures", async () => {
      let future1Completed = false;
      let future2Started = false;

      const futures = [
        from(async function* (abort) {
          yield 1;
          await new Promise(resolve => setTimeout(resolve, 50));
          abort.signal.throwIfAborted();
          future1Completed = true;
          return 10;
        }),
        from(async function* () {
          future2Started = true;
          yield 2;
          return 20;
        }),
      ];

      const scopeFuture = scope(futures);
      const promise = scopeFuture.toPromise();

      setTimeout(() => scopeFuture.cancel(), 30);

      try {
        await promise;
      } catch {
        // Expected
      }

      // First future should not complete, second should not start
      expect(future1Completed).toBe(false);
      expect(future2Started).toBe(false);
    });
  });

  describe("Type Validation", () => {
    it("should throw error for non-iterable input", () => {
      // @ts-expect-error - Testing runtime error
      expect(() => scope(42 as any)).toThrow();
    });

    it("should throw error for null input", () => {
      // @ts-expect-error - Testing runtime error
      expect(() => scope(null as any)).toThrow();
    });

    it("should throw error for undefined input", () => {
      // @ts-expect-error - Testing runtime error
      expect(() => scope(undefined as any)).toThrow();
    });
  });

  describe("Integration with Other Functions", () => {
    it("should work with cloned futures", async () => {
      const originalFuture = from(async function* () {
        yield 1;
        return 10;
      });

      const futures = [
        originalFuture,
        originalFuture.clone(),
        originalFuture.clone(),
      ];

      const results = await scope(futures).toPromise();

      expect(results).toEqual([10, 10, 10]);
    });

    it("should work with reset futures", async () => {
      const future1 = from(async function* () {
        yield 1;
        return 10;
      });

      // Execute once
      await future1.toPromise();

      // Reset
      future1.reset();

      const futures = [future1];
      const results = await scope(futures).toPromise();

      expect(results).toEqual([10]);
    });

    it("should handle mix of new and completed futures", async () => {
      const future1 = from(async function* () {
        yield 1;
        return 10;
      });

      const future2 = from(async function* () {
        yield 2;
        return 20;
      });

      // Complete first future
      await future1.toPromise();

      // Reset it
      future1.reset();

      // Now use both in scope
      const results = await scope([future1, future2]).toPromise();

      expect(results).toEqual([10, 20]);
    });
  });
});
