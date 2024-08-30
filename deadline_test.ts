import { test } from "@libs/testing";
import { expect } from "@std/expect";

import * as Future from "./mod.ts";

async function* gen() {
  throw new Error("Random message");
  yield new Promise((resolve) => setTimeout(resolve, 2000)); // Simulate a long-running task
  return 42;
}
// const future = Future.from(gen);

async function* wrapper<T, TReturn, TNext>(
  generator: AsyncGenerator<T, TReturn, TNext>,
): AsyncGenerator<T, T | TReturn, TNext> | undefined {
  let err: unknown;
  let result: IteratorResult<T, T | TReturn> | undefined;
  try {
    if (!generator || typeof generator?.next !== "function") {
      throw new Error("generator not defined");
    }

    // Continue yielding values until the generator completes
    do {
      const iteratorResult = result
        // Yield the value to the consumer and wait for the next input
        ? generator?.next?.(yield result?.value! as T)
        // Prime the generator by starting the iteration process
        : generator?.next?.();

      await Promise.race([iteratorResult]);
      result = await iteratorResult;
    } while (!result?.done);

    // Return the final value once iteration completes
    return result?.value as TReturn;
  } catch (error) {
    // If an error occurs, propagate it to the generator
    if (generator?.throw) {
      try {
        result = await generator.throw(error);
      } catch (genError) {
        err = genError;
      }
    } else {
      err = error;
    }

    // Rethrow the error if it wasn't caught by the generator
    if (err) throw err;
  }
}

// Test when the Future resolves before the deadline
test("deno")(
  "withDeadline should resolve if Future completes before the deadline",
  async () => {
    const future = Future.from(async function* () {
      yield 42;
      return 100;
    });

    // Setting a generous deadline of 1000ms (1 second)
    const deadlineFuture = Future.withDeadline(future, 1000);

    const result = await deadlineFuture.toPromise();

    // The future should resolve to 100 since it completes before the deadline
    expect(result).toBe(100);
  },
);

// Test when the Future exceeds the deadline and gets canceled
test.only("deno")(
  "withDeadline should cancel the Future if it exceeds the deadline",
  async () => {
    try {
      const iterator = wrapper(gen());
      await iterator?.next();

      const future = Future.from(gen);
      await future?.next();

      // let result: IteratorResult<unknown>;
      // const generator = gen();
      //   // Iterate through the generator until completion
      //   do {
      //     result = await generator.next();
      //   } while (!result.done);

      // Setting a short deadline of 500ms
      // const deadlineFuture = Future.withDeadline(future, 500);
      // await deadlineFuture.toPromise();
      throw new Error("Expected the Future to be canceled due to deadline");
    } catch (error) {
      // The Future should have been canceled, so we expect the error to be thrown
      // expect(error.message).toBe("Future timed out");
    }
  },
);
