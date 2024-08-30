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
 * Wraps a ReadableStream and adds Symbol.dispose and Symbol.asyncDispose methods
 * for proper cleanup of resources.
 *
 * @template T - The type of data in the ReadableStream.
 * @param stream - The ReadableStream to wrap.
 * @returns A new ReadableStream with disposal support.
 */
export function withDisposal<T>(stream: ReadableStream<T>): ReadableStreamWithDisposal<T> {
  return Object.assign(stream, {
    /**
     * Synchronous disposal of the ReadableStream.
     * This cancels the stream and releases resources.
     */
    [Symbol.dispose](reason?: unknown) {
      stream.cancel(reason);
    },

    /**
     * Asynchronous disposal of the ReadableStream.
     * This cancels the stream and releases resources asynchronously.
     * @returns A promise that resolves when the disposal is complete.
     */
    async [Symbol.asyncDispose](reason?: unknown) {
      await stream.cancel(reason);
    }
  });
}
