import { Future } from "./future.ts";
import { cancelIdle, idle } from "./idle.ts";

/**
 * Sets up a `Future` to execute in the background during idle time.
 *
 * This method does not execute the future itself, but prepares it to be run using
 * `requestIdleCallback`. Execution is still controlled by methods like `toPromise()` or `async` iterators.
 *
 * @param future The future to be executed in the background.
 * @returns A new `Future` instance set up for background execution.
 * @example
 * ```typescript
 * const future = Future.from(async function* () {
 *   yield 42;
 *   return 100;
 * });
 * const backgroundFuture = Future.inBackground(future); // result is 100, processed in the background
 * ```
 */
export function inBackground<T, TReturn, TNext>(
  future: Future<T, TReturn, TNext>,
): Future<T, T | TReturn, TNext> {
  // Iterate over the iterable/async iterable futures in a controlled manner
  return new Future<T, T | TReturn, TNext>(async function* (_, stack) {
    const _future = stack.use(future);

    // If no valid iterator was found, throw an error indicating that the input is not iterable or an iterator
    if (
      (_future ?? null) === null ||
      typeof _future?.next !== "function"
    ) throw new TypeError("The provided input is not a future.");

    let idleResolver: PromiseWithResolvers<void> | null = Promise.withResolvers<void>();
    let idleId = idle(() => idleResolver?.resolve?.());

    try {
      // Handle the async generator or generator in a pull-based workflow
      let result: IteratorResult<T, T | TReturn> | null = null;

      // Start the iteration
      do {
        await idleResolver.promise;
        cancelIdle(idleId);

        // Handle the async generator or generator in a pull-based workflow
        result = result ? 
          await _future?.next?.(yield result?.value) : 
          await _future?.next?.();

        idleResolver = Promise.withResolvers<void>();
        idleId = idle(() => idleResolver?.resolve?.());
      } while (!result?.done);

      return result?.value;
    } finally {
      idleResolver = null;
      cancelIdle(idleId);
    }
  });
}
