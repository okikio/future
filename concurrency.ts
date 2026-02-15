/**
 * Concurrency control utilities for managing parallel Future execution.
 * 
 * Provides functions similar to Promise utilities (`all`, `allSettled`, `race`) but with enhanced
 * control, resource management, and the ability to yield intermediate values during execution.
 * 
 * @module concurrency
 */

import { useDisposableStack } from "./disposal.ts";
import { Future } from "./future.ts";

/**
 * Runs multiple Futures concurrently, similar to `Promise.all()`. All futures execute in parallel,
 * and results are returned in input order. If any future rejects, the entire operation fails.
 * 
 * Unlike `Promise.all`, this yields each result as it completes, making progress trackable.
 * Results maintain input order regardless of completion order.
 * 
 * @param futures - Futures or promises to execute concurrently
 * @returns Future yielding each result, returning array of all results
 * 
 * @example
 * ```typescript
 * import { all, from } from "@okikio/future";
 * 
 * const futures = [
 *   from(fetch('/api/users')),
 *   from(fetch('/api/posts')),
 *   from(fetch('/api/comments'))
 * ];
 * 
 * const results = await all(futures).toPromise();
 * // Returns [users, posts, comments] in order
 * ```
 * 
 * @example Track progress during execution
 * ```typescript
 * for await (const result of all(futures)) {
 *   console.log('Completed:', result);
 * }
 * ```
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
 * Executes futures concurrently and returns all settled results, never rejecting even if some fail.
 * Similar to `Promise.allSettled()`, this waits for all futures to complete and returns detailed
 * status for each: `{ status: "fulfilled", value }` or `{ status: "rejected", reason }`.
 * 
 * Useful for batch operations where partial success is acceptable, or when you need to know exactly
 * which operations succeeded and which failed without stopping on first error.
 * 
 * @param futures - Futures or promises to execute
 * @returns Future yielding settled results with status and value/reason
 * 
 * @example Handle mixed success and failure
 * ```typescript
 * import { allSettled, from } from "@okikio/future";
 * 
 * const results = await allSettled([
 *   from(Promise.resolve(1)),
 *   from(Promise.reject(new Error("Failed"))),
 *   from(Promise.resolve(3))
 * ]).toPromise();
 * 
 * results.forEach(r => {
 *   if (r.status === "fulfilled") console.log("Success:", r.value);
 *   else console.error("Failed:", r.reason);
 * });
 * ```
 * 
 * @example Batch API calls with error tracking
 * ```typescript
 * const futures = userIds.map(id => 
 *   from(fetch(`/api/users/${id}`).then(r => r.json()))
 * );
 * 
 * const results = await allSettled(futures).toPromise();
 * const succeeded = results.filter(r => r.status === "fulfilled");
 * console.log(`Loaded ${succeeded.length}/${results.length} users`);
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
 * Returns the first future to complete (resolve or reject), similar to `Promise.race()`.
 * Useful for timeout patterns, failover strategies, or showing UI feedback after a delay.
 * 
 * Other futures continue running but their results are ignored. The returned value or error
 * depends on which future completes first - there's no guarantee of success or failure.
 * 
 * @param futures - Futures or promises to race
 * @returns Future resolving/rejecting with first completed result
 * 
 * @example Request with timeout
 * ```typescript
 * import { race, from } from "@okikio/future";
 * 
 * const result = await race([
 *   from(fetch('/api/data')),
 *   from(new Promise((_, reject) => 
 *     setTimeout(() => reject(new Error('Timeout')), 5000)
 *   ))
 * ]).toPromise();
 * ```
 * 
 * @example CDN failover
 * ```typescript
 * const result = await race([
 *   from(fetch('https://cdn1.example.com/file.jpg')),
 *   from(fetch('https://cdn2.example.com/file.jpg')),
 *   from(fetch('https://cdn3.example.com/file.jpg'))
 * ]).toPromise();
 * // Uses whichever CDN responds fastest
 * ```
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
 * Returns settled results for the first N futures from the input array. Slices the input to take
 * only the first `count` futures, then executes them with `allSettled()`. Useful when you don't
 * need all results but want more than just the fastest one.
 * 
 * @param futures - Futures or promises to execute
 * @param count - Number of futures to execute (takes first N from array)
 * @returns Future yielding settled results for first N futures
 * 
 * @example Load balance across mirrors
 * ```typescript
 * import { some, from } from "@okikio/future";
 * 
 * const mirrors = ['cdn1', 'cdn2', 'cdn3', 'cdn4', 'cdn5'].map(cdn =>
 *   from(fetch(`https://${cdn}.example.com/file.zip`))
 * );
 * 
 * const results = await some(mirrors, 3).toPromise();
 * const successful = results.filter(r => r.status === "fulfilled");
 * console.log(`Got ${successful.length} successful downloads`);
 * ```
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
 * Limits concurrent future execution to prevent resource exhaustion. Maintains a dynamic pool
 * where new futures start as old ones complete, never exceeding the specified limit.
 * 
 * Essential for rate limiting API calls, managing connection pools, or processing large batches
 * without overwhelming memory or system resources. Results are returned in completion order.
 * 
 * @param futures - Futures to execute with controlled concurrency
 * @param limit - Maximum number of futures running simultaneously
 * @returns Future yielding intermediate values, returning array of final results
 * 
 * @example Rate-limited API calls
 * ```typescript
 * import { withConcurrencyLimit, from } from "@okikio/future";
 * 
 * const futures = userIds.map(id =>
 *   from(async function* () {
 *     yield `Fetching user ${id}...`;
 *     return await fetch(`/api/users/${id}`).then(r => r.json());
 *   })
 * );
 * 
 * // Only 5 concurrent requests at once
 * const users = await withConcurrencyLimit(futures, 5).toPromise();
 * ```
 * 
 * @example Process files with memory constraints
 * ```typescript
 * const futures = imagePaths.map(path =>
 *   from(async function* () {
 *     const image = await loadImage(path);
 *     const processed = await processImage(image);
 *     await saveImage(processed);
 *     return path;
 *   })
 * );
 * 
 * // Only 3 images in memory at once
 * await withConcurrencyLimit(futures, 3).toPromise();
 * ```
 * 
 * @example Respect database connection limits
 * ```typescript
 * const futures = queries.map(sql =>
 *   from(db.query(sql))
 * );
 * 
 * // Use 80% of connection pool (e.g., 8 of 10)
 * const results = await withConcurrencyLimit(futures, 8).toPromise();
 * ```
 */
export function withConcurrencyLimit<T, TReturn = T, TNext = unknown>(
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

        const newFuture: Future<T, TReturn, TNext> = nextFuture.value;
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
