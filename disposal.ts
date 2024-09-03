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
  ReadableStreamWithDisposal,
  PromiseWithDisposal,
  WithDisposal,
} from "./types.ts";
import { isAsyncDisposable, isAsyncIterable, isDisposable, isIterable } from "./utils.ts";

import { AsyncDisposableStack as _AsyncDisposableStackPolyfill } from "@nick/dispose/async-disposable-stack";
import { DisposableStack as _DisposableStackPollyfill } from "@nick/dispose/disposable-stack";

export const AsyncDisposableStack = "AsyncDisposableStack" in globalThis ?
  globalThis.AsyncDisposableStack :
  _AsyncDisposableStackPolyfill;
export const DisposableStack = "DisposableStack" in globalThis ?
  globalThis.DisposableStack :
  _DisposableStackPollyfill;

/**
 * A WeakMap that stores the `ReadableStreamDefaultReader` for a given `ReadableStream`.
 *
 * This map is used to track readers associated with specific streams, ensuring that each
 * stream's reader can be managed and disposed of properly.
 */
export const ReadableStreamReaderMap: WeakMap<
  ReadableStream<unknown>,
  ReadableStreamReader<unknown>
> = new WeakMap();

/**
 * A Set that stores `ReadableStream` objects.
 *
 * This set is used to track streams that are currently active, allowing for management of
 * their lifecycle and ensuring that resources are cleaned up appropriately when streams are
 * disposed of.
 */
export const ReadableStreamReaderSet: Set<ReadableStream<unknown>> = new Set();

/**
 * Wraps a `ReadableStream` and adds `Symbol.dispose` and `Symbol.asyncDispose` methods
 * for proper cleanup of resources.
 *
 * This function enhances the provided `ReadableStream` by adding disposal capabilities.
 * These capabilities allow for both synchronous and asynchronous cleanup of the stream,
 * ensuring that resources such as locks and readers are properly released when the stream
 * is no longer needed.
 *
 * ## Disposal Methods:
 * - `Symbol.dispose`: Synchronously cancels the stream and releases its resources.
 * - `Symbol.asyncDispose`: Asynchronously cancels the stream and releases its resources.
 *
 * ## Usage:
 * The `withDisposal` function is particularly useful in scenarios where you need to ensure
 * that a `ReadableStream` is properly cleaned up after use. By adding disposal methods, you
 * can integrate the stream into resource management patterns, such as using the `using`
 * keyword or manually invoking disposal methods.
 *
 * @template T - The type of data in the `ReadableStream`.
 * @param stream - The `ReadableStream` to wrap and enhance with disposal support.
 * @returns A new `ReadableStream` that includes methods for synchronous and asynchronous disposal.
 *
 * @example
 * ```typescript
 * const stream = new ReadableStream();
 * const disposableStream = withDisposal(stream);
 *
 * // Use the stream...
 *
 * // Dispose of the stream when done
 * disposableStream[Symbol.dispose]();
 * ```
 */
export function withDisposal<T>(
  stream: ReadableStream<T>,
): ReadableStreamWithDisposal<T> {
  const { getReader, cancel } = stream;

  return Object.assign(stream, {
    /**
     * Overrides the default `getReader` method to track and manage the reader.
     * Ensures that the reader is properly associated with the stream and can be disposed of.
     *
     * @param args - Arguments passed to the original `getReader` method.
     * @returns The `ReadableStreamDefaultReader` associated with the stream.
     */
    getReader(
      this: ReadableStream<T>,
      ...args: Parameters<ReadableStream<T>["getReader"]>
    ) {
      const reader = ReadableStreamReaderMap.get(this) ??
        getReader.apply(this, args);

      if (!ReadableStreamReaderMap.has(this)) {
        const { releaseLock } = reader;

        ReadableStreamReaderMap.set(
          this,
          Object.assign(reader, {
            /**
             * Overrides the default `releaseLock` method to remove the reader from the map
             * when it is no longer needed.
             *
             * @param args - Arguments passed to the original `releaseLock` method.
             * @returns The result of the original `releaseLock` method.
             */
            releaseLock(
              ...args: Parameters<ReadableStreamReader<T>["releaseLock"]>
            ) {
              ReadableStreamReaderMap.delete(stream);
              return releaseLock.apply(reader, args);
            },
          }),
        );
      }

      return reader;
    },

    /**
     * Overrides the default `cancel` method to ensure that the stream is properly removed
     * from the set and its resources are released.
     *
     * @param reason - The reason for canceling the stream.
     * @returns A promise that resolves when the stream has been canceled.
     */
    cancel(this: ReadableStream<T>, reason?: unknown) {
      ReadableStreamReaderSet.delete(this);
      return cancel.call(this, reason);
    },

    /**
     * Synchronous disposal of the `ReadableStream`.
     *
     * This method cancels the stream and releases resources immediately. If the stream is
     * locked, the lock is explicitly released before the stream is canceled.
     *
     * @param reason - The reason for disposing of the stream.
     */
    [Symbol.dispose](this: ReadableStream<T>, reason?: unknown) {
      if (this.locked) {
        this.getReader().releaseLock(); // Explicitly release the lock
      }

      this.cancel(reason);
    },

    /**
     * Asynchronous disposal of the `ReadableStream`.
     *
     * This method cancels the stream and releases resources asynchronously. If the stream is
     * locked, the lock is explicitly released before the stream is canceled.
     *
     * @param reason - The reason for disposing of the stream.
     * @returns A promise that resolves when the disposal is complete.
     */
    async [Symbol.asyncDispose](this: ReadableStream<T>, reason?: unknown) {
      if (this.locked) {
        this.getReader().releaseLock(); // Explicitly release the lock
      }

      await this.cancel(reason);
    },
  });
}

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
 * Creates a promise that rejects after a specified timeout and supports disposal.
 *
 * @remarks
 * This function is useful for enforcing time limits on asynchronous operations. If the operation takes longer than the specified timeout, the promise will be rejected. It also supports an optional abort signal to allow for early cancellation.
 *
 * @param ms - The number of milliseconds to wait before rejecting the promise.
 * @param abort - An optional `AbortController` or `AbortSignal` to allow for early cancellation of the timeout.
 * @returns A `PromiseWithDisposable` that rejects after the specified timeout or when aborted.
 *
 * @example
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
 * @example Using with AbortSignal
 * ```typescript
 * const controller = new AbortController();
 * const timeoutPromise = timeout(5000, controller.signal);
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
  abort?: AbortController | AbortSignal,
): PromiseWithDisposal<void> {
  // Create a promise with external resolve and reject capabilities
  const { promise, reject } = Promise.withResolvers<void>();

  // Set a timeout to reject the promise after the specified time
  const timeoutId = setTimeout(reject, ms);

  // Create an abortable promise if an abort signal is provided
  const abortPromise = abort ? abortable(abort) : null;

  // Return a race between the timeout and the abortable promise (if provided)
  return Object.assign(
    Promise.race([
      promise,
      abortPromise,
    ]),
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