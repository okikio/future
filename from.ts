import type { FutureFromOperation } from "./types.ts";

import { useDisposableStack } from "./disposal.ts";
import {
  isAsyncGenerator,
  isAsyncIterable,
  isAsyncIterator,
  isBuiltinIterable,
  isGenerator,
  isIterable,
  isIterator,
  isPromiseLike,
} from "./utils.ts";
import { Future } from "./future.ts";

/**
 * Creates a `Future` from an operation, such as an async generator, a promise-like object,
 * or any kind of iterable. This method converts different types of async tasks into a Future.
 *
 * ### What Does `from` Do?
 *
 * It takes an operation (which could be a promise, an iterator, an iterable, etc.) and wraps it
 * inside a `Future`, making it possible to control its execution with pause/resume/cancel functionalities.
 *
 * ### Supported Types:
 *
 * - **PromiseLike**: Handles promise-based operations that resolve asynchronously.
 * - **AsyncIterable/Iterable**: Supports both async and sync iterables (like arrays or streams).
 * - **AsyncGenerator/Generator**: Handles both async and sync generators.
 *
 * @param operation The operation to convert into a Future. It could be a promise-like object,
 * a generator, an async generator, an iterator, or an iterable.
 *
 * @returns A future representing the given operation.
 *
 * ### How It Works:
 *
 * **Push-Based**:
 * - This is the traditional workflow where the generator (or operation) autonomously pushes values to the consumer.
 * - In this scenario, the generator continues yielding values until it is complete.
 *
 * @example Push-Based Workflow:
 * ```typescript
 * const future = Future.from(async function* () {
 *   yield 1;
 *   yield 2;
 *   yield 3;
 *   return 4;
 * });
 *
 * for await (const value of future) {
 *   console.log(value); // Logs 1, 2, 3
 * }
 * ```
 *
 * **Pull-Based**:
 * - In this more advanced workflow, the generator waits for the consumer to "pull" the next value.
 * - Each time the consumer calls `next()`, a value is passed into the generator, resuming its execution.
 *
 * @example Pull-Based Workflow:
 * ```typescript
 * const future = Future.from(async function* () {
 *   let result = { value: 1, done: false };
 *
 *   while (!result.done) {
 *     result = await (yield result.value);  // Wait for input from the consumer
 *   }
 *
 *   return result.value;
 * });
 *
 * const iterator = future[Symbol.asyncIterator]();
 * console.log(await iterator.next());  // { value: 1, done: false }
 * console.log(await iterator.next({ value: 2, done: false }));  // { value: 2, done: false }
 * console.log(await iterator.next({ value: 3, done: true }));   // { value: 3, done: true }
 * ```
 *
 * ### Push vs. Pull:
 * - **Push-Based**: The generator automatically pushes values without waiting for any input.
 * - **Pull-Based**: The generator waits for input before it can produce the next value.
 *
 * ### Explanation of Iterators and Iterables:
 * - **Iterator**: An object that represents a sequence of values. It has a `.next()` method that returns the next value in the sequence.
 * - **Iterable**: An object that implements the `Symbol.iterator` method, returning an iterator.
 * - **Async Iterators**: Similar to iterators but work with `Promise` objects and use `for await...of` loops for asynchronous iteration.
 *
 * ### Handling Different Types:
 *
 * @example Handling a simple promise-like operation:
 * ```typescript
 * const future = Future.from(Promise.resolve(42));
 * const result = await future.toPromise(); // result is 42
 * ```
 *
 * @example Handling a synchronous iterable (like an array):
 * ```typescript
 * const future = Future.from([1, 2, 3]);
 * for await (const value of future) {
 *   console.log(value); // Logs 1, 2, and 3
 * }
 * ```
 *
 * @example Handling an async generator:
 * ```typescript
 * const future = Future.from(async function* () {
 *   yield 1;
 *   yield 2;
 *   yield 3;
 *   return 4;
 * });
 *
 * const result = await future.toPromise(); // result is 4
 * ```
 *
 * @example Handling an async generator with a pull-based workflow:
 * ```typescript
 * const future = Future.from(async function* (abort: AbortController) {
 *   const initialResult = { value: 1, done: false };
 *   let result = initialResult;
 *
 *   while (!result.done) {
 *     result = await (yield result.value);  // Pull-based: wait for external input
 *   }
 *   return result.value;
 * });
 *
 * const iterator = future[Symbol.asyncIterator]();
 * console.log(await iterator.next());  // { value: 1, done: false }
 * console.log(await iterator.next({ value: 2, done: false }));  // { value: 2, done: false }
 * console.log(await iterator.next({ value: 3, done: true }));   // { value: 3, done: true }
 * ```
 */
export function from<T, TReturn = T, TNext = unknown>(
  operation: PromiseLike<T>,
): ReturnType<typeof fromPromise<T>>;
export function from<T, TReturn = T, TNext = unknown>(
  operation: ReadableStream<T>,
): ReturnType<typeof fromStream<T>>;
export function from<T, TReturn = T, TNext = unknown>(
  operation: AsyncIterable<T> | Iterable<T | PromiseLike<T>>,
): ReturnType<typeof fromIterable<T, TReturn>>;
export function from<T, TReturn = T, TNext = unknown>(
  operation: Iterable<T | PromiseLike<T>>,
): ReturnType<typeof fromBuiltinIterable<T>>;
export function from<T, TReturn = T, TNext = unknown>(
  operation:
    | AsyncIterator<T, TReturn, TNext>
    | Iterator<T | PromiseLike<T>, TReturn | PromiseLike<TReturn>, TNext>,
): ReturnType<typeof fromIterator<T, TReturn>>;
export function from<T, TReturn = T, TNext = unknown>(
  operation: FutureFromOperation<T, TReturn, TNext>,
): ReturnType<typeof fromOperation<T, TReturn, TNext>>;
export function from<T, TReturn = T, TNext = unknown>(
  operation: Future<T, TReturn, TNext>,
): Future<T, TReturn, TNext>;
export function from<T, TReturn = T, TNext = unknown>(
  operation: T,
): ReturnType<typeof of<T>>;
export function from<T, TReturn = T, TNext = unknown>(
  operation:
    | FutureFromOperation<T, TReturn, TNext>
    | Future<T, TReturn, TNext>
    | ReadableStream<T>
    | AsyncIterable<T>
    | Iterable<T | PromiseLike<T>>
    | Iterator<T | PromiseLike<T>, TReturn | PromiseLike<TReturn>, TNext>
    | PromiseLike<T>
    | T,
) {
  // Handle Future instances directly
  if (is(operation)) {
    return operation as Future<T, TReturn, TNext>;
  }

  // Handle ReadableStreams (common in web APIs)
  if (operation instanceof ReadableStream) {
    return fromStream(operation);
  }

  if (isPromiseLike(operation)) {
    return fromPromise(operation);
  }

  if (isAsyncIterator(operation) || isIterator(operation)) {
    return fromIterator(operation);
  }

  // We skip arrays and strings as they are built-in iterables, but never return a value directly, so we await them.
  if (
    (isAsyncIterable(operation) || isIterable(operation)) &&
    !isBuiltinIterable(operation)
  ) {
    return fromIterable(operation);
  }

  if (isBuiltinIterable(operation)) {
    return fromBuiltinIterable(operation);
  }

  if (typeof operation === "function") {
    return fromOperation(operation as FutureFromOperation<T, TReturn, TNext>);
  }

  return of(operation);
}

export function of<T>(value: T): Future<T, T> {
  return new Future<T, T>(async function* (_, stack) {
    const disposable = useDisposableStack(value, stack);
    yield disposable;
    return disposable;
  });
}

export function fromPromise<T>(promise: PromiseLike<T>): Future<T, T> {
  return new Future<T, T>(async function* (_, stack) {
    const disposable = useDisposableStack(promise, stack);
    yield disposable;
    return disposable;
  });
}

export function fromOperation<T, TReturn = T, TNext = unknown>(
  operation: FutureFromOperation<T, TReturn, TNext>,
): Future<T, TReturn, TNext> {
  return new Future<T, TReturn, TNext>(
    async function* (abort, stack) {
      const result = operation(abort, stack);

      if (isAsyncGenerator(result) || isGenerator(result)) {
        // Handle async iterable or iterable result
        return yield* result;
      }

      if (isBuiltinIterable(result)) {
        // Handle built-in iterable result
        yield* result as Iterable<T | PromiseLike<T>>;
        return result as TReturn;
      }

      // Handle promise-like result or single value
      yield result;
      return result as TReturn;
    },
  );
}

export function fromIterable<T, TReturn = T>(
  iterable: AsyncIterable<T> | Iterable<T | PromiseLike<T>>,
): Future<T, TReturn> {
  return new Future<T, TReturn>(async function* (_, stack) {
    const disposable = useDisposableStack(iterable, stack);
    return yield* disposable;
  });
}

export function fromBuiltinIterable<T>(
  iterable: Iterable<T | PromiseLike<T>>,
): Future<T, Iterable<T | PromiseLike<T>>> {
  return new Future<T, Iterable<T | PromiseLike<T>>>(async function* (_, stack) {
    const disposable = useDisposableStack(iterable, stack);
    yield* disposable;
    return disposable;
  });
}

export function fromIterator<T, TReturn = T, TNext = unknown>(
  iterator:
    | AsyncIterator<T, TReturn, TNext>
    | Iterator<T | PromiseLike<T>, TReturn | PromiseLike<TReturn>, TNext>,
): Future<T, TReturn> {
  return new Future<T, TReturn, TNext>(async function* () {
    let iteratorResult = await iterator.next();
    while (!iteratorResult.done) {
      iteratorResult = await iterator.next(
        yield iteratorResult.value
      );
    }

    return iteratorResult.value;
  });
}

/**
 * Creates a `Future` from a readable stream.
 *
 * This method allows you to process data from a `ReadableStream` as it becomes available,
 * yielding each chunk of data and providing full control over the stream's lifecycle.
 *
 * @param stream - The `ReadableStream` to convert into a `Future`.
 * @returns A `Future` that yields chunks of data from the stream.
 *
 * @example
 * ```typescript
 * const response = await fetch('https://api.example.com/large-file');
 * const future = Future.fromStream(response.body!);
 *
 * for await (const chunk of future) {
 *   console.log(chunk); // Process each chunk of data
 * }
 * ```
 *
 * @example
 * ```typescript
 * const stream = new ReadableStream<Uint8Array>({
 *   pull(controller) {
 *     controller.enqueue(new Uint8Array([1, 2, 3]));
 *     controller.close();
 *   }
 * });
 * const future = Future.fromStream(stream);
 * for await (const chunk of future) {
 *   console.log(chunk); // Logs Uint8Array([1, 2, 3])
 * }
 * ```
 */
export function fromStream<T>(stream: ReadableStream<T>): Future<T, undefined> {
  return new Future<T, undefined>(async function* (_, stack) {
    const reader = useDisposableStack(stream, stack).getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Yield each chunk of data
        yield value;
      }
    } catch (error) {
      reader.cancel(error);
      throw error;
    } finally {
      reader.releaseLock();
    }

    return undefined;
  });
}

/**
 * Creates a new `Future` instance from an async generator function.
 * @param value - A function that returns an async generator to define the asynchronous task.
 * @returns A new `Future` instance.
 */
export function is<T, TReturn = unknown, TNext = unknown>(
  value: unknown,
): value is Future<T, TReturn, TNext> {
  return value instanceof Future;
}
