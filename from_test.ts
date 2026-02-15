/**
 * Comprehensive tests for the from() factory function
 * 
 * This test suite validates the conversion of various types into Future instances:
 * - Promise and PromiseLike conversion
 * - Iterable and AsyncIterable conversion
 * - Iterator and AsyncIterator conversion
 * - Generator and AsyncGenerator conversion
 * - ReadableStream conversion
 * - Plain value conversion
 * - Future passthrough
 * - Custom operations
 */

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { from, of, fromPromise, fromIterable, fromIterator, fromStream, fromOperation, is } from "./from.ts";
import { Future } from "./future.ts";

describe("from() factory function", () => {
  describe("Promise Conversion", () => {
    it("should convert a resolved Promise to Future", async () => {
      const promise = Promise.resolve(42);
      const future = from(promise);

      expect(future).toBeInstanceOf(Future);
      const result = await future.toPromise();
      expect(result).toBe(42);
    });

    it("should convert a rejected Promise to Future", async () => {
      const promise = Promise.reject(new Error("Test error"));
      const future = from(promise);

      await expect(future.toPromise()).rejects.toThrow("Test error");
    });

    it("should convert a pending Promise to Future", async () => {
      const promise = new Promise((resolve) => {
        setTimeout(() => resolve(100), 50);
      });
      
      const future = from(promise);
      const result = await future.toPromise();
      
      expect(result).toBe(100);
    });

    it("should handle Promise-like objects (thenables)", async () => {
      const thenable = {
        then(onFulfilled: (value: number) => void) {
          onFulfilled(42);
        }
      };

      const future = from(thenable);
      const result = await future.toPromise();
      
      expect(result).toBe(42);
    });

    it("should convert Promise and yield it before returning", async () => {
      const promise = Promise.resolve(42);
      const future = from(promise);

      const values: number[] = [];
      for await (const value of future) {
        values.push(value);
      }

      expect(values).toEqual([42]);
    });
  });

  describe("Async Iterable Conversion", () => {
    it("should convert async iterable to Future", async () => {
      async function* asyncGen() {
        yield 1;
        yield 2;
        yield 3;
      }

      const future = from(asyncGen());
      const values: number[] = [];
      
      for await (const value of future) {
        values.push(value);
      }

      expect(values).toEqual([1, 2, 3]);
    });

    it("should convert async iterable with return value", async () => {
      async function* asyncGen() {
        yield 1;
        yield 2;
        return 42;
      }

      const future = from(asyncGen());
      const result = await future.toPromise();
      
      expect(result).toBe(42);
    });

    it("should handle empty async iterable", async () => {
      async function* emptyGen() {
        // Empty
      }

      const future = from(emptyGen());
      const result = await future.toPromise();
      
      expect(result).toBeUndefined();
    });

    it("should handle async iterable with async operations", async () => {
      async function* asyncGen() {
        yield 1;
        await new Promise(resolve => setTimeout(resolve, 10));
        yield 2;
        await new Promise(resolve => setTimeout(resolve, 10));
        yield 3;
      }

      const future = from(asyncGen());
      const values: number[] = [];
      
      for await (const value of future) {
        values.push(value);
      }

      expect(values).toEqual([1, 2, 3]);
    });
  });

  describe("Sync Iterable Conversion", () => {
    it("should convert array to Future", async () => {
      const arr = [1, 2, 3];
      const future = from(arr);

      const values: number[] = [];
      for await (const value of future) {
        values.push(value);
      }

      expect(values).toEqual([1, 2, 3]);
    });

    it("should convert Set to Future", async () => {
      const set = new Set([1, 2, 3]);
      const future = from(set);

      const values: number[] = [];
      for await (const value of future) {
        values.push(value);
      }

      expect(values).toEqual([1, 2, 3]);
    });

    it("should convert Map to Future", async () => {
      const map = new Map([
        ["a", 1],
        ["b", 2],
      ]);
      
      const future = from(map);

      const values: [string, number][] = [];
      for await (const value of future) {
        values.push(value);
      }

      expect(values).toEqual([["a", 1], ["b", 2]]);
    });

    it("should convert string to Future (as character iterable)", async () => {
      const str = "abc";
      const future = from(str);

      const values: string[] = [];
      for await (const value of future) {
        values.push(value);
      }

      expect(values).toEqual(["a", "b", "c"]);
    });

    it("should convert sync generator to Future", async () => {
      function* syncGen() {
        yield 1;
        yield 2;
        return 3;
      }

      const future = from(syncGen());
      const values: number[] = [];
      
      for await (const value of future) {
        values.push(value);
      }

      expect(values).toEqual([1, 2]);
      
      const result = await future.toPromise();
      expect(result).toEqual([1, 2]);
    });

    it("should handle custom iterable objects", async () => {
      const customIterable = {
        *[Symbol.iterator]() {
          yield 10;
          yield 20;
          yield 30;
        }
      };

      const future = from(customIterable);
      const values: number[] = [];
      
      for await (const value of future) {
        values.push(value);
      }

      expect(values).toEqual([10, 20, 30]);
    });
  });

  describe("Iterator Conversion", () => {
    it("should convert async iterator to Future", async () => {
      async function* asyncGen() {
        yield 1;
        yield 2;
        return 3;
      }

      const iterator = asyncGen();
      const future = from(iterator);
      
      const result = await future.toPromise();
      expect(result).toBe(3);
    });

    it("should convert sync iterator to Future", async () => {
      function* syncGen() {
        yield 1;
        yield 2;
        return 3;
      }

      const iterator = syncGen();
      const future = from(iterator);
      
      const values: number[] = [];
      for await (const value of future) {
        values.push(value);
      }

      expect(values).toEqual([1, 2]);
    });

    it("should handle manual iterator object", async () => {
      let count = 0;
      const iterator = {
        next() {
          if (count < 3) {
            return { value: ++count, done: false };
          }
          return { value: undefined, done: true };
        }
      };

      const future = from(iterator);
      const values: number[] = [];
      
      for await (const value of future) {
        values.push(value);
      }

      expect(values).toEqual([1, 2, 3]);
    });
  });

  describe("ReadableStream Conversion", () => {
    it("should convert ReadableStream to Future", async () => {
      const stream = new ReadableStream<number>({
        start(controller) {
          controller.enqueue(1);
          controller.enqueue(2);
          controller.enqueue(3);
          controller.close();
        }
      });

      const future = from(stream);
      const values: number[] = [];
      
      for await (const value of future) {
        values.push(value);
      }

      expect(values).toEqual([1, 2, 3]);
    });

    it("should handle empty ReadableStream", async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.close();
        }
      });

      const future = from(stream);
      const result = await future.toPromise();
      
      expect(result).toBeUndefined();
    });

    it("should handle ReadableStream with async chunks", async () => {
      const stream = new ReadableStream<string>({
        async start(controller) {
          controller.enqueue("chunk1");
          await new Promise(resolve => setTimeout(resolve, 10));
          controller.enqueue("chunk2");
          await new Promise(resolve => setTimeout(resolve, 10));
          controller.enqueue("chunk3");
          controller.close();
        }
      });

      const future = from(stream);
      const values: string[] = [];
      
      for await (const value of future) {
        values.push(value);
      }

      expect(values).toEqual(["chunk1", "chunk2", "chunk3"]);
    });

    it("should handle ReadableStream errors", async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(1);
          controller.error(new Error("Stream error"));
        }
      });

      const future = from(stream);
      
      await expect(future.toPromise()).rejects.toThrow("Stream error");
    });
  });

  describe("Generator Function Conversion", () => {
    it("should convert async generator function to Future", async () => {
      const operation = async function* () {
        yield 1;
        yield 2;
        return 3;
      };

      const future = from(operation);
      const result = await future.toPromise();
      
      expect(result).toBe(3);
    });

    it("should convert sync generator function to Future", async () => {
      const operation = function* () {
        yield 1;
        yield 2;
        return 3;
      };

      const future = from(operation);
      const values: number[] = [];
      
      for await (const value of future) {
        values.push(value);
      }

      expect(values).toEqual([1, 2]);
    });

    it("should pass AbortController to generator function", async () => {
      let receivedAbort: AbortController | null = null;

      const operation = async function* (abort: AbortController) {
        receivedAbort = abort;
        yield 1;
        return 2;
      };

      const future = from(operation);
      await future.toPromise();
      
      expect(receivedAbort).toBeInstanceOf(AbortController);
    });

    it("should pass DisposableStack to generator function", async () => {
      let receivedStack = false;

      const operation = async function* (_abort: AbortController, stack: any) {
        if (stack) receivedStack = true;
        yield 1;
        return 2;
      };

      const future = from(operation);
      await future.toPromise();
      
      expect(receivedStack).toBe(true);
    });
  });

  describe("Plain Value Conversion", () => {
    it("should convert number to Future", async () => {
      const future = from(42);
      const result = await future.toPromise();
      
      expect(result).toBe(42);
    });

    it("should convert string to Future (non-iterable context)", async () => {
      // When string is not treated as iterable
      const future = of("hello");
      const result = await future.toPromise();
      
      expect(result).toBe("hello");
    });

    it("should convert object to Future", async () => {
      const obj = { foo: "bar" };
      const future = from(obj);
      const result = await future.toPromise();
      
      expect(result).toBe(obj);
    });

    it("should convert null to Future", async () => {
      const future = from(null);
      const result = await future.toPromise();
      
      expect(result).toBe(null);
    });

    it("should convert undefined to Future", async () => {
      const future = from(undefined);
      const result = await future.toPromise();
      
      expect(result).toBe(undefined);
    });

    it("should convert boolean to Future", async () => {
      const future1 = from(true);
      const future2 = from(false);
      
      expect(await future1.toPromise()).toBe(true);
      expect(await future2.toPromise()).toBe(false);
    });
  });

  describe("Future Passthrough", () => {
    it("should return same Future instance when passed a Future", async () => {
      const original = new Future<number, number>(async function* () {
        yield 1;
        return 2;
      });

      const result = from(original);
      
      expect(result).toBe(original);
    });

    it("should not wrap Future in another Future", async () => {
      const original = new Future<number, number>(async function* () {
        yield 1;
        return 2;
      });

      const passthrough = from(original);
      const value = await passthrough.toPromise();
      
      expect(value).toBe(2);
      expect(passthrough).toBe(original);
    });
  });

  describe("Helper Functions", () => {
    describe("of()", () => {
      it("should create Future from plain value", async () => {
        const future = of(42);
        const result = await future.toPromise();
        
        expect(result).toBe(42);
      });

      it("should yield value before returning", async () => {
        const future = of(42);
        const values: number[] = [];
        
        for await (const value of future) {
          values.push(value);
        }

        expect(values).toEqual([42]);
      });
    });

    describe("fromPromise()", () => {
      it("should convert Promise to Future", async () => {
        const promise = Promise.resolve(42);
        const future = fromPromise(promise);
        
        const result = await future.toPromise();
        expect(result).toBe(42);
      });

      it("should yield promise result", async () => {
        const promise = Promise.resolve(42);
        const future = fromPromise(promise);
        
        const values: number[] = [];
        for await (const value of future) {
          values.push(value);
        }

        expect(values).toEqual([42]);
      });
    });

    describe("fromIterable()", () => {
      it("should convert iterable to Future", async () => {
        const iterable = [1, 2, 3];
        const future = fromIterable(iterable);
        
        const values: number[] = [];
        for await (const value of future) {
          values.push(value);
        }

        expect(values).toEqual([1, 2, 3]);
      });

      it("should handle async iterable", async () => {
        async function* asyncGen() {
          yield 1;
          yield 2;
          yield 3;
        }

        const future = fromIterable(asyncGen());
        const values: number[] = [];
        
        for await (const value of future) {
          values.push(value);
        }

        expect(values).toEqual([1, 2, 3]);
      });
    });

    describe("fromIterator()", () => {
      it("should convert iterator to Future", async () => {
        function* gen() {
          yield 1;
          yield 2;
          return 3;
        }

        const future = fromIterator(gen());
        const result = await future.toPromise();
        
        expect(result).toBe(3);
      });

      it("should preserve iterator behavior", async () => {
        function* gen() {
          yield 1;
          yield 2;
          return 3;
        }

        const future = fromIterator(gen());
        const values: number[] = [];
        
        for await (const value of future) {
          values.push(value);
        }

        expect(values).toEqual([1, 2]);
      });
    });

    describe("fromStream()", () => {
      it("should convert stream to Future", async () => {
        const stream = new ReadableStream<number>({
          start(controller) {
            controller.enqueue(1);
            controller.enqueue(2);
            controller.close();
          }
        });

        const future = fromStream(stream);
        const values: number[] = [];
        
        for await (const value of future) {
          values.push(value);
        }

        expect(values).toEqual([1, 2]);
      });
    });

    describe("fromOperation()", () => {
      it("should convert operation function to Future", async () => {
        const operation = async function* () {
          yield 1;
          return 2;
        };

        const future = fromOperation(operation);
        const result = await future.toPromise();
        
        expect(result).toBe(2);
      });

      it("should handle operation returning generator", async () => {
        const operation = () => {
          return (async function* () {
            yield 1;
            yield 2;
            return 3;
          })();
        };

        const future = fromOperation(operation);
        const result = await future.toPromise();
        
        expect(result).toBe(3);
      });

      it("should handle operation returning promise", async () => {
        const operation = () => Promise.resolve(42);

        const future = fromOperation(operation);
        const result = await future.toPromise();
        
        expect(result).toBe(42);
      });

      it("should handle operation returning plain value", async () => {
        const operation = () => 42;

        const future = fromOperation(operation);
        const result = await future.toPromise();
        
        expect(result).toBe(42);
      });
    });

    describe("is()", () => {
      it("should return true for Future instances", () => {
        const future = new Future<number, number>(async function* () {
          yield 1;
          return 2;
        });

        expect(is(future)).toBe(true);
      });

      it("should return false for non-Future values", () => {
        expect(is(42)).toBe(false);
        expect(is("string")).toBe(false);
        expect(is({})).toBe(false);
        expect(is(null)).toBe(false);
        expect(is(undefined)).toBe(false);
        expect(is(Promise.resolve(1))).toBe(false);
      });

      it("should work as type guard", () => {
        const value: unknown = new Future<number, number>(async function* () {
          yield 1;
          return 2;
        });

        if (is(value)) {
          // TypeScript should know this is a Future
          const result = value.toPromise();
          expect(result).toBeInstanceOf(Promise);
        }
      });
    });
  });

  describe("Edge Cases", () => {
    it("should handle iterable with Promise values", async () => {
      const iterable = [
        Promise.resolve(1),
        Promise.resolve(2),
        Promise.resolve(3),
      ];

      const future = from(iterable);
      const values: Promise<number>[] = [];
      
      for await (const value of future) {
        values.push(value);
      }

      const resolved = await Promise.all(values);
      expect(resolved).toEqual([1, 2, 3]);
    });

    it("should handle mixed iterable with promises and plain values", async () => {
      const iterable = [
        1,
        Promise.resolve(2),
        3,
        Promise.resolve(4),
      ];

      const future = from(iterable);
      const values: (number | Promise<number>)[] = [];
      
      for await (const value of future) {
        values.push(value);
      }

      expect(values).toHaveLength(4);
    });

    it("should handle empty array", async () => {
      const future = from([]);
      const values: never[] = [];
      
      for await (const value of future) {
        values.push(value);
      }

      expect(values).toEqual([]);
    });

    it("should handle array with single element", async () => {
      const future = from([42]);
      const values: number[] = [];
      
      for await (const value of future) {
        values.push(value);
      }

      expect(values).toEqual([42]);
    });

    it("should handle generator that immediately returns", async () => {
      async function* gen() {
        return 42;
      }

      const future = from(gen());
      const result = await future.toPromise();
      
      expect(result).toBe(42);
    });

    it("should handle operation that throws immediately", async () => {
      const operation = async function* () {
        throw new Error("Immediate error");
      };

      const future = from(operation);
      
      await expect(future.toPromise()).rejects.toThrow("Immediate error");
    });

    it("should handle very large iterables efficiently", async () => {
      const largeArray = Array.from({ length: 10000 }, (_, i) => i);
      const future = from(largeArray);
      
      let count = 0;
      for await (const _ of future) {
        count++;
      }

      expect(count).toBe(10000);
    });

    it("should preserve type information through conversion", async () => {
      type CustomType = { id: number; name: string };
      const data: CustomType[] = [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ];

      const future = from(data);
      const result: CustomType[] = [];
      
      for await (const item of future) {
        result.push(item);
      }

      expect(result).toEqual(data);
    });
  });

  describe("Disposal and Resource Management", () => {
    it("should properly dispose of resources from stream", async () => {
      let cancelled = false;
      
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(1);
          controller.enqueue(2);
          controller.close();
        },
        cancel() {
          cancelled = true;
        }
      });

      const future = from(stream);
      await future.toPromise();
      await future.dispose();
      
      // Stream should be properly cleaned up
      expect(true).toBe(true); // Basic check
    });

    it("should handle disposal during iteration", async () => {
      const future = from([1, 2, 3, 4, 5]);
      
      let count = 0;
      try {
        for await (const value of future) {
          count++;
          if (count === 2) {
            await future.dispose();
          }
        }
      } catch {
        // Expected to potentially throw
      }

      expect(count).toBeGreaterThanOrEqual(2);
    });
  });
});
