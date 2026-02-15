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
} from "./_utils.ts";
import { Future } from "./future.ts";

/**
 * Converts any async operation into a generator-based Future.
 * 
 * This is the primary way to create Futures. It accepts Promises, iterables, generators, streams,
 * or raw values and wraps them in the async generator foundation that powers Futures. The result
 * works like a Promise but has generator capabilities.
 * 
 * ## Promise Replacement Usage
 * 
 * Convert Promises to Futures - they work identically:
 * 
 * ```typescript
 * // Promise → Future (Promise-compatible)
 * const future = from(fetch('/api/data'));
 * const data = await future;  // Just like: await promise
 * ```
 * 
 * ## Generator Foundation
 * 
 * The real power comes from using async generator functions, which enable features
 * Promises fundamentally cannot support:
 * 
 * ```typescript
 * const future = from(async function* () {
 *   yield "loading...";        // Progress update (impossible with Promises)
 *   const data = await fetch('/api');
 *   yield "processing...";     // More progress
 *   return await data.json();  // Final result
 * });
 * 
 * // Use like Promise
 * const result = await future.toPromise();
 * 
 * // OR leverage generator yields
 * for await (const status of future) {
 *   console.log(status);  // "loading...", "processing..."
 * }
 * ```
 * 
 * ## Push vs Pull Workflows
 * 
 * The async generator foundation supports both autonomous (push) and interactive (pull) modes:
 * 
 * ### Push-Based (Traditional)
 * 
 * Generator autonomously yields values - works like a data stream:
 * 
 * ```typescript
 * const future = from(async function* () {
 *   yield 1;  // Generator pushes values
 *   yield 2;
 *   return 3;
 * });
 * 
 * for await (const value of future) {
 *   console.log(value);  // Passively receives: 1, 2
 * }
 * ```
 * 
 * ### Pull-Based (Interactive)
 * 
 * Consumer controls generator execution by sending values back - bidirectional communication
 * unique to generators, impossible with Promises:
 * 
 * ```typescript
 * const future = from(async function* () {
 *   let count = 0;
 *   let input;
 *   
 *   while (count < 5) {
 *     input = yield count;  // Yield AND wait for input
 *     count = input + 1;    // Use input to control flow
 *   }
 *   
 *   return count;
 * });
 * 
 * const iterator = future[Symbol.asyncIterator]();
 * await iterator.next();     // { value: 0, done: false }
 * await iterator.next(5);    // Send 5 back, get { value: 6, done: false }
 * await iterator.next(10);   // Send 10 back, get { value: 11, done: false }
 * ```
 * 
 * ## Supported Input Types
 * 
 * Converts any async operation to a generator-based Future:
 * 
 * - **Async Generator Functions**: Used directly, preserving all generator features
 * - **Promises**: Wrapped in a generator that yields once and returns the value
 * - **Iterables/Iterators**: Converted to generators that yield each item
 * - **ReadableStreams**: Converted to generators that yield chunks
 * - **Raw Values**: Wrapped in a generator that immediately returns the value
 * 
 * @param operation - Any async operation to convert into a generator-based Future
 * @returns Future built on async generator foundation
 * 
 * @example Promise to Future (Promise-compatible)
 * ```typescript
 * const future = from(Promise.resolve(42));
 * const result = await future;  // 42
 * ```
 * 
 * @example Array to Future (yields each item)
 * ```typescript
 * const future = from([1, 2, 3]);
 * for await (const value of future) {
 *   console.log(value);  // 1, 2, 3
 * }
 * ```
 * 
 * @example ReadableStream to Future (yields chunks)
 * ```typescript
 * const response = await fetch('/api/data');
 * const future = from(response.body);
 * 
 * for await (const chunk of future) {
 *   processChunk(chunk);
 * }
 * ```
 * 
 * @example Generator function with cancellation
 * ```typescript
 * const future = from(async function* (abort) {
 *   for (let i = 0; i < 100; i++) {
 *     abort.signal.throwIfAborted();  // Generator can be cancelled
 *     yield i;
 *   }
 * });
 * 
 * setTimeout(() => future.cancel(), 1000);  // Calls generator.return()
 * ```
 * 
 * @example Generator with resource cleanup
 * ```typescript
 * const future = from(async function* (_, disposables) {
 *   const file = await Deno.open("data.txt");
 *   disposables.use(file);  // Auto-cleanup via generator finally
 *   
 *   yield "reading...";
 *   return await file.readAll();
 * });
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
  return new Future<T, TReturn, TNext>(async function* (_, stack) {
    const _iterator = useDisposableStack(iterator, stack);
    
    let iteratorResult = await _iterator.next();
    while (!iteratorResult.done) {
      iteratorResult = await _iterator.next(
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
    const _stream = useDisposableStack(stream, stack);
    const reader = _stream.getReader();

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
