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
): AbortablePromiseWithDisposable<void> {
  // Create a promise with external resolve and reject capabilities
  const { promise, reject } = Promise.withResolvers<void>();
  let abortController: AbortController | null = abort instanceof AbortController ? abort : null;
  let abortSignal: AbortSignal | null = abort instanceof AbortController ? abort.signal : abort;

  // Define an abort handler that will reject the promise if the abort signal is triggered
  const abortHandler: EventListenerOrEventListenerObject = {
    handleEvent() { reject(abortSignal?.reason); },
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
    get signal() { return abortSignal; },
    get controller() { return abortController; },
    [Symbol.dispose]() {
      // Clean up the event listener and references
      abortSignal?.removeEventListener?.("abort", abortHandler);
      abortSignal = null;
      abortController = null;
    },
    async [Symbol.asyncDispose]() {
      // Clean up the event listener and references asynchronously
      await Promise.resolve(abortSignal?.removeEventListener?.("abort", abortHandler));
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
): PromiseWithDisposable<void> {
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
    }
  ) as PromiseWithDisposable<void>;
}



/**
 * `WithDisposable` interface combines the capabilities of both `Disposable` and `AsyncDisposable` interfaces.
 * 
 * This interface is used for objects that require explicit resource management, typically for cleaning up 
 * resources such as file handles, database connections, or any other resources that need to be disposed 
 * of when no longer in use.
 * 
 * @example
 * ```typescript
 * class MyResource implements WithDisposable {
 *   [Symbol.dispose]() {
 *     // Synchronous cleanup logic
 *   }
 * 
 *   async [Symbol.asyncDispose]() {
 *     // Asynchronous cleanup logic
 *   }
 * }
 * 
 * const resource = new MyResource();
 * 
 * // Ensure resource is disposed synchronously
 * using (resource) {
 *   // Work with resource
 * }
 * 
 * // Ensure resource is disposed asynchronously
 * await using (await resource) {
 *   // Work with resource asynchronously
 * }
 * ```
 * 
 * The `Symbol.dispose` method will be invoked automatically when the scope in which the `using` keyword is used 
 * is exited, ensuring that resources are properly released. Similarly, `Symbol.asyncDispose` will be called 
 * for asynchronous disposal.
 * 
 * @interface
 * @extends Disposable
 * @extends AsyncDisposable
 */
export interface WithDisposable extends Disposable, AsyncDisposable { }

/**
 * An interface representing a `ReadableStream` with added disposal capabilities.
 * This interface extends the `ReadableStream` and includes methods for both
 * synchronous and asynchronous disposal of the stream.
 *
 * @template T - The type of data in the `ReadableStream`.
 */
export interface ReadableStreamWithDisposal<T> extends ReadableStream<T>, WithDisposable {}

/**
 * A `PromiseWithDisposable` is an extension of the standard `Promise` interface, designed to include
 * the ability to clean up resources once the promise is no longer needed or has completed its operation.
 *
 * ## What is a Disposable?
 * 
 * A **disposable** is an object that implements the `Disposable` and/or `AsyncDisposable` interfaces,
 * providing a standard way to release or clean up resources, such as memory or file handles, when they
 * are no longer needed. This is particularly important in scenarios where failing to release resources
 * can lead to memory leaks or other performance issues.
 *
 * The `Disposable` interface typically includes a `dispose` method, which can be called to perform
 * synchronous cleanup. The `AsyncDisposable` interface includes an `asyncDispose` method, which is
 * used for asynchronous cleanup operations.
 *
 * When using a `PromiseWithDisposable`, you can be confident that any associated resources will be
 * properly cleaned up once the promise is settled (resolved or rejected) or when it's manually disposed of.
 * This makes it particularly useful in scenarios where promises represent operations tied to external
 * resources, such as file I/O, network requests, or UI components.
 *
 * @template T - The type of the value that the promise resolves to.
 *
 * @example
 * ```typescript
 * // Create a disposable promise
 * const disposablePromise: PromiseWithDisposable<string> = someAsyncOperation();
 * 
 * // Use the promise as you would any other promise
 * disposablePromise.then(result => console.log(result));
 * 
 * // When done, dispose of the promise to clean up resources
 * disposablePromise[Symbol.dispose]();
 * ```
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise Promise Documentation}
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol/dispose Symbol.dispose Documentation}
 */
export interface PromiseWithDisposable<T> extends Promise<T>, WithDisposable {}

/**
 * Extends `PromiseWithDisposable` with additional properties for handling abortable operations.
 * 
 * @template T - The type of the value that the promise resolves to.
 */
export interface AbortablePromiseWithDisposable<T> extends PromiseWithDisposable<T> {
  /**
   * The `AbortSignal` associated with this promise, which allows the promise to be aborted.
   */
  signal: AbortSignal | null;

  /**
   * The `AbortController` used to control the abort signal. If the signal was passed in, this will be `null`.
   */
  controller: AbortController | null;
}
