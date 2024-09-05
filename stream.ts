import type { EnhancedReadableStream, DualDisposable } from "./types.ts";
import { createChannel } from "./channel.ts";

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
export async function* streamToAsyncIterator<T>(
  stream: ReadableStream<T>,
): AsyncGenerator<T> {
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
export function asyncIteratorToStream<T>(
  iterator: AsyncIterator<T>,
): ReadableStream<T> {
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
    },
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
    },
  });
}

/**
 * Splits a source ReadableStream into two separate ReadableStreams: one for valid values and one for errors encountered during stream processing.
 *
 * ### Error Handling:
 * - This function catches errors during the enqueueing of values and routes them to the error stream.
 * - Errors occurring during the transformation process will be sent to the error stream.
 * - Valid values will continue to flow into the valid stream, ensuring that processing can continue even in the presence of errors.
 *
 * ### Disposal:
 * - Each resulting stream supports multiple readers, and they will automatically handle resource cleanup once all consumers have finished reading.
 * - The channels used to manage the streams are properly disposed of when the streams are closed or no longer needed.
 *
 * @template V The type of data contained in the source stream.
 * @template E The type of errors encountered during stream processing.
 * @param source The original source ReadableStream to be split.
 * @returns An array containing two ReadableStreams:
 * - The first stream for valid values.
 * - The second stream for errors encountered during stream processing.
 *
 * @example
 * ```typescript
 * // Example source stream with valid values and an error
 * const sourceStream = new ReadableStream({
 *   start(controller) {
 *     controller.enqueue("Valid value 1");
 *     controller.enqueue("Valid value 2");
 *     controller.error(new Error("Something went wrong"));
 *     controller.close();
 *   }
 * });
 *
 * const [validStream, errorStream] = splitStream(sourceStream);
 *
 * // Reading from the valid stream
 * const validReader = validStream.getReader();
 * validReader.read().then(({ value }) => console.log("Valid:", value)); // Logs: "Valid value 1"
 *
 * // Reading from the error stream
 * const errorReader = errorStream.getReader();
 * errorReader.read().then(({ value }) => console.error("Error:", value)); // Logs: Error: Something went wrong
 * ```
 */
export function splitStream<V, E = unknown>(
  source: ReadableStream<V>,
):
  & readonly [EnhancedReadableStream<V>, EnhancedReadableStream<E>]
  & DualDisposable {
  // Create channels for valid values and errors
  const validChannel = createChannel<V>();
  const errorChannel = createChannel<E>();

  // Transformer to manage the splitting logic
  const transformer = new TransformStream<V, E>({
    async transform(chunk) {
      try {
        // Attempt to enqueue the chunk into the valid channel
        await validChannel.getWriter().write(chunk);
      } catch (error) {
        // If an error occurs, enqueue the error into the error channel
        await errorChannel.getWriter().write(error as E);
      }
    },
    flush() {
      // Close both channels when the stream is done
      validChannel.close();
      errorChannel.close();
    },
  });

  // Pipe the source through the transformer
  source.pipeThrough(transformer);

  // Return the two readable streams wrapped with disposables
  return Object.assign(
    [validChannel.readable, errorChannel.readable] as const,
    {
      [Symbol.dispose]() {
        validChannel[Symbol.dispose]();
        errorChannel[Symbol.dispose]();
      },
      async [Symbol.asyncDispose]() {
        await validChannel[Symbol.asyncDispose]();
        await errorChannel[Symbol.asyncDispose]();
      },
    },
  );
}

/**
 * Splits a source ReadableStream into two separate ReadableStreams based on a predicate function.
 *
 * ### Predicate-Based Splitting:
 * - The source stream is evaluated chunk by chunk using the provided predicate function.
 * - Chunks that satisfy the predicate are routed to the first stream.
 * - Chunks that do not satisfy the predicate are routed to the second stream.
 *
 * ### Disposal:
 * - Each resulting stream supports multiple readers and will automatically handle resource cleanup once all consumers have finished reading.
 * - The channels used to manage the streams are properly disposed of when the streams are closed or no longer needed.
 *
 * @template T The type of data contained in the source stream.
 * @param source The original source ReadableStream to be split.
 * @param predicate A function that evaluates each chunk and returns a boolean. `true` means the chunk goes to the first stream, `false` means it goes to the second stream.
 * @returns An array containing two ReadableStreams:
 * - The first stream contains chunks that satisfied the predicate.
 * - The second stream contains chunks that did not satisfy the predicate.
 *
 * @example
 * ```typescript
 * // Example source stream with numbers
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
 * // Reading from the even stream
 * const evenReader = evenStream.getReader();
 * evenReader.read().then(({ value }) => console.log("Even:", value)); // Logs: 2
 *
 * // Reading from the odd stream
 * const oddReader = oddStream.getReader();
 * oddReader.read().then(({ value }) => console.log("Odd:", value)); // Logs: 1
 * ```
 */
export function splitByStream<T, F = unknown>(
  source: ReadableStream<T | F>,
  predicate: (chunk: T | F) => boolean | PromiseLike<boolean>,
):
  & readonly [EnhancedReadableStream<T>, EnhancedReadableStream<F>]
  & DualDisposable {
  // Create channels for true and false predicate results
  const trueChannel = createChannel<T>();
  const falseChannel = createChannel<F>();

  // Transformer to manage the splitting logic based on the predicate
  const transformer = new TransformStream<T | F, T | F>({
    async transform(chunk) {
      // Route chunks based on the predicate
      if (await predicate(chunk)) {
        trueChannel.getWriter().write(chunk as T);
      } else {
        falseChannel.getWriter().write(chunk as F);
      }
    },
    flush() {
      // Close both channels when the stream is done
      trueChannel.close();
      falseChannel.close();
    },
  });

  // Pipe the source through the transformer
  source.pipeThrough(transformer);

  // Return the two readable streams wrapped with disposables
  return Object.assign([trueChannel.readable, falseChannel.readable] as const, {
    [Symbol.dispose]() {
      trueChannel[Symbol.dispose]();
      falseChannel[Symbol.dispose]();
    },
    async [Symbol.asyncDispose]() {
      await trueChannel[Symbol.asyncDispose]();
      await falseChannel[Symbol.asyncDispose]();
    },
  });
}
