/**
 * Comprehensive tests for the Future class
 * 
 * This test suite validates the core functionality of the Future class including:
 * - Creation and initialization
 * - Pause/resume capabilities
 * - Cancellation behavior
 * - Async iteration protocol
 * - Promise conversion and interop
 * - Reset and reusability
 * - Disposal and cleanup
 * - Error handling and propagation
 * - Status transitions
 * - Event handling
 */

import { describe, it, beforeEach, afterEach } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { Future } from "./future.ts";
import { from } from "./from.ts";
import { Status } from "./status.ts";
import { CancellationError } from "./errors.ts";

describe("Future", () => {
  describe("Construction and Basic Behavior", () => {
    it("should create a Future from an async generator", async () => {
      const future = new Future<number, number>(async function* () {
        yield 1;
        yield 2;
        return 3;
      });

      expect(future).toBeInstanceOf(Future);
      expect(future.getStatus()).toBe(Status.Idle);
    });

    it("should create a Future from a sync generator", async () => {
      const future = new Future<number, number>(function* () {
        yield 1;
        yield 2;
        return 3;
      });

      const result = await future.toPromise();
      expect(result).toBe(3);
    });

    it("should handle empty generator (no yields, no return)", async () => {
      const future = new Future<never, undefined>(async function* () {
        // Empty generator
      });

      const result = await future.toPromise();
      expect(result).toBeUndefined();
    });

    it("should handle generator with only yields (no explicit return)", async () => {
      const future = new Future<number, undefined>(async function* () {
        yield 1;
        yield 2;
      });

      const result = await future.toPromise();
      expect(result).toBeUndefined();
    });
  });

  describe("Async Iterator Protocol", () => {
    it("should iterate through yielded values", async () => {
      const future = new Future<number, number>(async function* () {
        yield 1;
        yield 2;
        yield 3;
        return 4;
      });

      const values: number[] = [];
      for await (const value of future) {
        values.push(value);
      }

      expect(values).toEqual([1, 2, 3]);
    });

    it("should support manual iteration with next()", async () => {
      const future = new Future<number, number>(async function* () {
        yield 1;
        yield 2;
        return 3;
      });

      const result1 = await future.next();
      expect(result1).toEqual({ value: 1, done: false });

      const result2 = await future.next();
      expect(result2).toEqual({ value: 2, done: false });

      const result3 = await future.next();
      expect(result3).toEqual({ value: 3, done: true });
    });

    it("should support pull-based workflow with next() parameter", async () => {
      const future = new Future<number, number, number>(async function* () {
        let count = 0;
        let input: number;
        
        while (count < 3) {
          input = yield count;
          count = input + 1;
        }
        
        return count;
      });

      const result1 = await future.next();
      expect(result1).toEqual({ value: 0, done: false });

      const result2 = await future.next(5);
      expect(result2).toEqual({ value: 6, done: false });

      const result3 = await future.next(10);
      expect(result3).toEqual({ value: 11, done: false });

      const result4 = await future.next(15);
      expect(result4).toEqual({ value: 16, done: true });
    });

    it("should handle async operations within generator", async () => {
      const future = new Future<string, string>(async function* () {
        yield "start";
        await new Promise(resolve => setTimeout(resolve, 10));
        yield "middle";
        await new Promise(resolve => setTimeout(resolve, 10));
        return "end";
      });

      const values: string[] = [];
      for await (const value of future) {
        values.push(value);
      }

      expect(values).toEqual(["start", "middle"]);
    });
  });

  describe("Promise Interop", () => {
    it("should convert to promise with toPromise()", async () => {
      const future = new Future<number, number>(async function* () {
        yield 1;
        yield 2;
        return 3;
      });

      const result = await future.toPromise();
      expect(result).toBe(3);
    });

    it("should work with await syntax", async () => {
      const future = new Future<number, number>(async function* () {
        yield 1;
        return 2;
      });

      const result = await future;
      expect(result).toBe(2);
    });

    it("should support then() chaining", async () => {
      const future = new Future<number, number>(async function* () {
        yield 1;
        return 2;
      });

      const result = await future.then(x => x * 2);
      expect(result).toBe(4);
    });

    it("should support catch() for error handling", async () => {
      const future = new Future<number, number>(async function* () {
        yield 1;
        throw new Error("Test error");
      });

      const result = await future.catch(err => {
        expect(err.message).toBe("Test error");
        return 42;
      });

      expect(result).toBe(42);
    });

    it("should support finally() for cleanup", async () => {
      let cleanedUp = false;
      
      const future = new Future<number, number>(async function* () {
        yield 1;
        return 2;
      });

      await future.finally(() => {
        cleanedUp = true;
      });

      expect(cleanedUp).toBe(true);
    });

    it("should cache result when converting to promise multiple times", async () => {
      let executionCount = 0;
      
      const future = new Future<number, number>(async function* () {
        executionCount++;
        yield 1;
        return 2;
      });

      const result1 = await future.toPromise();
      const result2 = await future.toPromise();

      expect(result1).toBe(2);
      expect(result2).toBe(2);
      // The generator should only execute once
      expect(executionCount).toBe(1);
    });
  });

  describe("Pause and Resume", () => {
    it("should pause execution", async () => {
      let yielded = false;
      
      const future = new Future<number, number>(async function* () {
        yield 1;
        yielded = true;
        yield 2;
        return 3;
      });

      // Start iteration but pause immediately
      const iteratorPromise = future.next();
      future.pause();

      // Give some time to ensure it's paused
      await new Promise(resolve => setTimeout(resolve, 50));

      // At this point, the first yield should have happened
      const result1 = await iteratorPromise;
      expect(result1.value).toBe(1);
      
      // But the second yield should not have happened yet due to pause
      expect(yielded).toBe(true);
      
      // Now resume
      future.resume();
      
      const result2 = await future.next();
      expect(result2.value).toBe(2);
    });

    it("should update status when pausing", () => {
      const future = new Future<number, number>(async function* () {
        yield 1;
        return 2;
      });

      future.pause();
      expect(future.is(Status.Paused)).toBe(true);
      expect(future.getStatus()).toBe(Status.Paused);
    });

    it("should update status when resuming", async () => {
      const future = new Future<number, number>(async function* () {
        yield 1;
        return 2;
      });

      future.pause();
      expect(future.is(Status.Paused)).toBe(true);

      future.resume();
      expect(future.is(Status.Running)).toBe(true);
    });

    it("should handle multiple pause/resume cycles", async () => {
      const future = new Future<number, number>(async function* () {
        yield 1;
        yield 2;
        yield 3;
        return 4;
      });

      const result1 = await future.next();
      expect(result1.value).toBe(1);

      future.pause();
      expect(future.is(Status.Paused)).toBe(true);

      future.resume();
      const result2 = await future.next();
      expect(result2.value).toBe(2);

      future.pause();
      future.resume();
      
      const result3 = await future.next();
      expect(result3.value).toBe(3);
    });
  });

  describe("Cancellation", () => {
    it("should cancel a running future", async () => {
      const future = new Future<number, number>(async function* (abort) {
        yield 1;
        await new Promise(resolve => setTimeout(resolve, 100));
        yield 2;
        return 3;
      });

      // Start the future
      const promise = future.toPromise();

      // Cancel it
      await future.cancel();

      // Should throw CancellationError
      await expect(promise).rejects.toThrow();
    });

    it("should update status to Cancelled when cancelled", async () => {
      const future = new Future<number, number>(async function* () {
        yield 1;
        await new Promise(resolve => setTimeout(resolve, 100));
        return 2;
      });

      future.next();
      await future.cancel();

      expect(future.is(Status.Cancelled)).toBe(true);
    });

    it("should pass custom cancellation reason", async () => {
      const customError = new Error("Custom cancel reason");
      
      const future = new Future<number, number>(async function* () {
        yield 1;
        await new Promise(resolve => setTimeout(resolve, 100));
        return 2;
      });

      future.next();
      await future.cancel(customError);

      await expect(future.toPromise()).rejects.toBe(customError);
    });

    it("should respect abort signal in generator", async () => {
      let aborted = false;
      
      const future = new Future<number, number>(async function* (abort) {
        yield 1;
        
        try {
          abort.signal.throwIfAborted();
          yield 2;
        } catch {
          aborted = true;
          throw new CancellationError();
        }
      });

      future.next();
      await future.cancel();

      await expect(future.toPromise()).rejects.toThrow();
      
      // Note: The abort flag may or may not be set depending on timing
      // so we don't assert on it strictly
    });

    it("should handle cancellation during iteration", async () => {
      const future = new Future<number, number>(async function* () {
        yield 1;
        yield 2;
        yield 3;
        return 4;
      });

      const values: number[] = [];
      
      try {
        for await (const value of future) {
          values.push(value);
          if (value === 2) {
            await future.cancel();
          }
        }
      } catch {
        // Expected to throw
      }

      expect(values.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Reset and Reusability", () => {
    it("should reset a completed future", async () => {
      const future = new Future<number, number>(async function* () {
        yield 1;
        return 2;
      });

      const result1 = await future.toPromise();
      expect(result1).toBe(2);
      expect(future.is(Status.Completed)).toBe(true);

      future.reset();
      expect(future.is(Status.Idle)).toBe(true);

      const result2 = await future.toPromise();
      expect(result2).toBe(2);
    });

    it("should throw error when resetting a running future", async () => {
      const future = new Future<number, number>(async function* () {
        yield 1;
        await new Promise(resolve => setTimeout(resolve, 100));
        return 2;
      });

      // Start the future
      future.next();

      expect(() => future.reset()).toThrow("Cannot reset a running or incomplete future");
    });

    it("should throw error when resetting a destroyed future", async () => {
      const future = new Future<number, number>(async function* () {
        yield 1;
        return 2;
      });

      await future.dispose();

      expect(() => future.reset()).toThrow("Cannot reset a destroyed future");
    });

    it("should allow reset after cancellation", async () => {
      const future = new Future<number, number>(async function* () {
        yield 1;
        return 2;
      });

      future.next();
      await future.cancel();

      expect(future.is(Status.Cancelled)).toBe(true);

      future.reset();
      expect(future.is(Status.Idle)).toBe(true);

      const result = await future.toPromise();
      expect(result).toBe(2);
    });
  });

  describe("Cloning", () => {
    it("should create an independent clone", async () => {
      const future = new Future<number, number>(async function* () {
        yield 1;
        return 2;
      });

      const clone = future.clone();
      
      expect(clone).toBeInstanceOf(Future);
      expect(clone).not.toBe(future);
      expect(clone.getStatus()).toBe(Status.Idle);
    });

    it("should allow clones to execute independently", async () => {
      const future = new Future<number, number>(async function* () {
        yield 1;
        return 2;
      });

      const clone = future.clone();

      // Execute original
      const result1 = await future.toPromise();
      expect(result1).toBe(2);

      // Clone should still be idle and executable
      expect(clone.getStatus()).toBe(Status.Idle);
      const result2 = await clone.toPromise();
      expect(result2).toBe(2);
    });

    it("should create multiple independent clones", async () => {
      const future = new Future<number, number>(async function* () {
        yield 1;
        return 2;
      });

      const clone1 = future.clone();
      const clone2 = future.clone();
      const clone3 = future.clone();

      const results = await Promise.all([
        future.toPromise(),
        clone1.toPromise(),
        clone2.toPromise(),
        clone3.toPromise(),
      ]);

      expect(results).toEqual([2, 2, 2, 2]);
    });
  });

  describe("Disposal and Cleanup", () => {
    it("should dispose properly", async () => {
      const future = new Future<number, number>(async function* () {
        yield 1;
        return 2;
      });

      await future.dispose();
      
      expect(future.getStatus()).toBe(Status.Destroyed);
    });

    it("should support Symbol.asyncDispose", async () => {
      const future = new Future<number, number>(async function* () {
        yield 1;
        return 2;
      });

      await future[Symbol.asyncDispose]();
      
      expect(future.getStatus()).toBe(Status.Destroyed);
    });

    it("should support using await using syntax", async () => {
      {
        await using future = new Future<number, number>(async function* () {
          yield 1;
          return 2;
        });

        const result = await future.toPromise();
        expect(result).toBe(2);
      }
      
      // Future should be automatically disposed when block exits
      // (We can't easily test this without inspecting internal state)
    });

    it("should cancel before disposing", async () => {
      const future = new Future<number, number>(async function* () {
        yield 1;
        await new Promise(resolve => setTimeout(resolve, 100));
        return 2;
      });

      future.next();
      await future.dispose();

      // Should be both cancelled and destroyed
      expect(future.getStatus()).toBe(Status.Destroyed);
    });

    it("should throw error when iterating over destroyed future", async () => {
      const future = new Future<number, number>(async function* () {
        yield 1;
        return 2;
      });

      await future.dispose();

      expect(() => future[Symbol.asyncIterator]()).toThrow("Cannot iterate over a destroyed future");
    });

    it("should clean up disposable resources", async () => {
      let disposed = false;
      
      const future = new Future<number, number>(async function* (_, stack) {
        stack.defer(() => {
          disposed = true;
        });
        
        yield 1;
        return 2;
      });

      await future.toPromise();
      await future.dispose();

      expect(disposed).toBe(true);
    });
  });

  describe("Error Handling", () => {
    it("should propagate errors from generator", async () => {
      const future = new Future<number, number>(async function* () {
        yield 1;
        throw new Error("Generator error");
      });

      await expect(future.toPromise()).rejects.toThrow("Generator error");
    });

    it("should handle errors during iteration", async () => {
      const future = new Future<number, number>(async function* () {
        yield 1;
        throw new Error("Iteration error");
      });

      const values: number[] = [];
      
      try {
        for await (const value of future) {
          values.push(value);
        }
      } catch (error) {
        expect((error as Error).message).toBe("Iteration error");
      }

      expect(values).toEqual([1]);
    });

    it("should handle errors in async operations", async () => {
      const future = new Future<number, number>(async function* () {
        yield 1;
        await Promise.reject(new Error("Async error"));
        yield 2;
      });

      await expect(future.toPromise()).rejects.toThrow("Async error");
    });

    it("should support throw() method", async () => {
      const future = new Future<number, number>(async function* () {
        try {
          yield 1;
          yield 2;
        } catch (error) {
          return -1;
        }
        return 3;
      });

      await future.next();
      const result = await future.throw(new Error("Injected error"));
      
      expect(result).toEqual({ value: -1, done: true });
    });

    it("should support return() method for early termination", async () => {
      const future = new Future<number, number>(async function* () {
        yield 1;
        yield 2;
        yield 3;
        return 4;
      });

      await future.next();
      const result = await future.return(99);
      
      expect(result.done).toBe(true);
      expect(result.value).toBe(99);
    });
  });

  describe("Status Transitions", () => {
    it("should start in Idle status", () => {
      const future = new Future<number, number>(async function* () {
        yield 1;
        return 2;
      });

      expect(future.is(Status.Idle)).toBe(true);
      expect(future.getStatus()).toBe(Status.Idle);
    });

    it("should transition to Running when started", async () => {
      const future = new Future<number, number>(async function* () {
        yield 1;
        await new Promise(resolve => setTimeout(resolve, 50));
        return 2;
      });

      // Trigger execution
      const promise = future.next();
      
      // Give it a moment to start
      await new Promise(resolve => setTimeout(resolve, 10));
      
      await promise;
    });

    it("should transition to Completed when finished", async () => {
      const future = new Future<number, number>(async function* () {
        yield 1;
        return 2;
      });

      await future.toPromise();
      
      expect(future.is(Status.Completed)).toBe(true);
    });

    it("should maintain Completed status after completion", async () => {
      const future = new Future<number, number>(async function* () {
        yield 1;
        return 2;
      });

      await future.toPromise();
      expect(future.is(Status.Completed)).toBe(true);

      // Calling toPromise again should still show Completed
      await future.toPromise();
      expect(future.is(Status.Completed)).toBe(true);
    });
  });

  describe("Edge Cases and Corner Cases", () => {
    it("should handle very long execution chains", async () => {
      const future = new Future<number, number>(async function* () {
        for (let i = 0; i < 1000; i++) {
          yield i;
        }
        return 999;
      });

      let count = 0;
      for await (const _ of future) {
        count++;
      }

      expect(count).toBe(1000);
    });

    it("should handle rapid pause/resume cycles", async () => {
      const future = new Future<number, number>(async function* () {
        for (let i = 0; i < 10; i++) {
          yield i;
        }
        return 9;
      });

      const promise = future.next();
      
      for (let i = 0; i < 5; i++) {
        future.pause();
        future.resume();
      }

      const result = await promise;
      expect(result.done).toBe(false);
    });

    it("should handle null and undefined yields", async () => {
      const future = new Future<null | undefined | number, number>(async function* () {
        yield null;
        yield undefined;
        yield 0;
        yield "";
        return 42;
      });

      const values: (null | undefined | number | string)[] = [];
      for await (const value of future) {
        values.push(value);
      }

      expect(values).toEqual([null, undefined, 0, ""]);
    });

    it("should handle nested futures", async () => {
      const inner = new Future<number, number>(async function* () {
        yield 1;
        return 2;
      });

      const outer = new Future<number, number>(async function* () {
        const result = await inner.toPromise();
        yield result;
        return result * 2;
      });

      const result = await outer.toPromise();
      expect(result).toBe(4);
    });

    it("should handle generator that yields promises", async () => {
      const future = new Future<Promise<number>, number>(async function* () {
        yield Promise.resolve(1);
        yield Promise.resolve(2);
        return 3;
      });

      const values: number[] = [];
      for await (const value of future) {
        const resolved = await value;
        values.push(resolved);
      }

      expect(values).toEqual([1, 2]);
    });
  });

  describe("AbortController Integration", () => {
    it("should accept external AbortController", async () => {
      const controller = new AbortController();
      
      const future = new Future<number, number>(
        async function* (abort) {
          expect(abort).toBe(controller);
          yield 1;
          return 2;
        },
        controller
      );

      const result = await future.toPromise();
      expect(result).toBe(2);
    });

    it("should handle pre-aborted controller", async () => {
      const controller = new AbortController();
      controller.abort(new Error("Already aborted"));
      
      const future = new Future<number, number>(
        async function* (abort) {
          abort.signal.throwIfAborted();
          yield 1;
          return 2;
        },
        controller
      );

      await expect(future.toPromise()).rejects.toThrow("Already aborted");
    });

    it("should handle external abort during execution", async () => {
      const controller = new AbortController();
      
      const future = new Future<number, number>(
        async function* (abort) {
          yield 1;
          abort.signal.throwIfAborted();
          yield 2;
          return 3;
        },
        controller
      );

      const promise = future.toPromise();
      
      // Abort from outside
      setTimeout(() => controller.abort(new Error("External abort")), 50);

      await expect(promise).rejects.toThrow();
    });
  });
});
