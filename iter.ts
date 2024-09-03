import type { DualDisposable } from "./types.ts";
import {
  asyncIteratorToStream,
  splitByStream,
  splitStream,
  streamToAsyncIterator,
} from "./stream.ts";

/**
 * Splits a source iterator or iterable into two separate async iterators: one for valid values and one for errors encountered during iteration.
 *
 * ### Iterator Splitting:
 * - The source iterator is converted to a ReadableStream, which is then split into two streams.
 * - The valid values are routed to one async iterator.
 * - Errors encountered during iteration are routed to a second async iterator.
 *
 * ### Disposal:
 * - Both resulting iterators automatically handle resource cleanup once all values have been consumed.
 * - The streams used internally are properly disposed of when no longer needed.
 *
 * @template V The type of valid values in the iterator.
 * @template E The type of errors encountered during iteration.
 * @template TReturn The type of the return value from the source iterator.
 * @param source The original source iterator or iterable to be split.
 * @returns An array containing two async iterators:
 * - The first iterator yields valid values.
 * - The second iterator yields errors encountered during iteration.
 *
 * @example
 * ```typescript
 * // Example source iterator with values and errors
 * async function* sourceIterator() {
 *   yield "Valid value 1";
 *   yield "Valid value 2";
 *   throw new Error("Iteration error");
 * }
 *
 * const [validIter, errorIter] = splitIter(sourceIterator());
 *
 * // Consuming valid values
 * (async () => {
 *   for await (const value of validIter) {
 *     console.log("Valid:", value); // Logs: "Valid value 1", "Valid value 2"
 *   }
 * })();
 *
 * // Consuming errors
 * (async () => {
 *   for await (const error of errorIter) {
 *     console.error("Error:", error); // Logs: Error: Iteration error
 *   }
 * })();
 * ```
 */
export function splitIter<V, E = V, TReturn = unknown>(
  source:
    | AsyncIterable<V>
    | Iterable<V>
    | AsyncIterator<V, TReturn>
    | Iterator<V, TReturn>,
):
  & readonly [
    AsyncGenerator<V, undefined>,
    AsyncGenerator<E, undefined>,
  ]
  & DualDisposable {
  // Convert the source to a ReadableStream
  const sourceStream = asyncIteratorToStream(
    source as AsyncIterator<V, TReturn | undefined>,
  );

  // Split the stream into valid and error streams
  const split = splitStream<V, E>(sourceStream);

  // Convert the streams back to async iterators
  const [validStream, errorStream] = split;
  const validIterator = streamToAsyncIterator<V>(validStream);
  const errorIterator = streamToAsyncIterator<E>(errorStream);

  return Object.assign([validIterator, errorIterator] as const, {
    [Symbol.dispose]() {
      split[Symbol.dispose]();
    },
    [Symbol.asyncDispose]() {
      return split[Symbol.asyncDispose]();
    },
  });
}

/**
 * Splits a source iterator or iterable into two separate async iterators based on a predicate function.
 * One iterator yields values that satisfy the predicate, the other yields values that do not.
 *
 * ### Predicate-Based Splitting:
 * - The source iterator is converted to a ReadableStream, which is then split into two streams based on the predicate.
 * - Values that satisfy the predicate are routed to one async iterator.
 * - Values that do not satisfy the predicate are routed to a second async iterator.
 *
 * ### Disposal:
 * - Both resulting iterators automatically handle resource cleanup once all values have been consumed.
 * - The streams used internally are properly disposed of when no longer needed.
 *
 * @template T The type of values that satisfy the predicate.
 * @template F The type of values that do not satisfy the predicate.
 * @template VReturn The type of the return value from the source iterator.
 * @param source The original source iterator or iterable to be split.
 * @param predicate The predicate function that determines which values go to the first iterator.
 * @returns An array containing two async iterators:
 * - The first iterator yields values that satisfy the predicate.
 * - The second iterator yields values that do not satisfy the predicate.
 *
 * @example
 * ```typescript
 * // Example source iterator with numbers
 * async function* sourceIterator() {
 *   yield 1;
 *   yield 2;
 *   yield 3;
 *   yield 4;
 * }
 *
 * const isEven = (value: number) => value % 2 === 0;
 * const [evenIter, oddIter] = splitIterBy(sourceIterator(), isEven);
 *
 * // Consuming even values
 * (async () => {
 *   for await (const value of evenIter) {
 *     console.log("Even:", value); // Logs: 2, 4
 *   }
 * })();
 *
 * // Consuming odd values
 * (async () => {
 *   for await (const value of oddIter) {
 *     console.log("Odd:", value); // Logs: 1, 3
 *   }
 * })();
 * ```
 */
export function splitIterBy<T, F = unknown, VReturn = unknown>(
  source:
    | AsyncIterable<T | F>
    | Iterable<T | F>
    | AsyncIterator<T | F, VReturn>
    | Iterator<T | F, VReturn>,
  predicate: (value: T | F) => boolean | PromiseLike<boolean>,
):
  & readonly [
    AsyncGenerator<T, undefined>,
    AsyncGenerator<F, undefined>,
  ]
  & DualDisposable {
  // Convert the source to a ReadableStream
  const sourceStream = asyncIteratorToStream(
    source as AsyncIterator<T | F, VReturn | undefined>,
  );

  // Split the stream based on the predicate
  const split = splitByStream<T, F>(
    sourceStream,
    predicate,
  );

  // Convert the streams back to async iterators
  const [trueStream, falseStream] = split;
  const trueIterator = streamToAsyncIterator<T>(trueStream);
  const falseIterator = streamToAsyncIterator<F>(falseStream);

  return Object.assign([trueIterator, falseIterator] as const, {
    [Symbol.dispose]() {
      split[Symbol.dispose]();
    },
    [Symbol.asyncDispose]() {
      return split[Symbol.asyncDispose]();
    },
  });
}
