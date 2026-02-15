/**
 * Concurrency control for generator-based Futures.
 * 
 * These functions work like Promise utilities (`all`, `allSettled`, `race`) but leverage
 * the async generator foundation of Futures. This enables progress tracking through yields,
 * cancellation support, and resource management that Promises can't provide.
 * 
 * All functions accept both Futures and Promises - Promises are implicitly converted to
 * simple Futures that immediately return their value.
 * 
 * @module concurrency
 */

import { useDisposableStack } from "./disposal.ts";
import { Future } from "./future.ts";

/**
 * Runs multiple generator-based Futures concurrently, like `Promise.all()`.
 * 
 * Because Futures are built on async generators, this function can yield intermediate
 * values as futures complete, unlike Promise.all which only returns when everything finishes.
 * The generator foundation also enables cancellation - calling `.cancel()` on the returned
 * Future will cancel all pending futures.
 * 
 * Accepts both Futures and Promises. Promises are converted to simple Futures that yield
 * their resolved value once.
 * 
 * @param futures - Generator-based Futures or Promises to execute concurrently
 * @returns Future that yields each completed value, then returns array of all results
 * 
 * @example Simple Promise-like usage
 * ```typescript
 * import { all, from } from "@okikio/future";
 * 
 * const results = await all([
 *   from(fetch('/api/users')),
 *   from(fetch('/api/posts'))
 * ]).toPromise();
 * // Returns [users, posts]
 * ```
 * 
 * @example Track progress via yields
 * ```typescript
 * const futures = urls.map(url => 
 *   from(async function* () {
 *     yield `Fetching ${url}...`;
 *     return await fetch(url).then(r => r.json());
 *   })
 * );
 * 
 * // Generator foundation lets us see progress
 * for await (const status of all(futures)) {
 *   console.log(status);  // "Fetching http://...", actual data, ...
 * }
 * ```
 * 
 * @example Cancellation support from generators
 * ```typescript
 * const allFutures = all([future1, future2, future3]);
 * 
 * // Cancel all futures (generators support .return())
 * setTimeout(() => allFutures.cancel(), 1000);
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
 * Executes generator-based Futures concurrently, returning all settled results like `Promise.allSettled()`.
 * 
 * The async generator foundation enables unique capabilities: each Future's yields appear in the
 * result stream, and calling `.cancel()` on the returned Future propagates to all running generators.
 * Unlike Promise.allSettled, you can track progress and cancel even after starting.
 * 
 * Never rejects - always returns settled status for each Future. Accepts both Futures and Promises.
 * 
 * @param futures - Generator-based Futures or Promises to execute
 * @returns Future yielding settled results with status and value/reason
 * 
 * @example Promise-like usage
 * ```typescript
 * import { allSettled, from } from "@okikio/future";
 * 
 * const results = await allSettled([
 *   from(Promise.resolve(1)),
 *   from(Promise.reject(new Error("Failed"))),
 *   from(Promise.resolve(3))
 * ]).toPromise();
 * 
 * // All settled, even with failures
 * results.forEach(r => {
 *   if (r.status === "fulfilled") console.log(r.value);
 * });
 * ```
 * 
 * @example Generator capabilities - progress and cancellation
 * ```typescript
 * const futures = ids.map(id => 
 *   from(async function* (abort) {
 *     yield `Processing ${id}...`;
 *     abort.signal.throwIfAborted();  // Cancellable
 *     return await processItem(id);
 *   })
 * );
 * 
 * const batch = allSettled(futures);
 * 
 * // Track all yields (progress updates)
 * for await (const result of batch) {
 *   console.log(result);
 * }
 * 
 * // Or cancel mid-flight (generators can be stopped)
 * setTimeout(() => batch.cancel(), 5000);
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
 * Returns the first generator-based Future to complete, like `Promise.race()`.
 * 
 * The generator foundation means the returned Future can be cancelled (calling `.cancel()` will
 * propagate to all racing generators), and if any racing Future yields values, those appear in
 * the result stream before the final winner is determined.
 * 
 * @param futures - Generator-based Futures or Promises to race
 * @returns Future resolving/rejecting with first completed result
 * 
 * @example Simple timeout pattern
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
 * @example Generator capabilities - yields and cancellation
 * ```typescript
 * const racingFuture = race([
 *   from(async function* () {
 *     yield "Server 1 trying...";
 *     return await fetch('https://server1.com/data');
 *   }),
 *   from(async function* () {
 *     yield "Server 2 trying...";
 *     return await fetch('https://server2.com/data');
 *   })
 * ]);
 * 
 * // See which server responds (generators let us track this)
 * for await (const update of racingFuture) {
 *   console.log(update);  // "Server 1 trying...", then winner's data
 * }
 * 
 * // Cancel the race (generators can be stopped)
 * setTimeout(() => racingFuture.cancel(), 2000);
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
 * Returns settled results for the first N generator-based Futures.
 * 
 * Slices the input array to take the first `count` Futures, then executes them with `allSettled()`.
 * The generator foundation enables cancellation and progress tracking even for partial execution.
 * 
 * @param futures - Generator-based Futures or Promises
 * @param count - Number of futures to execute (takes first N from array)
 * @returns Future yielding settled results for first N futures
 * 
 * @example Load first 3 resources
 * ```typescript
 * import { some, from } from "@okikio/future";
 * 
 * const mirrors = ['cdn1', 'cdn2', 'cdn3', 'cdn4', 'cdn5'].map(cdn =>
 *   from(async function* () {
 *     yield `Trying ${cdn}...`;
 *     return await fetch(`https://${cdn}.example.com/file.zip`);
 *   })
 * );
 * 
 * // Only first 3 mirrors (generators let us see which)
 * const results = await some(mirrors, 3).toPromise();
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
 * Limits concurrent execution of generator-based Futures.
 * 
 * The async generator foundation is crucial here: maintains a dynamic pool where new generators
 * start as old ones complete via their return values. Each generator's yields appear in the output
 * stream, enabling real-time progress tracking. Calling `.cancel()` on the returned Future stops
 * all running generators via their `.return()` method.
 * 
 * Essential for rate limiting, managing connection pools, or preventing resource exhaustion.
 * Unlike Promise-based throttling, generators provide fine-grained control and visibility.
 * 
 * @param futures - Generator-based Futures to execute with controlled concurrency
 * @param limit - Maximum number of generators running simultaneously
 * @returns Future yielding all intermediate values, returning array of final results
 * 
 * @example Rate-limited API calls (Promise-like usage)
 * ```typescript
 * import { withConcurrencyLimit, from } from "@okikio/future";
 * 
 * const futures = userIds.map(id =>
 *   from(fetch(`/api/users/${id}`).then(r => r.json()))
 * );
 * 
 * // Only 5 concurrent requests (generators enforce this)
 * const users = await withConcurrencyLimit(futures, 5).toPromise();
 * ```
 * 
 * @example Generator capabilities - progress and control
 * ```typescript
 * const futures = imagePaths.map(path =>
 *   from(async function* (abort) {
 *     yield `Processing ${path}...`;           // Progress update
 *     abort.signal.throwIfAborted();           // Cancellable
 *     
 *     const image = await loadImage(path);
 *     yield `Loaded ${path}, processing...`;   // More progress
 *     
 *     const processed = await processImage(image);
 *     return `Completed ${path}`;              // Final result
 *   })
 * );
 * 
 * const batch = withConcurrencyLimit(futures, 3);
 * 
 * // Track every yield from all generators
 * for await (const status of batch) {
 *   console.log(status);  // Real-time progress!
 * }
 * 
 * // Or cancel mid-processing (stops all active generators)
 * setTimeout(() => batch.cancel(), 10000);
 * ```
 * 
 * @example Resource management via generator cleanup
 * ```typescript
 * const futures = files.map(file =>
 *   from(async function* (_, disposables) {
 *     const handle = await Deno.open(file);
 *     disposables.use(handle);  // Auto-cleanup on completion/cancel
 *     
 *     yield `Reading ${file}...`;
 *     return await handle.readAll();
 *   })
 * );
 * 
 * // Only 2 files open at once, auto-cleanup via generators
 * await withConcurrencyLimit(futures, 2).toPromise();
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
