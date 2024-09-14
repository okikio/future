/**
 * This module provides utility functions and types for working with asynchronous operations in a more controlled and manageable way.
 * Specifically, it includes functions for creating abortable promises, promises with timeouts, and promises that support proper disposal using both synchronous and asynchronous disposal protocols.
 *
 * These utilities are useful in scenarios where you need to manage the lifecycle of asynchronous tasks, handle cancellations, or enforce time limits on operations.
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortController AbortController Documentation}
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise Promise Documentation}
 *
 * @module
 */

import type {
  AbortablePromiseWithDisposal,
  PromiseWithDisposal,
  WithDisposal,
} from "./types.ts";
import { isAsyncDisposable, isAsyncIterable, isDisposable, isIterable } from "./_utils.ts";

import { AsyncDisposableStack as _AsyncDisposableStackPolyfill } from "@nick/dispose/async-disposable-stack";
import { DisposableStack as _DisposableStackPollyfill } from "@nick/dispose/disposable-stack";

export const AsyncDisposableStack = "AsyncDisposableStack" in globalThis
  ? globalThis.AsyncDisposableStack
  : _AsyncDisposableStackPolyfill;

export const DisposableStack = "DisposableStack" in globalThis
  ? globalThis.DisposableStack
  : _DisposableStackPollyfill;

export * from "./_enhanced_readable_stream.ts";

/**
 * Handles a single value that might be disposable or async-disposable.
 * @param value - A single value that may or may not be disposable.
 * @param stack - The stack used to manage disposal.
 * @returns The same value wrapped with disposal management if applicable.
 */
export function useDisposableStack<T>(value: T, stack: DisposableStack | AsyncDisposableStack): T | WithDisposal<T>;

/**
 * Handles a synchronous iterable of values that might be disposable or async-disposable.
 * @param iterable - A synchronous iterable of values that may or may not be disposable.
 * @param stack - The stack used to manage disposal.
 * @returns A synchronous iterable where each value is wrapped with disposal management if applicable.
 */
export function useDisposableStack<T>(iterable: Iterable<T>, stack: DisposableStack | AsyncDisposableStack): Iterable<T | WithDisposal<T>>;

/**
 * Handles an asynchronous iterable of values that might be disposable or async-disposable.
 * @param iterable - An asynchronous iterable of values that may or may not be disposable.
 * @param stack - The stack used to manage disposal.
 * @returns A Promise resolving to an asynchronous iterable where each value is wrapped with disposal management if applicable.
 */
export function useDisposableStack<T>(iterable: AsyncIterable<T>, stack: DisposableStack | AsyncDisposableStack): Promise<Iterable<T | WithDisposal<T>>>;

/**
 * `useDisposableStack` is a utility function designed to integrate a singular value or an iterable collection
 * of resources with a `DisposableStack` or `AsyncDisposableStack`. This function is particularly useful
 * for managing resources that require explicit disposal, allowing for both synchronous and asynchronous
 * cleanup operations.
 * 
 * The function handles various input types, including single values, synchronous iterables, and asynchronous
 * iterables. It ensures that resources implementing `Disposable`, `AsyncDisposable`, or `DualDisposable` are
 * properly managed and disposed of by the provided stack.
 * 
 * By utilizing `useDisposableStack`, you can avoid resource leaks and maintain fine-grained control over
 * resource management, especially in contexts where disposal needs to be a separate and explicit action.
 * This is particularly important when using the `DisposableStack` in a wrapper function, where you'd want
 * all resources to be disposed of explicitly at the appropriate time.
 *
 * @example
 * ```typescript
 * // Using with a synchronous iterable
 * const stack = new DisposableStack();
 * const resources = [new Resource1(), new Resource2()];
 * 
 * for (const resource of useDisposableStack(resources, stack)) {
 *   // Use resource
 *   // The resource will be automatically managed by the stack and disposed of when appropriate.
 * }
 * 
 * // Using with an asynchronous iterable
 * const asyncStack = new AsyncDisposableStack();
 * const asyncResources = [new AsyncResource1(), new AsyncResource2()];
 * 
 * for await (const asyncResource of useDisposableStack(asyncResources, asyncStack)) {
 *   // Use asyncResource
 *   // The asyncResource will be automatically managed by the async stack and disposed of when appropriate.
 * }
 *
 * // Using with a single disposable value
 * const singleResource = new Resource1();
 * const managedResource = useDisposableStack(singleResource, stack);
 * // managedResource is now managed by the stack.
 * ```
 *
 * @template T - The type of the value or items in the iterable.
 * @param value - A single value, or an iterable collection of resources that may or may not be disposables.
 * @param stack - A stack that manages the disposal of resources.
 * @returns Returns the value or iterable, with resources wrapped in disposal management if applicable.
 */
export function useDisposableStack<T>(
  value: T | AsyncIterable<T> | Iterable<T>,
  stack: DisposableStack | AsyncDisposableStack
): T | WithDisposal<T> | Iterable<T | WithDisposal<T>> | Promise<Iterable<T | WithDisposal<T>>> {
  const isDisposableStack = stack instanceof DisposableStack;
  const isAsyncDisposableStack = stack instanceof AsyncDisposableStack;

  // Handle single synchronous disposable value
  if (isDisposableStack && isDisposable(value)) {
    return stack.use(value as T & Disposable);
  }

  // Handle single asynchronous disposable value
  if (isAsyncDisposableStack && isAsyncDisposable(value)) {
    return stack.use(value as T & AsyncDisposable);
  }

  // Handle asynchronous iterables
  if (isAsyncIterable(value)) {
    /**
     * @todo Use Iterator helper function to handle mapping over async-iterables if this is ever standardized available
     */
    return Array.fromAsync(value, (result) => {
      if (isDisposableStack && isDisposable(result)) {
        return stack.use(result as T & Disposable);
      }

      if (isAsyncDisposableStack && isAsyncDisposable(result)) {
        return stack.use(result as T & AsyncDisposable);
      }

      return result;
    });
  }
  
  // Handle synchronous iterables
  if (isIterable(value)) {
    /**
     * @todo Use Iterator helper function to handle mapping over iterables 
     * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Iterator#iterator_helpers)
     */
    return Array.from(value).map((result) => {
      if (isDisposableStack && isDisposable(result)) {
        return stack.use(result as T & Disposable);
      }

      if (isAsyncDisposableStack && isAsyncDisposable(result)) {
        return stack.use(result as T & AsyncDisposable);
      }

      return result;
    });
  }

  // Return the value as-is if it doesn't require disposal management
  return value;
}


/**
 * Creates a promise that can be aborted using an `AbortController` or `AbortSignal`.
 *
 * @remarks
 * This function is particularly useful in scenarios where you need to create an abortable operation,
 * such as a network request or a long-running task. The promise will reject with the reason provided by the abort signal if the operation is aborted.
 *
 * @param abort - An `AbortController` or `AbortSignal` to control the abortion of the promise. If not provided, a new `AbortController` is created.
 * @returns An `AbortablePromiseWithDisposable` that can be aborted and properly disposed of.
 *
 * @example
 * ```typescript
 * const controller = new AbortController();
 * const abortablePromise = abortable(controller);
 *
 * // Simulate aborting the operation
 * setTimeout(() => controller.abort(), 1000);
 *
 * try {
 *   await abortablePromise;
 * } catch (error) {
 *   console.error("Operation aborted:", error);
 * }
 *
 * // Clean up resources
 * abortablePromise[Symbol.dispose]();
 * ```
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortController AbortController Documentation}
 */
export function abortable(
  abort: AbortController | AbortSignal,
): AbortablePromiseWithDisposal<void> {
  // Create a promise with external resolve and reject capabilities
  const { promise, reject } = Promise.withResolvers<void>();
  let abortController: AbortController | null = abort instanceof AbortController
    ? abort
    : null;
  let abortSignal: AbortSignal | null = abort instanceof AbortController
    ? abort.signal
    : abort;

  // Define an abort handler that will reject the promise if the abort signal is triggered
  const abortHandler: EventListenerOrEventListenerObject = {
    handleEvent() {
      reject(abortSignal?.reason);
    },
  };

  // If the signal is already aborted, reject the promise immediately
  if (abortSignal?.aborted) {
    reject(abortSignal?.reason);
  } else {
    // Otherwise, attach the abort listener
    abortSignal?.addEventListener?.("abort", abortHandler, { once: true });
  }

  // Return the promise with additional abort-related properties and disposal methods
  return Object.assign(promise, {
    get signal() {
      return abortSignal;
    },
    get controller() {
      return abortController;
    },
    [Symbol.dispose]() {
      // Clean up the event listener and references
      abortSignal?.removeEventListener?.("abort", abortHandler);
      abortSignal = null;
      abortController = null;
    },
    async [Symbol.asyncDispose]() {
      // Clean up the event listener and references asynchronously
      await Promise.resolve(
        abortSignal?.removeEventListener?.("abort", abortHandler),
      );
      abortSignal = null;
      abortController = null;
    },
  });
}
/**
 * Options for configuring the timeout behavior.
 *
 * @param reject - Whether the promise should reject (true) or resolve (false) after the timeout. Default is `true` (reject).
 * @param abort - An optional `AbortController` or `AbortSignal` to allow for early cancellation of the timeout.
 */
export interface TimeoutOptions {
  /**
   * @default true
   */
  reject?: boolean;
  abort?: AbortController | AbortSignal;
}

/**
 * Creates a promise that either rejects or resolves after a specified timeout and supports disposal and aborting.
 *
 * @remarks
 * This function is useful for enforcing time limits on asynchronous operations. If the operation takes longer than the specified timeout, the promise will either resolve or reject based on the provided options. It also supports an optional abort signal to allow for early cancellation.
 *
 * @param ms - The number of milliseconds to wait before resolving/rejecting the promise.
 * @param options - An optional configuration object to control the behavior of the timeout (resolve or reject) and aborting logic.
 * @returns A `PromiseWithDisposal` that resolves or rejects after the specified timeout or when aborted.
 *
 * @example Reject on timeout (default)
 * ```typescript
 * const timeoutPromise = timeout(5000);
 *
 * try {
 *   await timeoutPromise;
 * } catch (error) {
 *   console.error("Operation timed out:", error);
 * }
 *
 * // Clean up resources
 * timeoutPromise[Symbol.dispose]();
 * ```
 *
 * @example Resolve on timeout
 * ```typescript
 * const timeoutPromise = timeout(5000, { resolveOnTimeout: true });
 *
 * try {
 *   await timeoutPromise;
 *   console.log("Operation resolved after timeout");
 * } catch (error) {
 *   console.error("Unexpected error:", error);
 * }
 *
 * // Clean up resources
 * timeoutPromise[Symbol.dispose]();
 * ```
 *
 * @example Using with AbortSignal
 * ```typescript
 * const controller = new AbortController();
 * const timeoutPromise = timeout(5000, { abort: controller.signal });
 *
 * // Abort the operation before the timeout
 * setTimeout(() => controller.abort(), 1000);
 *
 * try {
 *   await timeoutPromise;
 * } catch (error) {
 *   console.error("Operation aborted or timed out:", error);
 * }
 *
 * // Clean up resources
 * timeoutPromise[Symbol.dispose]();
 * ```
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortController AbortController Documentation}
 */
export function timeout(
  ms: number,
  options: TimeoutOptions = {}
): PromiseWithDisposal<void> {
  const { reject: rejectOnTimout = true, abort } = options;

  // Create a promise with external resolve and reject capabilities
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  // Set a timeout to resolve or reject the promise after the specified time
  const timeoutId = setTimeout(() => {
    if (rejectOnTimout) {
      reject(new Error('Timeout exceeded'));
    } else {
      resolve();
    }
  }, ms);

  // Create an abortable promise if an abort signal is provided
  const abortPromise = abort ? abortable(abort) : null;

  // Return a race between the timeout and the abortable promise (if provided)
  return Object.assign(
    abortPromise ? Promise.race([promise, abortPromise]) : promise,
    {
      [Symbol.dispose]() {
        // Clear the timeout to prevent memory leaks
        clearTimeout(timeoutId);
        abortPromise?.[Symbol.dispose]?.();
      },
      async [Symbol.asyncDispose]() {
        // Clear the timeout asynchronously
        await Promise.resolve(clearTimeout(timeoutId));
        await abortPromise?.[Symbol.asyncDispose]?.();
      },
    },
  ) as PromiseWithDisposal<void>;
}
