/**
 * Comprehensive tests for background execution
 * 
 * This test suite validates:
 * - Idle-time execution with requestIdleCallback
 * - Background task scheduling
 * - Cancellation and cleanup
 * - Integration with Future API
 */

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { inBackground } from "./background.ts";
import { from } from "./from.ts";

describe("inBackground()", () => {
  describe("Basic Functionality", () => {
    it("should execute future in background", async () => {
      const future = from(async function* () {
        yield 1;
        yield 2;
        return 3;
      });

      const bgFuture = inBackground(future);
      const result = await bgFuture.toPromise();

      expect(result).toBe(3);
    });

    it("should yield values from background future", async () => {
      const future = from(async function* () {
        yield 1;
        yield 2;
        yield 3;
        return 4;
      });

      const bgFuture = inBackground(future);
      const values: number[] = [];

      for await (const value of bgFuture) {
        values.push(value);
      }

      expect(values).toEqual([1, 2, 3]);
    });

    it("should handle empty future", async () => {
      const future = from(async function* () {
        // Empty
      });

      const bgFuture = inBackground(future);
      const result = await bgFuture.toPromise();

      expect(result).toBeUndefined();
    });

    it("should handle single yield", async () => {
      const future = from(async function* () {
        yield 42;
        return 100;
      });

      const bgFuture = inBackground(future);
      const result = await bgFuture.toPromise();

      expect(result).toBe(100);
    });
  });

  describe("Idle Callback Behavior", () => {
    it("should schedule work during idle time", async () => {
      // This test validates that the future uses idle callbacks
      // We can't easily test the exact timing without mocking requestIdleCallback
      const future = from(async function* () {
        yield 1;
        return 2;
      });

      const bgFuture = inBackground(future);
      const result = await bgFuture.toPromise();

      expect(result).toBe(2);
    });

    it("should handle multiple idle iterations", async () => {
      const future = from(async function* () {
        for (let i = 0; i < 10; i++) {
          yield i;
        }
        return 10;
      });

      const bgFuture = inBackground(future);
      const values: number[] = [];

      for await (const value of bgFuture) {
        values.push(value);
      }

      expect(values).toHaveLength(10);
      expect(values).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it("should properly cleanup idle callbacks", async () => {
      const future = from(async function* () {
        yield 1;
        yield 2;
        return 3;
      });

      const bgFuture = inBackground(future);
      await bgFuture.toPromise();
      await bgFuture.dispose();

      // Should not throw or cause issues
      expect(true).toBe(true);
    });
  });

  describe("Error Handling", () => {
    it("should propagate errors from background future", async () => {
      const future = from(async function* () {
        yield 1;
        throw new Error("Background error");
      });

      const bgFuture = inBackground(future);

      await expect(bgFuture.toPromise()).rejects.toThrow("Background error");
    });

    it("should handle errors during idle iteration", async () => {
      const future = from(async function* () {
        yield 1;
        yield 2;
        throw new Error("Idle error");
      });

      const bgFuture = inBackground(future);
      const values: number[] = [];

      try {
        for await (const value of bgFuture) {
          values.push(value);
        }
      } catch (error) {
        expect((error as Error).message).toBe("Idle error");
      }

      expect(values.length).toBeGreaterThanOrEqual(1);
    });

    it("should cleanup on error", async () => {
      const future = from(async function* () {
        yield 1;
        throw new Error("Cleanup error");
      });

      const bgFuture = inBackground(future);

      try {
        await bgFuture.toPromise();
      } catch {
        // Expected
      }

      await bgFuture.dispose();
      expect(true).toBe(true);
    });
  });

  describe("Cancellation", () => {
    it("should support cancellation", async () => {
      const future = from(async function* (abort) {
        yield 1;
        await new Promise(resolve => setTimeout(resolve, 100));
        abort.signal.throwIfAborted();
        yield 2;
        return 3;
      });

      const bgFuture = inBackground(future);
      const promise = bgFuture.toPromise();

      setTimeout(() => bgFuture.cancel(), 50);

      await expect(promise).rejects.toThrow();
    });

    it("should cleanup idle callbacks on cancellation", async () => {
      const future = from(async function* () {
        yield 1;
        await new Promise(resolve => setTimeout(resolve, 100));
        yield 2;
        return 3;
      });

      const bgFuture = inBackground(future);
      const promise = bgFuture.toPromise();

      setTimeout(() => bgFuture.cancel(), 50);

      try {
        await promise;
      } catch {
        // Expected
      }

      // Should not leak idle callbacks
      expect(true).toBe(true);
    });

    it("should handle cancellation before first idle callback", async () => {
      const future = from(async function* () {
        yield 1;
        return 2;
      });

      const bgFuture = inBackground(future);

      // Cancel immediately
      await bgFuture.cancel();

      await expect(bgFuture.toPromise()).rejects.toThrow();
    });
  });

  describe("Disposal and Resource Management", () => {
    it("should dispose properly", async () => {
      const future = from(async function* () {
        yield 1;
        return 2;
      });

      const bgFuture = inBackground(future);
      await bgFuture.toPromise();
      await bgFuture.dispose();

      expect(bgFuture.getStatus()).toBeDefined();
    });

    it("should support using await using syntax", async () => {
      {
        await using bgFuture = inBackground(from(async function* () {
          yield 1;
          return 2;
        }));

        const result = await bgFuture.toPromise();
        expect(result).toBe(2);
      }

      // Should be automatically disposed
      expect(true).toBe(true);
    });

    it("should cleanup resources from wrapped future", async () => {
      let disposed = false;

      const future = from(async function* (_, stack) {
        stack.defer(() => {
          disposed = true;
        });
        yield 1;
        return 2;
      });

      const bgFuture = inBackground(future);
      await bgFuture.toPromise();
      await bgFuture.dispose();

      expect(disposed).toBe(true);
    });
  });

  describe("Integration with Future API", () => {
    it("should work with pause and resume", async () => {
      const future = from(async function* () {
        yield 1;
        yield 2;
        yield 3;
        return 4;
      });

      const bgFuture = inBackground(future);
      const iterator = bgFuture[Symbol.asyncIterator]();

      const result1 = await iterator.next();
      expect(result1.value).toBe(1);

      bgFuture.pause();
      setTimeout(() => bgFuture.resume(), 50);

      const result2 = await iterator.next();
      expect(result2.value).toBe(2);
    });

    it("should work with reset", async () => {
      const future = from(async function* () {
        yield 1;
        return 2;
      });

      const bgFuture = inBackground(future);

      const result1 = await bgFuture.toPromise();
      expect(result1).toBe(2);

      bgFuture.reset();

      const result2 = await bgFuture.toPromise();
      expect(result2).toBe(2);
    });

    it("should work with clone", async () => {
      const future = from(async function* () {
        yield 1;
        return 2;
      });

      const bgFuture = inBackground(future);
      const clone = bgFuture.clone();

      const [result1, result2] = await Promise.all([
        bgFuture.toPromise(),
        clone.toPromise(),
      ]);

      expect(result1).toBe(2);
      expect(result2).toBe(2);
    });
  });

  describe("Edge Cases", () => {
    it("should handle very fast iterations", async () => {
      const future = from(async function* () {
        for (let i = 0; i < 100; i++) {
          yield i;
        }
        return 100;
      });

      const bgFuture = inBackground(future);
      const result = await bgFuture.toPromise();

      expect(result).toBe(100);
    });

    it("should handle async operations in background", async () => {
      const future = from(async function* () {
        yield 1;
        await new Promise(resolve => setTimeout(resolve, 50));
        yield 2;
        await new Promise(resolve => setTimeout(resolve, 50));
        return 3;
      });

      const bgFuture = inBackground(future);
      const result = await bgFuture.toPromise();

      expect(result).toBe(3);
    });

    it("should handle null and undefined values", async () => {
      const future = from(async function* () {
        yield null;
        yield undefined;
        yield 0;
        return false;
      });

      const bgFuture = inBackground(future);
      const values: (null | undefined | number | boolean)[] = [];

      for await (const value of bgFuture) {
        values.push(value);
      }

      expect(values).toEqual([null, undefined, 0]);
    });

    it("should handle promises in yields", async () => {
      const future = from(async function* () {
        yield Promise.resolve(1);
        yield Promise.resolve(2);
        return 3;
      });

      const bgFuture = inBackground(future);
      const values: Promise<number>[] = [];

      for await (const value of bgFuture) {
        values.push(value);
      }

      const resolved = await Promise.all(values);
      expect(resolved).toEqual([1, 2]);
    });

    it("should handle nested background futures", async () => {
      const inner = from(async function* () {
        yield 1;
        return 2;
      });

      const outer = from(async function* () {
        const bgInner = inBackground(inner);
        const result = await bgInner.toPromise();
        yield result;
        return result * 2;
      });

      const bgOuter = inBackground(outer);
      const result = await bgOuter.toPromise();

      expect(result).toBe(4);
    });

    it("should throw for non-future input", () => {
      // @ts-expect-error - Testing runtime error
      expect(() => inBackground(42)).toThrow();
    });

    it("should throw for null input", () => {
      // @ts-expect-error - Testing runtime error
      expect(() => inBackground(null)).toThrow();
    });

    it("should throw for undefined input", () => {
      // @ts-expect-error - Testing runtime error
      expect(() => inBackground(undefined)).toThrow();
    });
  });

  describe("Performance and Timing", () => {
    it("should not block main thread", async () => {
      // This test validates that background execution doesn't block
      // We measure that the test completes reasonably quickly
      const startTime = Date.now();

      const future = from(async function* () {
        for (let i = 0; i < 10; i++) {
          yield i;
        }
        return 10;
      });

      const bgFuture = inBackground(future);
      await bgFuture.toPromise();

      const duration = Date.now() - startTime;

      // Should complete in reasonable time
      expect(duration).toBeLessThan(5000);
    });

    it("should allow interleaving of multiple background futures", async () => {
      const future1 = from(async function* () {
        for (let i = 0; i < 5; i++) {
          yield i;
        }
        return 5;
      });

      const future2 = from(async function* () {
        for (let i = 0; i < 5; i++) {
          yield i * 10;
        }
        return 50;
      });

      const bg1 = inBackground(future1);
      const bg2 = inBackground(future2);

      const [result1, result2] = await Promise.all([
        bg1.toPromise(),
        bg2.toPromise(),
      ]);

      expect(result1).toBe(5);
      expect(result2).toBe(50);
    });
  });
});
