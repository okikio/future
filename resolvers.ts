import type { Future } from "./future.ts";
import { fromPromise } from "./from.ts";

/**
 * Creates a Future with manual control, like `Promise.withResolvers()`.
 * 
 * Returns a generator-based Future along with `resolve` and `reject` functions for external control.
 * The Future is built on a Promise-backed generator, giving you Promise-like manual control but
 * with Future capabilities (cancellation, composition with other Futures, etc.).
 * 
 * Useful for bridging callback-based APIs or event-driven code into the Future ecosystem.
 * 
 * @returns Object with `future`, `resolve`, and `reject` functions
 * 
 * @example Manual control (Promise-like)
 * ```typescript
 * const { future, resolve, reject } = withResolvers<number>();
 * 
 * // Resolve externally
 * setTimeout(() => resolve(42), 1000);
 * 
 * const result = await future;  // 42
 * ```
 * 
 * @example Bridge callback API to Future
 * ```typescript
 * function readFileAsFuture(path: string) {
 *   const { future, resolve, reject } = withResolvers<string>();
 *   
 *   fs.readFile(path, 'utf8', (err, data) => {
 *     if (err) reject(err);
 *     else resolve(data);
 *   });
 *   
 *   return future;  // Works like any Future - cancellable, composable
 * }
 * 
 * const content = await readFileAsFuture('data.txt').toPromise();
 * ```
 * 
 * @example Generator benefits - can still cancel
 * ```typescript
 * const { future, resolve } = withResolvers<number>();
 * 
 * setTimeout(() => resolve(42), 5000);
 * 
 * // Cancel before resolution (generator.return())
 * setTimeout(() => future.cancel(), 1000);
 * ```
 */
export function withResolvers<TReturn>(): FutureWithResolvers<TReturn> {
  const { promise, resolve, reject } = Promise.withResolvers<TReturn>();
  const future = fromPromise(promise);

  return {
    future,
    resolve,
    reject,
  };
}

export interface FutureWithResolvers<TReturn>
  extends Omit<PromiseWithResolvers<TReturn>, "promise"> {
  future: Future<TReturn, TReturn, undefined>;
  resolve: (value: TReturn | PromiseLike<TReturn>) => void;
  reject: (reason?: unknown) => void;
}
