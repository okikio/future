/**
 * An interface representing a `ReadableStream` with added disposal capabilities.
 * This interface extends the `ReadableStream` and includes methods for both
 * synchronous and asynchronous disposal of the stream.
 *
 * @template T - The type of data in the `ReadableStream`.
 */
export interface ReadableStreamWithDisposal<T> extends ReadableStream<T>, AsyncDisposable, Disposable {
  /**
   * Synchronously disposes of the `ReadableStream`, canceling it and releasing resources.
   */
  [Symbol.dispose](reason?: unknown): void;

  /**
   * Asynchronously disposes of the `ReadableStream`, canceling it and releasing resources.
   * @returns A promise that resolves when the disposal is complete.
   */
  [Symbol.asyncDispose](reason?: unknown): Promise<void>;
}

/**
 * A WeakMap that stores the `ReadableStreamDefaultReader` for a given `ReadableStream`.
 * 
 * This map is used to track readers associated with specific streams, ensuring that each
 * stream's reader can be managed and disposed of properly.
 */
export const ReadableStreamReaderMap = new WeakMap<ReadableStream<unknown>, ReadableStreamReader<unknown>>();

/**
 * A Set that stores `ReadableStream` objects.
 * 
 * This set is used to track streams that are currently active, allowing for management of
 * their lifecycle and ensuring that resources are cleaned up appropriately when streams are
 * disposed of.
 */
export const ReadableStreamReaderSet = new Set<ReadableStream<unknown>>();

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
export function withDisposal<T>(stream: ReadableStream<T>): ReadableStreamWithDisposal<T> {
  const { getReader, cancel } = stream;
  
  return Object.assign(stream, {
    /**
     * Overrides the default `getReader` method to track and manage the reader.
     * Ensures that the reader is properly associated with the stream and can be disposed of.
     *
     * @param args - Arguments passed to the original `getReader` method.
     * @returns The `ReadableStreamDefaultReader` associated with the stream.
     */
    getReader(this: ReadableStream<T>, ...args: Parameters<ReadableStream<T>["getReader"]>) {
      const reader = ReadableStreamReaderMap.get(this) ?? getReader.apply(this, args);

      if (!ReadableStreamReaderMap.has(this)) {
        const { releaseLock } = reader;

        ReadableStreamReaderMap.set(this,
          Object.assign(reader, {
            /**
             * Overrides the default `releaseLock` method to remove the reader from the map
             * when it is no longer needed.
             *
             * @param args - Arguments passed to the original `releaseLock` method.
             * @returns The result of the original `releaseLock` method.
             */
            releaseLock(...args: Parameters<ReadableStreamReader<T>["releaseLock"]>) {
              ReadableStreamReaderMap.delete(stream);
              return releaseLock.apply(reader, args);
            },
          })
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
    }
  });
}
