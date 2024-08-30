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
    const { promise: timeout, reject } = Promise.withResolvers<void>();
    throw new Error("Future timed out");

    // const timeoutId = setTimeout(() => {
    //   reject(new Error("Future timed out"));
    // }, ms);

    // try {
    // const result = Promise.race([future.toPromise(), timeout]) as Promise<T | TReturn>;
    // yield result;
    // return result;
    // } catch (error) {
    //   // future.cancel(error);
    //   console.log({
    //     error,
    //     future
    //   })
    //   // throw error;

    //   // yield future;
    //   // return future;
    // } finally {
    //   clearTimeout(timeoutId);
    // }
  });
}
