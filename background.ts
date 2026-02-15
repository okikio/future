import { Future } from "./future.ts";
import { cancelIdle, idle } from "./_idle.ts";

/**
 * Executes a generator-based Future during browser idle time using `requestIdleCallback`.
 * 
 * The async generator foundation enables fine-grained control: the generator runs in chunks
 * during idle periods, yielding control back to the browser between iterations. Each generator
 * yield triggers a new idle callback, ensuring the main thread stays responsive.
 * 
 * This is particularly valuable for long-running generators that would otherwise block the UI.
 * The generator can still be cancelled, paused, or consumed normally - idle execution is just
 * the scheduling mechanism.
 * 
 * @param future - Generator-based Future to execute during idle time
 * @returns Future that runs its generator during browser idle periods
 * 
 * @example Background processing (Promise-like usage)
 * ```typescript
 * const future = from(async function* () {
 *   // Heavy computation
 *   return processLargeDataset();
 * });
 * 
 * // Runs during idle time, doesn't block UI
 * const result = await inBackground(future).toPromise();
 * ```
 * 
 * @example Generator capabilities - idle execution with yields
 * ```typescript
 * const future = from(async function* () {
 *   for (let i = 0; i < 1000; i++) {
 *     yield `Processing item ${i}`;  // Each yield waits for idle
 *     await processItem(i);
 *   }
 *   return "Complete";
 * });
 * 
 * const bg = inBackground(future);
 * 
 * // Generator runs in chunks during idle time
 * for await (const status of bg) {
 *   updateUI(status);  // UI stays responsive
 * }
 * ```
 * 
 * @example Cancellable background work
 * ```typescript
 * const bg = inBackground(
 *   from(async function* (abort) {
 *     for (let i = 0; i < 10000; i++) {
 *       abort.signal.throwIfAborted();  // Still cancellable
 *       yield i;
 *     }
 *   })
 * );
 * 
 * // Cancel even though running in background
 * setTimeout(() => bg.cancel(), 1000);
 * ```
 */
export function inBackground<T, TReturn, TNext>(
  future: Future<T, TReturn, TNext>,
): Future<T, T | TReturn, TNext> {
  // Iterate over the iterable/async iterable futures in a controlled manner
  return new Future<T, T | TReturn, TNext>(async function* (_, stack) {
    const _future = future; // stack.use(future);

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
