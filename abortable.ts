import { Future } from "./future.ts";
import { Status } from "./status.ts";

/**
 * Links a future to an external `AbortSignal` or `AbortController`, allowing the future to be canceled
 * when the signal is aborted. If an `AbortController` is provided, it will be used to manage the future's
 * cancellation; otherwise, the provided `AbortSignal` will be used.
 *
 * ### Key Points:
 * - If the provided signal is an `AbortController`, the future will use its `signal` property to listen for abortion.
 * - If the provided signal is an `AbortSignal`, it will be directly linked to the future.
 * - The future will be canceled immediately if the signal is already aborted when `withAbortable` is called.
 * - The event listener is automatically cleaned up once the future completes or is canceled.
 *
 * @param future - The future to link to the abort signal.
 * @param abort - An `AbortController` or `AbortSignal` to listen for cancellation.
 * @returns A future that will be canceled if the `AbortSignal` is aborted.
 *
 * @example
 * ```typescript
 * // Using an AbortController to control the future
 * const controller = new AbortController();
 * const future = Future.from(async function* () {
 *   yield 42;
 *   return 100;
 * });
 *
 * const abortableFuture = withAbortable(future, controller);
 * setTimeout(() => controller.abort(), 1000); // Cancel the future after 1 second
 *
 * try {
 *   const result = await abortableFuture.toPromise();
 *   console.log(result);
 * } catch (error) {
 *   console.log("Future was aborted:", error);
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Using an existing AbortSignal
 * const controller = new AbortController();
 * const future = Future.from(async function* () {
 *   yield 42;
 *   return 100;
 * });
 *
 * const abortableFuture = withAbortable(future, controller.signal);
 * setTimeout(() => controller.abort(), 1000); // Cancel the future after 1 second
 *
 * try {
 *   const result = await abortableFuture.toPromise();
 *   console.log(result);
 * } catch (error) {
 *   console.log("Future was aborted:", error);
 * }
 * ```
 */
export function withAbortable<T, TReturn, TNext>(
  future: Future<T, TReturn, TNext>,
  abort: AbortController | AbortSignal,
): Future<T | TReturn, T | TReturn, TNext> {
  let abortController: AbortController | null = abort instanceof AbortController
    ? abort
    : null;
  let abortSignal: AbortSignal | null = abort instanceof AbortController
    ? abort.signal
    : abort;

  return new Future<T | TReturn, T | TReturn, TNext>(async function* (_, stack) {
    const _future = stack.use(future);
    const abortHandler: EventListenerOrEventListenerObject = {
      handleEvent() {
        _future?.cancel?.(abortSignal?.reason);
      },
    };

    try {
      // If the signal is already aborted, cancel the future immediately
      if (abortSignal?.aborted && !_future?.is(Status.Cancelled)) {
        _future?.cancel(abortSignal?.reason);
      } else {
        // Otherwise, attach the abort listener
        abortSignal?.addEventListener?.("abort", abortHandler, { once: true });
      }

      return yield* _future;
    } finally {
      // Clean up the event listener
      abortSignal?.removeEventListener?.("abort", abortHandler);
      abortSignal = null;
      abortController = null;
    }
  }, abortController);
}
