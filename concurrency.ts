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
    async function* () {
      // We trigger all futures at once, using Promise.all to await them concurrently.
      const results = await Promise.all(futures);
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
  >(async function* () {
    // We trigger all futures at once, using Promise.allSettled to await them concurrently.
    const results = await Promise.allSettled(futures);
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
  return new Future<T | TReturn, T | TReturn, TNext>(async function* () {
    const result = Promise.race(futures);
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
 * Limits the number of concurrent `Future` operations.
 *
 * This method is useful for controlling how many Futures run at the same time,
 * which can prevent overwhelming resources or ensure a more manageable load.
 *
 * @param futures - An iterable of `Future` or `PromiseLike` objects.
 * @param limit - The maximum number of Futures to run concurrently.
 * @returns A `Future` that yields results as each operation completes.
 *
 * @example
 * ```typescript
 * const futures = [
 *   Promise.resolve(1),
 *   Promise.resolve(2),
 *   Promise.resolve(3),
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
 * for await (const result of future) {
 *   console.log(result); // Logs 1, 2, 3, 100, 20 in order with a concurrency limit of 2
 * }
 * ```
 *
 * @example
 * ```typescript
 * const futures = [
 *   fetch('https://api.example.com/1'),
 *   fetch('https://api.example.com/2'),
 *   fetch('https://api.example.com/3')
 * ];
 *
 * const limitedFuture = Future.withConcurrencyLimit(futures, 2);
 *
 * for await (const result of limitedFuture) {
 *   console.log(result); // Process each result as it becomes available
 * }
 * ```
 */
export function withConcurrencyLimit<T, TReturn, TNext>(
  futures: Iterable<Future<T, TReturn, TNext> | PromiseLike<T | TReturn>>,
  limit: number,
): Future<T | TReturn, T | TReturn | undefined, TNext> {
  return new Future<T | TReturn, T | TReturn | undefined, TNext>(
    async function* () {
      // Check if the input is an async iterator, sync iterator, or iterable
      // We use Symbol.asyncIterator and Symbol.iterator to distinguish between different types
      const iterator = futures?.[Symbol.iterator]?.();

      // If no valid iterator was found, throw an error indicating that the input is not iterable or an iterator
      if (
        (iterator ?? null) === null ||
        typeof iterator?.next !== "function"
      ) {
        throw new TypeError(
          "The provided input is not an iterable nor an iterator.",
        );
      }

      const activeFutures = new Map<
        PromiseLike<T | TReturn>,
        Promise<{ result: T | TReturn; promise: PromiseLike<T | TReturn> }>
      >();
      let finalResult: T | TReturn | undefined;

      while (activeFutures.size < limit) {
        const { done, value } = iterator.next();
        if (done) break;

        // Start the future concurrently
        const promise = value instanceof Future ? value.toPromise() : value;

        // Wrap the promise and store it in the map with the original promise as the key
        activeFutures.set(
          promise,
          Promise.resolve(promise).then((result) => ({ result, promise })),
        );

        // If we hit the concurrency limit, wait for one to resolve
        if (activeFutures.size >= limit) {
          const { result: finished, promise } = await Promise.race(
            activeFutures.values(),
          );
          activeFutures.delete(promise);
          finalResult = finished;
          yield finished;
        }
      }

      // After the main loop, yield any remaining futures
      for await (const remainingFuture of activeFutures.values()) {
        finalResult = remainingFuture.result;
        activeFutures.delete(remainingFuture.promise);
        yield finalResult;
      }

      return finalResult;
    },
  );
}
