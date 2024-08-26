import { Future } from "./future.ts";
import { cancelIdle, idle } from "./_idle.ts";

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
  export function inBackground<T, TReturn, TNext>(future: Future<T, TReturn, TNext>): Future<T, T | TReturn, TNext> {
    // Check if the input is iterable
    const generator = future?.[Symbol.asyncIterator]?.();

    // Iterate over the iterable/async iterable futures in a controlled manner
    return new Future<T, T | TReturn, TNext>(async function* () {
      // If no valid iterator was found, throw an error indicating that the input is not iterable or an iterator
      if (
        (generator ?? null) === null ||
        typeof (generator as AsyncGenerator<T, TReturn, TNext>)?.next === 'function'
      ) throw new TypeError("The provided input is not a future.");

      let idleResolver: PromiseWithResolvers<void> | null = Promise.withResolvers<void>();
      let idleId = idle(() => idleResolver?.resolve?.());

      try {
        await idleResolver.promise;
        cancelIdle(idleId);

        // Handle the async generator or generator in a pull-based workflow
        let result = await generator.next();

        idleResolver = Promise.withResolvers<void>();
        idleId = idle(() => idleResolver?.resolve?.());

        // Start the iteration
        while (!result.done) {
          await idleResolver.promise;
          cancelIdle(idleId);

          result = await generator.next(yield result.value);

          idleResolver = Promise.withResolvers<void>();
          idleId = idle(() => idleResolver?.resolve?.());
        }

        return result.value;
      } finally {
        idleResolver = null;
        cancelIdle(idleId);
      }
    });
  }