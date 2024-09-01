import { Future } from "./future.ts";

/**
 * Sets a deadline for a future, canceling it if it takes longer than the specified time to complete.
 * If the future resolves before the deadline, the timeout is cleared.
 *
 * @param future - The future to set a deadline for.
 * @param ms - The time in milliseconds before the future is canceled.
 * @returns A future that will be canceled if it exceeds the specified time.
 * @example
 * ```typescript
 * const future = Future.from(async function* () {
 *   yield 42;
 *   return 100;
 * });
 *
 * const deadlineFuture = Future.withDeadline(future, 1000); // Sets a 1-second deadline
 * ```
 */
export function withDeadline<T, TReturn, TNext>(
  future: Future<T, TReturn, TNext>,
  ms: number,
): Future<T | TReturn, T | TReturn, TNext> {
  return new Future<T | TReturn, T | TReturn, TNext>(async function* () {
    const timeoutId = setTimeout(() => {
      future.cancel(new Error("Future timed out"));
      clearTimeout(timeoutId);
    }, ms);

    try {
      return yield* future;
    } finally {
      clearTimeout(timeoutId);
    }
  });
}

/**
 * Creates a `Future` that resolves after a specified delay.
 *
 * @param ms - The delay in milliseconds before the future resolves.
 * @param value - The value to resolve with after the delay. Defaults to `undefined`.
 * @returns A future that resolves after the specified delay.
 *
 * @example
 * ```typescript
 * const delayedFuture = delay(1000, "Hello, world!");
 * const result = await delayedFuture.toPromise(); // Resolves to "Hello, world!" after 1 second
 * ```
 */
export function delay<T = unknown>(ms: number, value?: T): Future<T, T> {
  return new Future<T, T>(async function* (abort) {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const { promise, resolve } = Promise.withResolvers<T>();

    try {
      timeoutId = setTimeout(resolve, ms, value);
      abort.signal.throwIfAborted();

      yield promise;
      return promise;
    } finally {
      // Ensure that the timeout is cleared if the future is canceled
      clearTimeout(timeoutId);
    }
  });
}
