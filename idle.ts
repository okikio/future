/// <reference lib="dom" />
/**
 * The timeout to use when `requestIdleCallback` is not available.
 * The recommended upper limit is 50ms.
 *
 * @remarks
 * `requestIdleCallback` is used by the browser to run low-priority code when the main thread is idle.
 * When `requestIdleCallback` is unavailable (e.g., in Node.js or older browsers),
 * we fallback to `setTimeout`. The `IDLE_TIMEOUT` serves as a maximum time limit when using the fallback,
 * and it is set to 50ms, which is the recommended upper limit.
 *
 * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/Background_Tasks_API#getting_the_most_out_of_idle_callbacks)
 */
export const IDLE_TIMEOUT = 50;

/**
 * Schedules a function to be called during idle time or after a specified timeout.
 *
 * @param callback - The function to be executed during idle time.
 * It receives an `IdleDeadline` object, which contains a `didTimeout` property
 * and a `timeRemaining()` method that indicates how much time is remaining.
 * @param options - Optional configuration for idle callback. If no options are provided,
 * a default timeout is used. The default timeout is 50ms.
 *
 * @returns A handle to the idle callback or timeout. This can be used to cancel the operation.
 *
 * @remarks
 * This function will use `requestIdleCallback` if it is available in the runtime.
 * If it is not available (such as in Node.js or older browsers), the function will fallback to `setTimeout`.
 *
 * ### Example: Using idle callback in the browser
 * ```ts
 * const handle = idle(deadline => {
 *   while (deadline.timeRemaining() > 0 && tasks.length > 0) {
 *     performTask(tasks.shift());
 *   }
 * });
 * ```
 *
 * ### Example: Fallback with timeout in Node.js
 * ```ts
 * const handle = idle(deadline => {
 *   performTask();
 * }, { timeout: 100 });
 * ```
 *
 * @remarks
 * In a non-browser environment like Node.js, `requestIdleCallback` is not available.
 * The function will fallback to using `setTimeout` to run the callback after the specified time.
 *
 * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestIdleCallback)
 */
export function idle(
  callback: IdleRequestCallback,
  options: IdleRequestOptions = {},
) {
  // Set default timeout if not provided
  const timeout = (options.timeout ??= IDLE_TIMEOUT);

  if (
    "requestIdleCallback" in globalThis &&
    "cancelIdleCallback" in globalThis
  ) {
    // Use requestIdleCallback if available
    return globalThis.requestIdleCallback(callback, options);
  } else {
    // Fallback to setTimeout if requestIdleCallback is not available
    const start = globalThis?.performance?.now?.() ?? Date?.now?.();
    return globalThis?.setTimeout?.(() => {
      const end = globalThis?.performance?.now?.() ?? Date?.now?.();
      const delta = end - start;

      /**
       * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/IdleDeadline/timeRemaining#return_value)
       */
      const deadline: IdleDeadline = {
        didTimeout: delta >= timeout,
        timeRemaining() {
          return Math.max(0, timeout - delta);
        },
      };

      callback(deadline);
    }, timeout);
  }
}

/**
 * Cancels an idle callback or timeout.
 *
 * @param handle - The handle returned from the `idle` function. This handle is used to cancel
 * the idle callback or timeout.
 *
 * @remarks
 * This function will cancel the idle callback if `requestIdleCallback` is available.
 * If it falls back to `setTimeout`, it will cancel the timeout instead.
 *
 * ### Example: Canceling an idle callback
 * ```ts
 * const handle = idle(deadline => {
 *   performTask();
 * });
 * cancelIdle(handle); // Cancel the idle callback or timeout
 * ```
 */
export function cancelIdle(handle: ReturnType<typeof idle>) {
  if (
    "requestIdleCallback" in globalThis &&
    "cancelIdleCallback" in globalThis
  ) {
    // Use cancelIdleCallback if available
    return globalThis.cancelIdleCallback(handle);
  } else {
    // Fallback to clearTimeout if requestIdleCallback is not available
    return globalThis.clearTimeout(handle);
  }
}
