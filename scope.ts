import { Future } from "./future.ts";

/**
 * Runs multiple Futures within a defined scope, ensuring that all Futures are executed
 * with full control over their execution (e.g., pausing, resuming, and pulling/pushing values).
 *
 * This method supports `Iterable` and `AsyncIterable` containers of Futures, allowing for
 * both push-based and pull-based workflows.
 *
 * `Future.scope` is designed to handle non-concurrent execution by default, allowing you to
 * control the flow of each future one at a time. If concurrency is needed, you can use
 * `Future.all`, `Future.some`, or similar methods inside the scope.
 *
 * ### Push vs. Pull Workflows:
 *
 * - **Push-Based Workflow**: The generator yields values autonomously, and the consumer simply awaits those values.
 * - **Pull-Based Workflow**: The generator waits for external input before proceeding to the next value.
 *
 * @param futures - An iterable or async iterable of Futures to be run within the scope.
 * @returns A Future that yields the results of the contained Futures, controlled by the scope.
 *
 * ### Example Usage:
 *
 * ```typescript
 * const scopeFuture = Future.scope([
 *   Future.from(async function* () {
 *     yield 42;
 *     return 100;
 *   }),
 *   Future.from(async function* () {
 *     yield 10;
 *     return 20;
 *   })
 * ]);
 *
 * for await (const result of scopeFuture) {
 *   console.log(result); // Logs 100, 20
 * }
 *
 * const pullFuture = Future.scope([
 *   Future.from(async function* () {
 *     let result = { value: 42, done: false };
 *
 *     while (!result.done) {
 *       result = await (yield result.value); // Wait for input from the consumer
 *     }
 *
 *     return result.value;
 *   })
 * ]);
 *
 * const iterator = pullFuture[Symbol.asyncIterator]();
 * console.log(await iterator.next());  // { value: 42, done: false }
 * console.log(await iterator.next({ value: 100, done: true })); // { value: 100, done: true }
 * ```
 */
export function scope<T, TReturn, TNext>(
  futures: Iterable<Future<T, TReturn, TNext>>,
): Future<T, TReturn, TNext> {
  // Iterate over the iterable/async iterable futures in a controlled manner
  return new Future<T, TReturn, TNext>(async function* () {
    // Check if the input is iterable
    const iterator = futures?.[Symbol.iterator]?.();

    // If no valid iterator was found, throw an error indicating that the input is not iterable or an iterator
    if (
      (iterator ?? null) === null ||
      typeof (iterator as Iterator<Future<T, TReturn, TNext>>)?.next ===
        "function"
    ) {
      throw new TypeError(
        "The provided input is not an iterable nor an iterator.",
      );
    }

    // Handle the async generator or generator in a pull-based workflow
    let result: IteratorResult<Future<T, TReturn, TNext>>;

    // Start the iteration
    while (!(result = iterator.next()).done) {
      yield yield* result.value;
    }

    return yield* result.value;
  });
}
