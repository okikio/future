import { test } from "@libs/testing";
import { expect } from "@std/expect";

import * as Future from "./mod.ts";

// Test when the Future resolves before the deadline
test(
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
test.only("node")(
  "withDeadline should cancel the Future if it exceeds the deadline",
  async () => {
    try {
      const future = Future.from(async function* () {
        // throw new Error("Random message");
        yield 10;
        yield* Future.delay(1000, 50);
        const delay = Future.delay(10_000); // Simulate a long-running task
        yield* delay; // Simulate a long-running task
        return 1000;
      });

      // Setting a short deadline of 500ms
      const deadlineFuture = Future.withDeadline(future, 500);
      for await (const value of deadlineFuture) {
        console.log("Value:", value);
      }
      await deadlineFuture.toPromise();
      throw new Error("Expected the Future to be canceled due to deadline");
    } catch (error) {
      // The Future should have been canceled, so we expect the error to be thrown
      expect(error.message).toBe("Future timed out");
    }
  },
);
