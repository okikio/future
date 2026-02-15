/**
 * Concurrency control for managing multiple async operations.
 * 
 * These functions help you coordinate multiple pieces of async work (Futures or Promises).
 * They work like Promise utilities (`all`, `allSettled`, `race`) but with the control
 * benefits of Futures: cancellation, progress tracking, and resource management.
 * 
 * @module concurrency
 */

import { useDisposableStack } from "./disposal.ts";
import { Future } from "./future.ts";

/**
 * Runs multiple async operations concurrently, waits for all to complete.
 * 
 * Like `Promise.all()` - if any operation fails, the whole thing fails. But with Futures,
 * you can cancel all operations mid-flight, and track progress as each completes.
 * 
 * @param futures - Async operations (Futures or Promises) to run concurrently
 * @returns Future that completes when all operations finish
 * 
 * @example Basic concurrent execution
 * ```typescript
 * import { all, from } from "@okikio/future";
 * 
 * const results = await all([
 *   from(fetch('/api/users')),
 *   from(fetch('/api/posts')),
 *   from(fetch('/api/comments'))
 * ]).toPromise();
 * // All three requests run in parallel
 * ```
 * 
 * @example With cancellation
 * ```typescript
 * const batch = all([
 *   from(slowOperation1()),
 *   from(slowOperation2()),
 *   from(slowOperation3())
 * ]);
 * 
 * // Cancel all operations if taking too long
 * setTimeout(() => batch.cancel(), 5000);
 * 
 * try {
 *   await batch.toPromise();
 * } catch {
 *   console.log('Cancelled or failed');
 * }
 * ```
 * 
 * @example Track progress
 * ```typescript
 * const operations = urls.map(url => 
 *   from(async function* () {
 *     yield `Fetching ${url}...`;
 *     return await fetch(url).then(r => r.json());
 *   })
 * );
 * 
 * // See progress from each operation
 * for await (const update of all(operations)) {
 *   console.log(update);
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
 * Runs multiple async operations concurrently, returns results for all (even failures).
 * 
 * Like `Promise.allSettled()` - never rejects, always tells you what happened to each operation.
 * With Futures, you can cancel the whole batch mid-flight and track progress.
 * 
 * Perfect for batch operations where some failures are acceptable.
 * 
 * @param futures - Async operations (Futures or Promises) to run
 * @returns Future with settled results (success or failure) for each operation
 * 
 * @example Handle partial failures
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
 *   if (r.status === "fulfilled") {
 *     console.log('Success:', r.value);
 *   } else {
 *     console.error('Failed:', r.reason);
 *   }
 * });
 * ```
 * 
 * @example Batch processing with error tracking
 * ```typescript
 * const operations = userIds.map(id => 
 *   from(fetch(`/api/users/${id}`).then(r => r.json()))
 * );
 * 
 * const results = await allSettled(operations).toPromise();
 * const succeeded = results.filter(r => r.status === "fulfilled");
 * 
 * console.log(`Processed ${succeeded.length}/${results.length} successfully`);
 * ```
 * 
 * @example Cancellable batch
 * ```typescript
 * const batch = allSettled([...manyOperations]);
 * 
 * // Cancel the whole batch if needed
 * setTimeout(() => batch.cancel(), 10000);
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
 * Returns the first async operation to complete (success or failure).
 * 
 * Like `Promise.race()` - whichever finishes first wins. With Futures, you can cancel
 * the race mid-flight.
 * 
 * Perfect for timeout patterns, failover strategies, or taking the fastest response.
 * 
 * @param futures - Async operations (Futures or Promises) to race
 * @returns Future that completes with first result
 * 
 * @example Timeout pattern
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
 * @example Fastest server wins
 * ```typescript
 * const result = await race([
 *   from(fetch('https://server1.com/data')),
 *   from(fetch('https://server2.com/data')),
 *   from(fetch('https://server3.com/data'))
 * ]).toPromise();
 * // Uses whichever responds first
 * ```
 * 
 * @example Cancellable race
 * ```typescript
 * const racing = race([operation1, operation2, operation3]);
 * 
 * // Cancel the race if user navigates away
 * window.addEventListener('beforeunload', () => racing.cancel());
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
 * Returns results for the first N async operations.
 * 
 * Takes the first `count` operations from the array and runs them with `allSettled()`.
 * Useful when you want some results but not all.
 * 
 * @param futures - Async operations (Futures or Promises)
 * @param count - How many to execute (takes first N from array)
 * @returns Future with settled results for first N operations
 * 
 * @example Sample subset of work
 * ```typescript
 * import { some, from } from "@okikio/future";
 * 
 * const mirrors = ['cdn1', 'cdn2', 'cdn3', 'cdn4', 'cdn5'].map(cdn =>
 *   from(fetch(`https://${cdn}.example.com/file.zip`))
 * );
 * 
 * // Only try first 3 mirrors
 * const results = await some(mirrors, 3).toPromise();
 * const successful = results.filter(r => r.status === "fulfilled");
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
 * Runs async operations with a concurrency limit.
 * 
 * Controls how many operations run at once - as each finishes, the next starts. Essential
 * for rate limiting, managing connection pools, or preventing resource exhaustion.
 * 
 * With Futures, you can track progress of each operation and cancel the whole batch.
 * 
 * @param futures - Async operations (Futures or Promises) to run
 * @param limit - Maximum number running at once
 * @returns Future that completes when all operations finish
 * 
 * @example Rate-limited API calls
 * ```typescript
 * import { withConcurrencyLimit, from } from "@okikio/future";
 * 
 * const operations = userIds.map(id =>
 *   from(fetch(`/api/users/${id}`).then(r => r.json()))
 * );
 * 
 * // Only 5 requests at a time
 * const users = await withConcurrencyLimit(operations, 5).toPromise();
 * ```
 * 
 * @example Track progress
 * ```typescript
 * const operations = imagePaths.map(path =>
 *   from(async function* () {
 *     yield `Processing ${path}...`;
 *     const image = await loadImage(path);
 *     const processed = await processImage(image);
 *     await saveImage(processed);
 *     return `Done: ${path}`;
 *   })
 * );
 * 
 * const batch = withConcurrencyLimit(operations, 3);
 * 
 * // Track each operation's progress
 * for await (const status of batch) {
 *   updateUI(status);
 * }
 * ```
 * 
 * @example Cancellable batch processing
 * ```typescript
 * const batch = withConcurrencyLimit(operations, 10);
 * 
 * // Cancel all (including queued operations)
 * setTimeout(() => batch.cancel(), 30000);
 * ```
 * 
 * @example Resource management
 * ```typescript
 * const operations = files.map(file =>
 *   from(async function* (_, disposables) {
 *     const handle = await Deno.open(file);
 *     disposables.use(handle);  // Auto-cleanup
 *     
 *     yield `Reading ${file}...`;
 *     return await handle.readAll();
 *   })
 * );
 * 
 * // Only 2 files open at once
 * await withConcurrencyLimit(operations, 2).toPromise();
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
