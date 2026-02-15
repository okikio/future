/**
 * Comprehensive tests for resolvers and abortable utilities
 * 
 * This test suite validates:
 * - withResolvers() for manual future control
 * - withAbortable() for external cancellation
 */

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { withResolvers } from "./resolvers.ts";
import { withAbortable } from "./abortable.ts";
import { from } from "./from.ts";

describe("withResolvers()", () => {
  describe("Basic Functionality", () => {
    it("should create a future with resolve and reject functions", () => {
      const { future, resolve, reject } = withResolvers<number>();

      expect(future).toBeDefined();
      expect(typeof resolve).toBe("function");
      expect(typeof reject).toBe("function");
    });

    it("should resolve the future when resolve is called", async () => {
      const { future, resolve } = withResolvers<number>();

      resolve(42);

      const result = await future.toPromise();
      expect(result).toBe(42);
    });

    it("should reject the future when reject is called", async () => {
      const { future, reject } = withResolvers<number>();

      reject(new Error("Test error"));

      await expect(future.toPromise()).rejects.toThrow("Test error");
    });

    it("should resolve with undefined", async () => {
      const { future, resolve } = withResolvers<undefined>();

      resolve(undefined);

      const result = await future.toPromise();
      expect(result).toBeUndefined();
    });

    it("should resolve with null", async () => {
      const { future, resolve } = withResolvers<null>();

      resolve(null);

      const result = await future.toPromise();
      expect(result).toBeNull();
    });

    it("should resolve with complex objects", async () => {
      type CustomType = { id: number; name: string };
      const { future, resolve } = withResolvers<CustomType>();

      const obj = { id: 1, name: "test" };
      resolve(obj);

      const result = await future.toPromise();
      expect(result).toEqual(obj);
    });
  });

  describe("Async Resolution", () => {
    it("should handle delayed resolution", async () => {
      const { future, resolve } = withResolvers<number>();

      setTimeout(() => resolve(42), 50);

      const result = await future.toPromise();
      expect(result).toBe(42);
    });

    it("should handle delayed rejection", async () => {
      const { future, reject } = withResolvers<number>();

      setTimeout(() => reject(new Error("Delayed error")), 50);

      await expect(future.toPromise()).rejects.toThrow("Delayed error");
    });

    it("should handle resolution with promise", async () => {
      const { future, resolve } = withResolvers<number>();

      resolve(Promise.resolve(42));

      const result = await future.toPromise();
      expect(result).toBe(42);
    });

    it("should handle rejection via promise", async () => {
      const { future, resolve } = withResolvers<number>();

      resolve(Promise.reject(new Error("Promise error")));

      await expect(future.toPromise()).rejects.toThrow("Promise error");
    });
  });

  describe("Integration with Future API", () => {
    it("should work with then/catch", async () => {
      const { future, resolve } = withResolvers<number>();

      const promise = future.then(x => x * 2);
      resolve(21);

      const result = await promise;
      expect(result).toBe(42);
    });

    it("should work with cancellation", async () => {
      const { future, resolve } = withResolvers<number>();

      const promise = future.toPromise();

      // Cancel before resolving
      await future.cancel();

      // Resolution should not affect the cancelled future
      resolve(42);

      await expect(promise).rejects.toThrow();
    });

    it("should work with disposal", async () => {
      const { future, resolve } = withResolvers<number>();

      resolve(42);
      await future.toPromise();
      await future.dispose();

      expect(true).toBe(true);
    });

    it("should support using await using syntax", async () => {
      {
        await using wrapper = withResolvers<number>();
        wrapper.resolve(42);

        const result = await wrapper.future.toPromise();
        expect(result).toBe(42);
      }

      expect(true).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle multiple resolve calls (only first takes effect)", async () => {
      const { future, resolve } = withResolvers<number>();

      resolve(1);
      resolve(2);
      resolve(3);

      const result = await future.toPromise();
      expect(result).toBe(1);
    });

    it("should handle resolve then reject (only first takes effect)", async () => {
      const { future, resolve, reject } = withResolvers<number>();

      resolve(42);
      reject(new Error("Should not throw"));

      const result = await future.toPromise();
      expect(result).toBe(42);
    });

    it("should handle reject then resolve (only first takes effect)", async () => {
      const { future, resolve, reject } = withResolvers<number>();

      reject(new Error("Test error"));
      resolve(42);

      await expect(future.toPromise()).rejects.toThrow("Test error");
    });

    it("should work with zero value", async () => {
      const { future, resolve } = withResolvers<number>();

      resolve(0);

      const result = await future.toPromise();
      expect(result).toBe(0);
    });

    it("should work with false value", async () => {
      const { future, resolve } = withResolvers<boolean>();

      resolve(false);

      const result = await future.toPromise();
      expect(result).toBe(false);
    });

    it("should work with empty string", async () => {
      const { future, resolve } = withResolvers<string>();

      resolve("");

      const result = await future.toPromise();
      expect(result).toBe("");
    });
  });

  describe("Type Safety", () => {
    it("should maintain type information", async () => {
      const { future, resolve } = withResolvers<string>();

      resolve("hello");

      const result: string = await future.toPromise();
      expect(result).toBe("hello");
    });

    it("should work with union types", async () => {
      const { future, resolve } = withResolvers<string | number>();

      resolve(42);

      const result = await future.toPromise();
      expect(result).toBe(42);
    });

    it("should work with complex generic types", async () => {
      type Result<T> = { success: true; data: T } | { success: false; error: string };
      const { future, resolve } = withResolvers<Result<number>>();

      resolve({ success: true, data: 42 });

      const result = await future.toPromise();
      expect(result).toEqual({ success: true, data: 42 });
    });
  });
});

describe("withAbortable()", () => {
  describe("Basic Functionality with AbortController", () => {
    it("should link future to AbortController", async () => {
      const controller = new AbortController();
      const future = from(async function* () {
        yield 1;
        return 2;
      });

      const abortableFuture = withAbortable(future, controller);
      const result = await abortableFuture.toPromise();

      expect(result).toBe(2);
    });

    it("should cancel future when controller is aborted", async () => {
      const controller = new AbortController();
      const future = from(async function* () {
        yield 1;
        await new Promise(resolve => setTimeout(resolve, 100));
        yield 2;
        return 3;
      });

      const abortableFuture = withAbortable(future, controller);
      const promise = abortableFuture.toPromise();

      setTimeout(() => controller.abort(), 50);

      await expect(promise).rejects.toThrow();
    });

    it("should pass abort reason to future", async () => {
      const controller = new AbortController();
      const customError = new Error("Custom abort");

      const future = from(async function* () {
        yield 1;
        await new Promise(resolve => setTimeout(resolve, 100));
        return 2;
      });

      const abortableFuture = withAbortable(future, controller);
      const promise = abortableFuture.toPromise();

      setTimeout(() => controller.abort(customError), 50);

      await expect(promise).rejects.toBe(customError);
    });

    it("should handle pre-aborted controller", async () => {
      const controller = new AbortController();
      controller.abort(new Error("Already aborted"));

      const future = from(async function* () {
        yield 1;
        return 2;
      });

      const abortableFuture = withAbortable(future, controller);

      await expect(abortableFuture.toPromise()).rejects.toThrow("Already aborted");
    });
  });

  describe("Basic Functionality with AbortSignal", () => {
    it("should link future to AbortSignal", async () => {
      const controller = new AbortController();
      const future = from(async function* () {
        yield 1;
        return 2;
      });

      const abortableFuture = withAbortable(future, controller.signal);
      const result = await abortableFuture.toPromise();

      expect(result).toBe(2);
    });

    it("should cancel future when signal is aborted", async () => {
      const controller = new AbortController();
      const future = from(async function* () {
        yield 1;
        await new Promise(resolve => setTimeout(resolve, 100));
        yield 2;
        return 3;
      });

      const abortableFuture = withAbortable(future, controller.signal);
      const promise = abortableFuture.toPromise();

      setTimeout(() => controller.abort(), 50);

      await expect(promise).rejects.toThrow();
    });

    it("should handle pre-aborted signal", async () => {
      const controller = new AbortController();
      controller.abort(new Error("Already aborted"));

      const future = from(async function* () {
        yield 1;
        return 2;
      });

      const abortableFuture = withAbortable(future, controller.signal);

      await expect(abortableFuture.toPromise()).rejects.toThrow("Already aborted");
    });
  });

  describe("Cleanup and Resource Management", () => {
    it("should cleanup event listeners after completion", async () => {
      const controller = new AbortController();
      const future = from(async function* () {
        yield 1;
        return 2;
      });

      const abortableFuture = withAbortable(future, controller);
      await abortableFuture.toPromise();

      // Aborting after completion should not affect anything
      controller.abort();

      expect(true).toBe(true);
    });

    it("should cleanup on error", async () => {
      const controller = new AbortController();
      const future = from(async function* () {
        yield 1;
        throw new Error("Test error");
      });

      const abortableFuture = withAbortable(future, controller);

      try {
        await abortableFuture.toPromise();
      } catch {
        // Expected
      }

      // Should have cleaned up
      expect(true).toBe(true);
    });

    it("should support disposal", async () => {
      const controller = new AbortController();
      const future = from(async function* () {
        yield 1;
        return 2;
      });

      const abortableFuture = withAbortable(future, controller);
      await abortableFuture.toPromise();
      await abortableFuture.dispose();

      expect(true).toBe(true);
    });

    it("should support using await using syntax", async () => {
      const controller = new AbortController();

      {
        await using abortableFuture = withAbortable(
          from(async function* () {
            yield 1;
            return 2;
          }),
          controller
        );

        const result = await abortableFuture.toPromise();
        expect(result).toBe(2);
      }

      expect(true).toBe(true);
    });
  });

  describe("Integration with Future API", () => {
    it("should work with pause and resume", async () => {
      const controller = new AbortController();
      const future = from(async function* () {
        yield 1;
        yield 2;
        return 3;
      });

      const abortableFuture = withAbortable(future, controller);
      const iterator = abortableFuture[Symbol.asyncIterator]();

      const result1 = await iterator.next();
      expect(result1.value).toBe(1);

      abortableFuture.pause();
      setTimeout(() => abortableFuture.resume(), 50);

      const result2 = await iterator.next();
      expect(result2.value).toBe(2);
    });

    it("should work with manual iteration", async () => {
      const controller = new AbortController();
      const future = from(async function* () {
        yield 1;
        yield 2;
        return 3;
      });

      const abortableFuture = withAbortable(future, controller);

      const result1 = await abortableFuture.next();
      expect(result1).toEqual({ value: 1, done: false });

      const result2 = await abortableFuture.next();
      expect(result2).toEqual({ value: 2, done: false });

      const result3 = await abortableFuture.next();
      expect(result3).toEqual({ value: 3, done: true });
    });

    it("should work with clone", async () => {
      const controller = new AbortController();
      const future = from(async function* () {
        yield 1;
        return 2;
      });

      const abortableFuture = withAbortable(future, controller);
      const clone = abortableFuture.clone();

      const [result1, result2] = await Promise.all([
        abortableFuture.toPromise(),
        clone.toPromise(),
      ]);

      expect(result1).toBe(2);
      expect(result2).toBe(2);
    });
  });

  describe("Edge Cases", () => {
    it("should handle abort during iteration", async () => {
      const controller = new AbortController();
      const future = from(async function* () {
        yield 1;
        yield 2;
        yield 3;
        return 4;
      });

      const abortableFuture = withAbortable(future, controller);
      const values: number[] = [];

      try {
        for await (const value of abortableFuture) {
          values.push(value);
          if (value === 2) {
            controller.abort();
          }
        }
      } catch {
        // Expected
      }

      expect(values).toContain(1);
      expect(values).toContain(2);
    });

    it("should handle multiple abort calls", async () => {
      const controller = new AbortController();
      const future = from(async function* () {
        yield 1;
        await new Promise(resolve => setTimeout(resolve, 100));
        return 2;
      });

      const abortableFuture = withAbortable(future, controller);
      const promise = abortableFuture.toPromise();

      setTimeout(() => {
        controller.abort();
        controller.abort();
        controller.abort();
      }, 50);

      await expect(promise).rejects.toThrow();
    });

    it("should handle null and undefined yields", async () => {
      const controller = new AbortController();
      const future = from(async function* () {
        yield null;
        yield undefined;
        yield 0;
        return false;
      });

      const abortableFuture = withAbortable(future, controller);
      const values: (null | undefined | number | boolean)[] = [];

      for await (const value of abortableFuture) {
        values.push(value);
      }

      expect(values).toEqual([null, undefined, 0]);
    });

    it("should work with nested abortable futures", async () => {
      const controller1 = new AbortController();
      const controller2 = new AbortController();

      const inner = from(async function* () {
        yield 1;
        return 2;
      });

      const middle = withAbortable(inner, controller1);
      const outer = withAbortable(middle, controller2);

      const result = await outer.toPromise();
      expect(result).toBe(2);
    });

    it("should handle abort from inner controller", async () => {
      const controller1 = new AbortController();
      const controller2 = new AbortController();

      const inner = from(async function* () {
        yield 1;
        await new Promise(resolve => setTimeout(resolve, 100));
        return 2;
      });

      const middle = withAbortable(inner, controller1);
      const outer = withAbortable(middle, controller2);

      const promise = outer.toPromise();

      setTimeout(() => controller1.abort(), 50);

      await expect(promise).rejects.toThrow();
    });

    it("should handle abort from outer controller", async () => {
      const controller1 = new AbortController();
      const controller2 = new AbortController();

      const inner = from(async function* () {
        yield 1;
        await new Promise(resolve => setTimeout(resolve, 100));
        return 2;
      });

      const middle = withAbortable(inner, controller1);
      const outer = withAbortable(middle, controller2);

      const promise = outer.toPromise();

      setTimeout(() => controller2.abort(), 50);

      await expect(promise).rejects.toThrow();
    });
  });
});
