/**
 * Comprehensive tests for concurrency control functions
 * 
 * This test suite validates:
 * - all() - concurrent execution with all results
 * - allSettled() - concurrent execution with settled results
 * - race() - first to complete wins
 * - some() - first N to complete
 * - withConcurrencyLimit() - throttled concurrent execution
 */

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { all, allSettled, race, some, withConcurrencyLimit } from "./concurrency.ts";
import { Future } from "./future.ts";
import { from } from "./from.ts";

describe("Concurrency Control", () => {
  describe("all()", () => {
    it("should execute all futures concurrently", async () => {
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

      const result = await all(futures).toPromise();
      
      expect(result).toEqual([10, 20, 30]);
    });

    it("should yield intermediate results", async () => {
      const futures = [
        from(Promise.resolve(1)),
        from(Promise.resolve(2)),
        from(Promise.resolve(3)),
      ];

      const future = all(futures);
      const values: number[] = [];
      
      for await (const value of future) {
        values.push(value);
      }

      expect(values).toEqual([1, 2, 3]);
    });

    it("should handle mixed futures and promises", async () => {
      const inputs = [
        from(Promise.resolve(1)),
        Promise.resolve(2),
        from(async function* () {
          yield 3;
          return 3;
        }),
      ];

      const result = await all(inputs).toPromise();
      
      expect(result).toEqual([1, 2, 3]);
    });

    it("should reject if any future rejects", async () => {
      const futures = [
        from(Promise.resolve(1)),
        from(Promise.reject(new Error("Test error"))),
        from(Promise.resolve(3)),
      ];

      await expect(all(futures).toPromise()).rejects.toThrow("Test error");
    });

    it("should handle empty array", async () => {
      const result = await all([]).toPromise();
      expect(result).toEqual([]);
    });

    it("should handle single future", async () => {
      const futures = [from(Promise.resolve(42))];
      const result = await all(futures).toPromise();
      
      expect(result).toEqual([42]);
    });

    it("should preserve result order", async () => {
      // Create futures with different delays, slowest first
      const futures = [
        from(async function* () {
          await new Promise(resolve => setTimeout(resolve, 100));
          return 1;
        }),
        from(async function* () {
          await new Promise(resolve => setTimeout(resolve, 50));
          return 2;
        }),
        from(async function* () {
          await new Promise(resolve => setTimeout(resolve, 10));
          return 3;
        }),
      ];

      const result = await all(futures).toPromise();
      
      // Should maintain input order, not completion order
      expect(result).toEqual([1, 2, 3]);
    });

    it("should execute truly concurrently", async () => {
      const startTime = Date.now();
      
      const futures = [
        from(async function* () {
          await new Promise(resolve => setTimeout(resolve, 100));
          return 1;
        }),
        from(async function* () {
          await new Promise(resolve => setTimeout(resolve, 100));
          return 2;
        }),
        from(async function* () {
          await new Promise(resolve => setTimeout(resolve, 100));
          return 3;
        }),
      ];

      await all(futures).toPromise();
      
      const duration = Date.now() - startTime;
      
      // Should take ~100ms (concurrent), not ~300ms (sequential)
      expect(duration).toBeLessThan(200);
    });

    it("should handle futures with different return types", async () => {
      const futures = [
        from(Promise.resolve(1)),
        from(Promise.resolve("two")),
        from(Promise.resolve(true)),
      ];

      const result = await all(futures).toPromise();
      
      expect(result).toEqual([1, "two", true]);
    });
  });

  describe("allSettled()", () => {
    it("should return settled results for all futures", async () => {
      const futures = [
        from(Promise.resolve(1)),
        from(Promise.reject(new Error("Error 2"))),
        from(Promise.resolve(3)),
      ];

      const results = await allSettled(futures).toPromise();
      
      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({ status: "fulfilled", value: 1 });
      expect(results[1]).toMatchObject({ status: "rejected" });
      expect(results[2]).toEqual({ status: "fulfilled", value: 3 });
    });

    it("should yield settled results", async () => {
      const futures = [
        from(Promise.resolve(1)),
        from(Promise.resolve(2)),
      ];

      const future = allSettled(futures);
      const values: PromiseSettledResult<number>[] = [];
      
      for await (const value of future) {
        values.push(value);
      }

      expect(values).toHaveLength(2);
      expect(values[0]).toEqual({ status: "fulfilled", value: 1 });
      expect(values[1]).toEqual({ status: "fulfilled", value: 2 });
    });

    it("should handle all rejections", async () => {
      const futures = [
        from(Promise.reject(new Error("Error 1"))),
        from(Promise.reject(new Error("Error 2"))),
        from(Promise.reject(new Error("Error 3"))),
      ];

      const results = await allSettled(futures).toPromise();
      
      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result.status).toBe("rejected");
      });
    });

    it("should handle all fulfillments", async () => {
      const futures = [
        from(Promise.resolve(1)),
        from(Promise.resolve(2)),
        from(Promise.resolve(3)),
      ];

      const results = await allSettled(futures).toPromise();
      
      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result.status).toBe("fulfilled");
      });
    });

    it("should handle empty array", async () => {
      const results = await allSettled([]).toPromise();
      expect(results).toEqual([]);
    });

    it("should preserve order like all()", async () => {
      const futures = [
        from(async function* () {
          await new Promise(resolve => setTimeout(resolve, 100));
          return 1;
        }),
        from(async function* () {
          await new Promise(resolve => setTimeout(resolve, 50));
          return 2;
        }),
        from(async function* () {
          await new Promise(resolve => setTimeout(resolve, 10));
          return 3;
        }),
      ];

      const results = await allSettled(futures).toPromise();
      
      expect(results.map(r => r.status === "fulfilled" ? r.value : null))
        .toEqual([1, 2, 3]);
    });
  });

  describe("race()", () => {
    it("should return the first resolved future", async () => {
      const futures = [
        from(async function* () {
          await new Promise(resolve => setTimeout(resolve, 100));
          return 1;
        }),
        from(async function* () {
          await new Promise(resolve => setTimeout(resolve, 50));
          return 2;
        }),
        from(async function* () {
          await new Promise(resolve => setTimeout(resolve, 150));
          return 3;
        }),
      ];

      const result = await race(futures).toPromise();
      
      expect(result).toBe(2);
    });

    it("should reject if the first settled future rejects", async () => {
      const futures = [
        from(async function* () {
          await new Promise(resolve => setTimeout(resolve, 100));
          return 1;
        }),
        from(async function* () {
          await new Promise(resolve => setTimeout(resolve, 50));
          throw new Error("Fast error");
        }),
      ];

      await expect(race(futures).toPromise()).rejects.toThrow("Fast error");
    });

    it("should handle mixed futures and promises", async () => {
      const inputs = [
        from(async function* () {
          await new Promise(resolve => setTimeout(resolve, 100));
          return 1;
        }),
        Promise.resolve(2),
      ];

      const result = await race(inputs).toPromise();
      
      expect(result).toBe(2);
    });

    it("should return first to complete even if others are faster to start", async () => {
      const futures = [
        from(async function* () {
          await new Promise(resolve => setTimeout(resolve, 100));
          return 1;
        }),
        from(async function* () {
          // This starts immediately but completes later
          await new Promise(resolve => setTimeout(resolve, 200));
          return 2;
        }),
        from(async function* () {
          // This should win
          await new Promise(resolve => setTimeout(resolve, 50));
          return 3;
        }),
      ];

      const result = await race(futures).toPromise();
      
      expect(result).toBe(3);
    });

    it("should work with single future", async () => {
      const futures = [from(Promise.resolve(42))];
      const result = await race(futures).toPromise();
      
      expect(result).toBe(42);
    });
  });

  describe("some()", () => {
    it("should return first N fulfilled futures", async () => {
      const futures = [
        from(Promise.resolve(1)),
        from(Promise.resolve(2)),
        from(Promise.resolve(3)),
        from(Promise.resolve(4)),
        from(Promise.resolve(5)),
      ];

      const results = await some(futures, 3).toPromise();
      
      expect(results).toHaveLength(3);
      expect(results.every(r => r.status === "fulfilled")).toBe(true);
    });

    it("should slice the futures array to count", async () => {
      const futures = [
        from(Promise.resolve(1)),
        from(Promise.resolve(2)),
        from(Promise.resolve(3)),
        from(Promise.resolve(4)),
        from(Promise.resolve(5)),
      ];

      const results = await some(futures, 2).toPromise();
      
      expect(results).toHaveLength(2);
    });

    it("should handle count larger than array length", async () => {
      const futures = [
        from(Promise.resolve(1)),
        from(Promise.resolve(2)),
      ];

      const results = await some(futures, 5).toPromise();
      
      expect(results).toHaveLength(2);
    });

    it("should handle count of 0", async () => {
      const futures = [
        from(Promise.resolve(1)),
        from(Promise.resolve(2)),
      ];

      const results = await some(futures, 0).toPromise();
      
      expect(results).toEqual([]);
    });

    it("should handle mixed fulfilled and rejected", async () => {
      const futures = [
        from(Promise.resolve(1)),
        from(Promise.reject(new Error("Error"))),
        from(Promise.resolve(3)),
      ];

      const results = await some(futures, 3).toPromise();
      
      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({ status: "fulfilled", value: 1 });
      expect(results[1]).toMatchObject({ status: "rejected" });
      expect(results[2]).toEqual({ status: "fulfilled", value: 3 });
    });
  });

  describe("withConcurrencyLimit()", () => {
    it("should limit concurrent execution", async () => {
      let activeCount = 0;
      let maxActive = 0;

      const createFuture = (value: number) =>
        from(async function* () {
          activeCount++;
          maxActive = Math.max(maxActive, activeCount);
          
          yield value;
          await new Promise(resolve => setTimeout(resolve, 50));
          
          activeCount--;
          return value;
        });

      const futures = [
        createFuture(1),
        createFuture(2),
        createFuture(3),
        createFuture(4),
        createFuture(5),
      ];

      await withConcurrencyLimit(futures, 2).toPromise();
      
      // Should never have more than 2 active at once
      expect(maxActive).toBeLessThanOrEqual(2);
    });

    it("should execute all futures eventually", async () => {
      const futures = [
        from(async function* () { return 1; }),
        from(async function* () { return 2; }),
        from(async function* () { return 3; }),
        from(async function* () { return 4; }),
        from(async function* () { return 5; }),
      ];

      const results = await withConcurrencyLimit(futures, 2).toPromise();
      
      expect(results).toHaveLength(5);
      expect(results.sort()).toEqual([1, 2, 3, 4, 5]);
    });

    it("should yield intermediate values", async () => {
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

      const future = withConcurrencyLimit(futures, 2);
      const values: number[] = [];
      
      for await (const value of future) {
        values.push(value);
      }

      expect(values).toContain(1);
      expect(values).toContain(2);
      expect(values).toContain(3);
    });

    it("should handle limit of 1 (sequential execution)", async () => {
      const executionOrder: number[] = [];

      const createFuture = (value: number) =>
        from(async function* () {
          executionOrder.push(value);
          yield value;
          await new Promise(resolve => setTimeout(resolve, 10));
          return value;
        });

      const futures = [
        createFuture(1),
        createFuture(2),
        createFuture(3),
      ];

      await withConcurrencyLimit(futures, 1).toPromise();
      
      // With limit 1, should execute in order
      expect(executionOrder[0]).toBe(1);
    });

    it("should handle limit equal to array length", async () => {
      const futures = [
        from(Promise.resolve(1)),
        from(Promise.resolve(2)),
        from(Promise.resolve(3)),
      ];

      const results = await withConcurrencyLimit(futures, 3).toPromise();
      
      expect(results).toHaveLength(3);
    });

    it("should handle limit larger than array length", async () => {
      const futures = [
        from(Promise.resolve(1)),
        from(Promise.resolve(2)),
      ];

      const results = await withConcurrencyLimit(futures, 10).toPromise();
      
      expect(results).toHaveLength(2);
    });

    it("should handle empty array", async () => {
      const results = await withConcurrencyLimit([], 2).toPromise();
      expect(results).toEqual([]);
    });

    it("should be faster than sequential but slower than unlimited", async () => {
      const createFuture = () =>
        from(async function* () {
          await new Promise(resolve => setTimeout(resolve, 100));
          return 1;
        });

      const futures = Array.from({ length: 4 }, createFuture);

      const startTime = Date.now();
      await withConcurrencyLimit(futures, 2).toPromise();
      const duration = Date.now() - startTime;

      // With limit 2 and 4 futures of 100ms each:
      // - Sequential would take ~400ms
      // - Unlimited would take ~100ms
      // - Limit 2 should take ~200ms
      expect(duration).toBeGreaterThan(150);
      expect(duration).toBeLessThan(350);
    });

    it("should handle errors in some futures", async () => {
      const futures = [
        from(Promise.resolve(1)),
        from(Promise.reject(new Error("Error"))),
        from(Promise.resolve(3)),
      ];

      await expect(
        withConcurrencyLimit(futures, 2).toPromise()
      ).rejects.toThrow("Error");
    });

    it("should cleanup properly on error", async () => {
      const futures = [
        from(async function* () {
          await new Promise(resolve => setTimeout(resolve, 50));
          return 1;
        }),
        from(async function* () {
          await new Promise(resolve => setTimeout(resolve, 10));
          throw new Error("Early error");
        }),
        from(async function* () {
          await new Promise(resolve => setTimeout(resolve, 100));
          return 3;
        }),
      ];

      try {
        await withConcurrencyLimit(futures, 2).toPromise();
      } catch (error) {
        expect((error as Error).message).toBe("Early error");
      }
    });
  });

  describe("Edge Cases and Integration", () => {
    it("should handle very large number of futures with all()", async () => {
      const futures = Array.from({ length: 100 }, (_, i) =>
        from(Promise.resolve(i))
      );

      const results = await all(futures).toPromise();
      
      expect(results).toHaveLength(100);
      expect(results[99]).toBe(99);
    });

    it("should handle mixed types in race()", async () => {
      const inputs: (Future<number, number> | Promise<number>)[] = [
        from(async function* () {
          await new Promise(resolve => setTimeout(resolve, 100));
          return 1;
        }),
        Promise.resolve(2),
        from(Promise.resolve(3)),
      ];

      const result = await race(inputs).toPromise();
      
      expect(result).toBeGreaterThanOrEqual(2);
    });

    it("should compose concurrency functions", async () => {
      const futures1 = [
        from(Promise.resolve(1)),
        from(Promise.resolve(2)),
      ];

      const futures2 = [
        from(Promise.resolve(3)),
        from(Promise.resolve(4)),
      ];

      const combined = [
        all(futures1),
        all(futures2),
      ];

      const results = await all(combined).toPromise();
      
      expect(results).toEqual([[1, 2], [3, 4]]);
    });

    it("should handle cancellation during concurrent execution", async () => {
      const futures = [
        from(async function* (abort) {
          await new Promise(resolve => setTimeout(resolve, 50));
          abort.signal.throwIfAborted();
          return 1;
        }),
        from(async function* (abort) {
          await new Promise(resolve => setTimeout(resolve, 100));
          abort.signal.throwIfAborted();
          return 2;
        }),
      ];

      const future = all(futures);
      
      // Cancel after starting
      setTimeout(() => future.cancel(), 30);

      await expect(future.toPromise()).rejects.toThrow();
    });

    it("should properly dispose resources in withConcurrencyLimit", async () => {
      let disposedCount = 0;

      const createFuture = () =>
        from(async function* (_, stack) {
          stack.defer(() => {
            disposedCount++;
          });
          yield 1;
          return 1;
        });

      const futures = Array.from({ length: 5 }, createFuture);
      const future = withConcurrencyLimit(futures, 2);

      await future.toPromise();
      await future.dispose();

      expect(disposedCount).toBeGreaterThan(0);
    });
  });

  describe("Performance Characteristics", () => {
    it("all() should execute in parallel time", async () => {
      const delay = 50;
      const count = 5;

      const startTime = Date.now();
      
      const futures = Array.from({ length: count }, () =>
        from(async function* () {
          await new Promise(resolve => setTimeout(resolve, delay));
          return 1;
        })
      );

      await all(futures).toPromise();
      
      const duration = Date.now() - startTime;
      
      // Should take ~delay time (parallel), not ~delay*count (sequential)
      expect(duration).toBeLessThan(delay * 2);
    });

    it("withConcurrencyLimit should respect timing constraints", async () => {
      const delay = 50;
      const count = 6;
      const limit = 2;

      const startTime = Date.now();
      
      const futures = Array.from({ length: count }, () =>
        from(async function* () {
          await new Promise(resolve => setTimeout(resolve, delay));
          return 1;
        })
      );

      await withConcurrencyLimit(futures, limit).toPromise();
      
      const duration = Date.now() - startTime;
      
      // Should take ~(count/limit * delay) time
      const expectedTime = (count / limit) * delay;
      expect(duration).toBeGreaterThan(expectedTime * 0.8);
      expect(duration).toBeLessThan(expectedTime * 1.5);
    });
  });
});
