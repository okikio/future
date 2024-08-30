/**
 * Converts a ReadableStream into an Async Iterator.
 *
 * This allows you to iterate over the chunks of data in the stream using `for await...of` syntax.
 *
 * @param stream The ReadableStream to convert.
 * @returns An Async Iterator that yields the chunks of data from the stream.
 *
 * @example
 * ```ts
 * const readableStream = new ReadableStream({
 *   start(controller) {
 *     controller.enqueue("chunk1");
 *     controller.enqueue("chunk2");
 *     controller.close();
 *   }
 * });
 *
 * const asyncIterator = streamToAsyncIterator(readableStream);
 *
 * for await (const chunk of asyncIterator) {
 *   console.log(chunk); // Logs: "chunk1", "chunk2"
 * }
 * ```
 */
export async function* streamToAsyncIterator<T>(stream: ReadableStream<T>): AsyncIterator<T> {
  const reader = stream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Converts an Async Iterator into a ReadableStream.
 *
 * This allows you to produce a stream of data from an async iterator.
 *
 * @param iterator The Async Iterator to convert.
 * @returns A ReadableStream that streams the data produced by the async iterator.
 *
 * @example
 * ```ts
 * async function* asyncGenerator() {
 *   yield "chunk1";
 *   yield "chunk2";
 * }
 *
 * const readableStream = asyncIteratorToStream(asyncGenerator());
 *
 * const reader = readableStream.getReader();
 * reader.read().then(({ value, done }) => {
 *   console.log(value); // Logs: "chunk1"
 * });
 * ```
 */
export function asyncIteratorToStream<T>(iterator: AsyncIterator<T>): ReadableStream<T> {
  return new ReadableStream<T>({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) {
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (err) {
        controller.error(err);
      }
    }
  });
}

/**
 * Converts a Synchronous Iterator into a ReadableStream.
 *
 * This allows you to produce a stream of data from a synchronous iterator.
 *
 * @param iterator The Synchronous Iterator to convert.
 * @returns A ReadableStream that streams the data produced by the iterator.
 *
 * @example
 * ```ts
 * function* syncGenerator() {
 *   yield "chunk1";
 *   yield "chunk2";
 * }
 *
 * const readableStream = iteratorToStream(syncGenerator());
 *
 * const reader = readableStream.getReader();
 * reader.read().then(({ value, done }) => {
 *   console.log(value); // Logs: "chunk1"
 * });
 * ```
 */
export function iteratorToStream<T>(iterator: Iterator<T>): ReadableStream<T> {
  return new ReadableStream<T>({
    pull(controller) {
      try {
        const { value, done } = iterator.next();
        if (done) {
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (err) {
        controller.error(err);
      }
    }
  });
}

/**
 * Splits a source ReadableStream into two separate ReadableStreams: one for valid values and one for errors encountered during stream processing.
 * 
 * This function uses two TransformStreams: one to catch errors and redirect them to an error stream, and another to process valid values.
 * 
 * @param source The original source ReadableStream to be split.
 * @returns An array containing two ReadableStreams: one for valid values and one for errors.
 * 
 * @example
 * ```ts
 * const sourceStream = new ReadableStream({
 *   start(controller) {
 *     controller.enqueue("Valid value 1");
 *     controller.enqueue("Valid value 2");
 *     // Simulate an error that occurs during processing
 *     setTimeout(() => {
 *       controller.error(new Error("Something went wrong"));
 *     }, 1000);
 *     controller.close();
 *   }
 * });
 * 
 * const [validStream, errorStream] = splitStream(sourceStream);
 * 
 * // Process valid values
 * validStream.getReader().read().then(({ value, done }) => {
 *   if (!done) console.log("Valid:", value);
 * });
 * 
 * // Process errors
 * errorStream.getReader().read().then(({ value, done }) => {
 *   if (!done) console.error("Error:", value);
 * });
 * ```
 */
export function splitStream<T>(
  source: ReadableStream<T>,
): [ReadableStream<T>, ReadableStream<Error>] {
  const sourceTransformer = new TransformStream<T, T>({
    transform(chunk, controller) {
      try {
        // Process valid chunk
        controller.enqueue(chunk);
      } catch (error) {
        // If an error occurs, redirect it to the error stream
        controller.error(error);
      }
    }
  });

  // Pipe the source through the validTransformer, catching errors and redirecting them
  const validStream = source.pipeThrough(sourceTransformer).pipeThrough(new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);
    },
    flush(controller) {
      controller.terminate();
    }
  }));

  // Create a separate stream for errors by catching them in the validTransformer
  const errorStream = new ReadableStream<Error>({
    start(controller) {
      sourceTransformer.readable.getReader().read().then(({ done, value }) => {
        if (value instanceof Error) {
          controller.enqueue(value);
        }
        if (done) {
          controller.close();
        }
      });
    }
  });

  return [validStream, errorStream];
}

/**
 * Splits a source ReadableStream into two separate ReadableStreams based on a predicate function.
 * 
 * Each chunk from the source stream is evaluated by the predicate function:
 * - If the predicate returns `true`, the chunk is routed to the first stream.
 * - If the predicate returns `false`, the chunk is routed to the second stream.
 * 
 * @param source The original source ReadableStream to be split.
 * @param predicate A function that evaluates each chunk and returns a boolean. 
 *                  `true` means the chunk goes to the first stream, `false` means it goes to the second stream.
 * @returns An array containing two ReadableStreams: one for chunks where the predicate returned `true`, and one for chunks where it returned `false`.
 * 
 * @example
 * ```ts
 * const sourceStream = new ReadableStream({
 *   start(controller) {
 *     controller.enqueue(1);
 *     controller.enqueue(2);
 *     controller.enqueue(3);
 *     controller.enqueue(4);
 *     controller.close();
 *   }
 * });
 * 
 * const isEven = (value: number) => value % 2 === 0;
 * const [evenStream, oddStream] = splitByStream(sourceStream, isEven);
 * 
 * // Process even numbers
 * evenStream.getReader().read().then(({ value, done }) => {
 *   if (!done) console.log("Even:", value); // Logs: Even: 2, Even: 4
 * });
 * 
 * // Process odd numbers
 * oddStream.getReader().read().then(({ value, done }) => {
 *   if (!done) console.log("Odd:", value); // Logs: Odd: 1, Odd: 3
 * });
 * ```
 */
export function splitByStream<T>(
  source: ReadableStream<T>,
  predicate: (chunk: T) => boolean | Promise<boolean>,
): [ReadableStream<T>, ReadableStream<T>] {
  const trueTransformer = new TransformStream<T, T>({
    async transform(chunk, controller) {
      if (await predicate(chunk)) {
        controller.enqueue(chunk);
      }
    }
  });

  const falseTransformer = new TransformStream<T, T>({
    async transform(chunk, controller) {
      if (!(await predicate(chunk))) {
        controller.enqueue(chunk);
      }
    }
  });

  const trueStream = source.pipeThrough(trueTransformer);
  const falseStream = source.pipeThrough(falseTransformer);

  return [trueStream, falseStream];
}

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
