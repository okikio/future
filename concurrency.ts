import { useDisposableStack } from "./disposal.ts";
import { Future } from "./future.ts";

/**
 * Runs multiple Futures concurrently, yielding their results as they all complete.
 *
 * This is similar to `Promise.all` but with support for yielding results in sequence
 * once all the futures have been resolved.
 *
 * @param futures - An iterable of `Future` or `PromiseLike` objects.
 * @returns An AsyncIterable yielding each result as they complete.
 */
export function all<T, TReturn, TNext>(
  futures: Iterable<Future<T, TReturn, TNext> | PromiseLike<T | TReturn>>,
): Future<Awaited<T | TReturn>, Awaited<T | TReturn>[]> {
  return new Future<Awaited<T | TReturn>, Awaited<T | TReturn>[]>(
    async function* (_, stack) {
      // We trigger all futures at once, using Promise.all to await them concurrently.
      const results = await Promise.all(
        useDisposableStack(futures, stack)
      );
      yield* results;
      return results;
    },
  );
}

/**
 * Executes multiple futures concurrently and yields their results or errors as soon as they settle.
 * This method works similarly to `Promise.allSettled` but yields results incrementally.
 *
 * @param futures - An iterable or async iterable of `Future` or `PromiseLike` objects.
 * @returns An AsyncIterable yielding each settled result.
 * @example
 * ```typescript
 * const futureSettled = Future.allSettled([
 *   Future.from(async function* () {
 *     yield 42;
 *     return 100;
 *   }),
 *   Future.from(async function* () {
 *     yield 10;
 *     return 20;
 *   })
 * ]);
 *
 * for await (const result of futureSettled) {
 *   if (result.status === "fulfilled") {
 *     console.log(result.value); // Outputs 100 and 20
 *   } else {
 *     console.error(result.reason);
 *   }
 * }
 * ```
 */
export function allSettled<T, TReturn, TNext>(
  futures: Iterable<Future<T, TReturn, TNext> | PromiseLike<T | TReturn>>,
): Future<
  PromiseSettledResult<T | TReturn>,
  PromiseSettledResult<T | TReturn>[]
> {
  return new Future<
    PromiseSettledResult<T | TReturn>,
    PromiseSettledResult<T | TReturn>[]
  >(async function* (_, stack) {
    // We trigger all futures at once, using Promise.allSettled to await them concurrently.
    const results = await Promise.allSettled(
      useDisposableStack(futures, stack)
    );
    yield* results;
    return results;
  });
}

/**
 * Returns the first settled Future, similar to `Promise.race`.
 *
 * @param futures - An iterable or async iterable of `Future` or `PromiseLike` objects.
 * @returns An AsyncIterable yielding the first result that resolves.
 */
export function race<T, TReturn, TNext>(
  futures: Iterable<Future<T, TReturn, TNext> | PromiseLike<T | TReturn>>,
): Future<T | TReturn, T | TReturn, TNext> {
  return new Future<T | TReturn, T | TReturn, TNext>(async function* (_, stack) {
    const result = Promise.race(
      useDisposableStack(futures, stack)
    );
    yield result;
    return result;
  });
}

/**
 * Executes multiple Futures concurrently, but only returns results for the first `count` Futures.
 *
 * @param futures - An iterable or async iterable of `Future` or `PromiseLike` objects.
 * @param count - The number of Futures to resolve before yielding results.
 * @returns An AsyncIterable yielding the first `count` resolved results.
 */
export function some<T, TReturn, TNext>(
  futures: Iterable<Future<T, TReturn, TNext> | PromiseLike<T | TReturn>>,
  count: number,
): Future<
  PromiseSettledResult<T | TReturn>,
  PromiseSettledResult<T | TReturn>[]
> {
  return allSettled(
    Array.from(futures).slice(0, count),
  );
}

/**
 * Executes an iterable of `Future` objects with a limit on the number of concurrent operations.
 * This function dynamically manages a set of running `Future` operations, ensuring that no more than
 * the specified `limit` of `Future` objects are running at any given time. As each `Future` completes,
 * the function continues to yield results, maintaining the concurrency level by starting the next `Future`
 * from the iterable.
 *
 * Once all `Future` operations are completed, it returns an array of the final results of each `Future` (in the order of completion).
 *
 * @template T - The type yielded by the `Future` iterators.
 * @template TReturn - The return type of the `Future` iterators.
 * @template TNext - The type passed back to the `Future` iterators when calling `next`.
 * @param futures - An iterable of `Future` objects.
 * @param limit - The maximum number of `Future` operations to run concurrently.
 * @returns A `Future` that yields intermediate results as they become available, and finally returns an array of the final results (in the order of completion).
 *
 * @example
 * ```typescript
 * const futures = [
 *   Future.from(async function* () {
 *     yield 42;
 *     return 100;
 *   }),
 *   Future.from(async function* () {
 *     yield 10;
 *     return 20;
 *   })
 * ];
 *
 * const limitedFuture = withConcurrencyLimit(futures, 2);
 *
 * // Yield intermediate results
 * for await (const value of limitedFuture) {
 *   console.log(value); // Logs 42 and 10 as they are yielded
 * }
 *
 * // Get the final results
 * const finalResults = await limitedFuture.toPromise();
 * console.log(finalResults); // Logs [100, 20], which are the final results of the futures.
 * ```
 *
 * @example
 * ```typescript
 * // Simulating I/O-bound tasks
 * const simulateIO = (duration: number) =>
 *   Future.from(async function* () {
 *     yield `Starting task for ${duration}ms`;
 *     await new Promise(resolve => setTimeout(resolve, duration));
 *     return `Completed task for ${duration}ms`;
 *   });
 *
 * const futures = [
 *   simulateIO(500),
 *   simulateIO(1000),
 *   simulateIO(200),
 *   simulateIO(800),
 *   simulateIO(300)
 * ];
 *
 * const limitedFuture = withConcurrencyLimit(futures, 2);
 *
 * // Yield intermediate results
 * for await (const value of limitedFuture) {
 *   console.log(value); // Logs the starting messages as they are yielded
 * }
 *
 * // Get the final results
 * const finalResults = await limitedFuture.toPromise();
 * console.log(finalResults); // Logs the completion messages in the order of completion
 * ```
 *
 * @example
 * ```typescript
 * // Handling API requests with concurrency control
 * const apiRequest = (url: string) =>
 *   Future.from(async function* () {
 *     yield `Fetching ${url}`;
 *     const response = await fetch(url);
 *     const data = await response.json();
 *     return data;
 *   });
 *
 * const futures = [
 *   apiRequest('https://api.example.com/1'),
 *   apiRequest('https://api.example.com/2'),
 *   apiRequest('https://api.example.com/3'),
 *   apiRequest('https://api.example.com/4'),
 *   apiRequest('https://api.example.com/5')
 * ];
 *
 * const limitedFuture = withConcurrencyLimit(futures, 3);
 *
 * // Yield intermediate results
 * for await (const value of limitedFuture) {
 *   console.log(value); // Logs the fetching messages as they are yielded
 * }
 *
 * // Get the final results
 * const finalResults = await limitedFuture.toPromise();
 * console.log(finalResults); // Logs the data fetched from the APIs as an array
 * ```
 *
 * @example
 * ```typescript
 * // Performing file operations with concurrency control
 * const readFile = (path: string) =>
 *   Future.from(async function* () {
 *     yield `Reading file: ${path}`;
 *     const content = await Deno.readTextFile(path);
 *     return content;
 *   });
 *
 * const futures = [
 *   readFile('/path/to/file1.txt'),
 *   readFile('/path/to/file2.txt'),
 *   readFile('/path/to/file3.txt'),
 *   readFile('/path/to/file4.txt')
 * ];
 *
 * const limitedFuture = withConcurrencyLimit(futures, 2);
 *
 * // Yield intermediate results
 * for await (const value of limitedFuture) {
 *   console.log(value); // Logs the reading messages as they are yielded
 * }
 *
 * // Get the final results
 * const finalResults = await limitedFuture.toPromise();
 * console.log(finalResults); // Logs the contents of the files as an array
 * ```
 */
export function withConcurrencyLimit<T, TReturn, TNext>(
  futures: Iterable<Future<T, TReturn, TNext>>,
  limit: number,
): Future<T, (T | TReturn)[], TNext> {
  return new Future<T, (T | TReturn)[], TNext>(
    async function* (_, stack) {
    // Obtain the iterator from the futures iterable
    let iterator = futures?.[Symbol.iterator]?.();

    // Validate that the input is indeed iterable or an iterator
    if (
      (iterator ?? null) === null ||
      typeof iterator?.next !== "function"
    ) {
      throw new TypeError(
        "The provided input is not an iterable nor an iterator.",
      );
    }

    // Metadata map to track the completion status of each Future
    const metadata = new WeakMap<
      Future<T, TReturn, TNext>,
      { done: boolean }
    >();
    
    // Map to track currently active futures and their promises
    const activeFutures = new Map<
      number,
      {
        future: Future<T, TReturn, TNext>,
        value: PromiseLike<IteratorResult<T, T | TReturn>>
      }
    >();

    try {
      let nextFuture = iterator.next();
      let index = 0;

      // Initialize the first batch of active futures up to the limit
      while (index < limit && !nextFuture.done) {
        const future = nextFuture.value;
        if (!metadata.has(future)) {
          // Use the disposable stack to manage the resource
          useDisposableStack(future, stack);
          metadata.set(future, { done: false });
          activeFutures.set(index++, {
            future,
            value: future.next()
          });
        }

        // Move to the next future
        nextFuture = iterator.next();
      }

      const finalResults: (T | TReturn)[] = [];
      let yieldResult: TNext;

      // Continue until all iterators are exhausted
      while (activeFutures.size > 0) {
        // Wait for the first future to resolve
        const [index, future, { value, done }] = await Promise.race(
          Array.from(activeFutures.entries(), async ([index, { future, value: promise }]) => {
            const result = await promise;
            return [index, future, result] as const;
          })
        );

        // Yield the result of the completed future
        if (!done) yieldResult = yield value;
        else {
          finalResults.push(value);
          metadata.get(future)!.done = true;
        }

        activeFutures.delete(index);

        // If there are fewer than the limit of active futures, add more from the futures iterable
        if (nextFuture.done) {
          // If we've exhausted the iterator, start over from the beginning
          iterator = futures?.[Symbol.iterator]?.();
          nextFuture = iterator.next();
        }

        const newFuture = nextFuture.value;
        const hasMetadata = metadata.has(newFuture);
        const getMetadata = metadata.get(newFuture);
        if (!getMetadata?.done) {
          activeFutures.set(index, {
            future: newFuture,
            value: hasMetadata ? newFuture.next(yieldResult!) : newFuture.next()
          });
        }

        if (!hasMetadata) {
          useDisposableStack(newFuture, stack);
          metadata.set(newFuture, { done: false });
        }
      
        nextFuture = iterator.next();
      }

      // Return the final results of the futures in the order of completion
      return finalResults;
    } finally {
      // Clean up when done
      activeFutures.clear();
      for (const future of futures) {
        metadata.delete(future);
      }
    }
  },
  );
}
