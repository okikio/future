import type { Future } from "./future.ts";

import { splitIter, splitIterBy } from "./iter.ts";
import { from } from "./from.ts";

/**
 * Splits a Future into two futures: one for resolved values and one for errors.
 *
 * @param future The original future to be split.
 * @returns An array of two futures: one for resolved values and one for errors.
 *
 * @example
 * ```ts
 * const future = Future.from(async function* () {
 *   yield 1;
 *   yield 2;
 *   throw new Error("An error occurred");
 * });
 *
 * const [resolvedFuture, errorFuture] = Future.split(future);
 *
 * resolvedFuture.then(console.log); // Logs 1, 2
 * errorFuture.catch(console.error); // Logs Error: An error occurred
 * ```
 */
export function split<V, E, TReturn = unknown>(
  future: Future<V, TReturn>,
): readonly [Future<V, TReturn>, Future<E, undefined>] {
  const [resolvedIterator, erroredIterator] = splitIter<V, E, TReturn>(future);
  return [
    from<V, TReturn>(resolvedIterator),
    from<E, undefined>(erroredIterator),
  ] as const;
}

/**
 * Splits a Future into two futures based on a predicate.
 *
 * @param future The original future to be split.
 * @param predicate The function that determines which values go to the first future.
 * @returns An array of two futures: one for values that satisfy the predicate and one for values that do not.
 *
 * @example
 * ```ts
 * const future = Future.from(async function* () {
 *   yield 1;
 *   yield 2;
 *   yield 3;
 *   yield 4;
 * });
 *
 * const isEven = (value: number) => value % 2 === 0;
 *
 * const [evenFuture, oddFuture] = Future.splitBy(future, isEven);
 *
 * evenFuture.then(console.log); // Logs 2, 4
 * oddFuture.then(console.log);  // Logs 1, 3
 * ```
 */
export function splitBy<T, F, VReturn = unknown>(
  future: Future<T | F, VReturn>,
  predicate: (value: T | F) => boolean | PromiseLike<boolean>,
): readonly [Future<T, VReturn | undefined>, Future<F, VReturn | undefined>] {
  const [matchedIterator, nonMatchedIterator] = splitIterBy<T, F, VReturn>(
    future,
    predicate,
  );
  return [
    from<T, VReturn | undefined>(matchedIterator),
    from<F, VReturn | undefined>(nonMatchedIterator),
  ] as const;
}
