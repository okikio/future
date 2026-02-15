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
 * Converts async operations into controllable Futures.
 * 
 * ## What This Does
 * 
 * `from()` takes any async operation (Promise, iterable, stream, function, etc.) and wraps it
 * in a Future - giving you a controllable handle to that work. The work itself doesn't change,
 * but now you can pause, cancel, observe, or compose it.
 * 
 * ## Basic Usage
 * 
 * Convert Promises to controllable work:
 * 
 * ```typescript
 * // Promise → Future (now controllable)
 * const future = from(fetch('/api/data'));
 * 
 * // Can cancel it
 * setTimeout(() => future.cancel(), 1000);
 * 
 * // Can await it (Promise-compatible)
 * const data = await future;
 * ```
 * 
 * ## Progress Tracking
 * 
 * Use async generator functions to report progress:
 * 
 * ```typescript
 * const future = from(async function* () {
 *   yield "Loading...";           // Progress update
 *   const data = await fetch('/api');
 *   
 *   yield "Processing...";         // More progress
 *   const result = await data.json();
 *   
 *   return result;                 // Final result
 * });
 * 
 * // Option 1: Watch progress
 * for await (const status of future) {
 *   updateUI(status);  // "Loading...", "Processing..."
 * }
 * 
 * // Option 2: Just get result
 * const result = await future.toPromise();
 * ```
 * 
 * ## Supported Inputs
 * 
 * Converts any async operation to a controllable Future:
 * 
 * ```typescript
 * // Promises
 * from(fetch('/api'))
 * from(Promise.resolve(42))
 * 
 * // Arrays (yields each item)
 * from([1, 2, 3, 4, 5])
 * 
 * // Streams
 * from(response.body)
 * 
 * // Generator functions (for progress/control)
 * from(async function* () {
 *   yield 1;
 *   yield 2;
 *   return 3;
 * })
 * 
 * // Plain values
 * from(42)  // Immediately resolves to 42
 * ```
 * 
 * ## Advanced: Cancellation
 * 
 * Generator functions receive an AbortController for cancellation support:
 * 
 * ```typescript
 * const future = from(async function* (abort) {
 *   for (let i = 0; i < 100; i++) {
 *     abort.signal.throwIfAborted();  // Check if cancelled
 *     yield await fetch(`/api/item/${i}`);
 *   }
 * });
 * 
 * // Cancel the work
 * future.cancel();  // Stops iteration
 * ```
 * 
 * ## Advanced: Resource Cleanup
 * 
 * Generator functions receive a DisposableStack for automatic cleanup:
 * 
 * ```typescript
 * const future = from(async function* (_, disposables) {
 *   const file = await Deno.open("data.txt");
 *   disposables.use(file);  // Auto-cleanup on complete/cancel
 *   
 *   yield "Reading...";
 *   return await file.readAll();
 * });
 * ```
 * 
 * ## Advanced: Interactive Flow (Pull-Based)
 * 
 * Consumer can send values back to control the work:
 * 
 * ```typescript
 * const future = from(async function* () {
 *   let count = 0;
 *   let input;
 *   
 *   while (count < 5) {
 *     input = yield count;  // Yield value, wait for input
 *     count = input + 1;    // Use input to control flow
 *   }
 *   
 *   return count;
 * });
 * 
 * const iterator = future[Symbol.asyncIterator]();
 * await iterator.next();     // { value: 0, done: false }
 * await iterator.next(5);    // Send 5 back, get { value: 6, done: false }
 * ```
 * 
 * @param operation - Any async operation to convert into a controllable Future
 * @returns A Future providing control over the async work
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
