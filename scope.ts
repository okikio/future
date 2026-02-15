import { useDisposableStack } from "./disposal.ts";
import { Future } from "./future.ts";

/**
 * Executes generator-based Futures sequentially within a controlled scope.
 * 
 * Unlike the concurrent functions (`all`, `race`), scope runs futures one at a time, in order.
 * The async generator foundation is crucial: each future's generator runs to completion before
 * the next starts, and all yields from each generator appear in the output stream.
 * 
 * This provides structured concurrency - all futures in the scope share lifecycle and can be
 * cancelled together via the returned Future's `.cancel()` method, which propagates to all
 * active generators.
 * 
 * @param futures - Generator-based Futures to execute sequentially
 * @returns Future that yields all intermediate values, returns array of final results
 * 
 * @example Sequential execution (Promise-like usage)
 * ```typescript
 * const results = await scope([
 *   from(fetch('/api/step1')),
 *   from(fetch('/api/step2')),
 *   from(fetch('/api/step3'))
 * ]).toPromise();
 * // Executes step1, then step2, then step3
 * ```
 * 
 * @example Generator capabilities - see all yields
 * ```typescript
 * const scoped = scope([
 *   from(async function* () {
 *     yield "Task 1 starting";
 *     await delay(100);
 *     return "Task 1 done";
 *   }),
 *   from(async function* () {
 *     yield "Task 2 starting";
 *     await delay(100);
 *     return "Task 2 done";
 *   })
 * ]);
 * 
 * // See each generator's yields in sequence
 * for await (const status of scoped) {
 *   console.log(status);
 *   // "Task 1 starting", "Task 1 done",
 *   // "Task 2 starting", "Task 2 done"
 * }
 * ```
 * 
 * @example Structured concurrency - cancel all
 * ```typescript
 * const scoped = scope([future1, future2, future3]);
 * 
 * // Cancel propagates to active generator
 * setTimeout(() => scoped.cancel(), 1000);
 * ```
 */
export function scope<T, TReturn, TNext>(
  futures: Iterable<Future<T, TReturn, TNext>>,
): Future<T, (T | TReturn)[], TNext> {
  // Iterate over the iterable/async iterable futures in a controlled manner
  return new Future<T, (T | TReturn)[], TNext>(async function* (_, stack) {
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
    const finalResults: (T | TReturn)[] = []

    // Start the iteration
    while (!(result = iterator.next()).done) {
      finalResults.push(yield* useDisposableStack(result.value, stack));
    }

    return finalResults;
  });
}
