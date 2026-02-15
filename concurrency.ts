import { useDisposableStack } from "./disposal.ts";
import { Future } from "./future.ts";

/**
 * Runs multiple Futures concurrently and waits for all to complete, similar to `Promise.all()`.
 * 
 * ## What This Does
 * 
 * Think of `all()` as running multiple tasks at the same time and collecting all their results.
 * Like sending multiple HTTP requests in parallel instead of one-by-one - much faster!
 * 
 * ### Key Characteristics:
 * - **Concurrent Execution**: All futures start immediately and run in parallel
 * - **All or Nothing**: If any future rejects, the entire operation fails (like `Promise.all`)
 * - **Order Preserved**: Results are returned in the same order as input, regardless of completion order
 * - **Yields Incrementally**: Each result is yielded as it completes, then all are returned together
 * 
 * ### When to Use:
 * - Fetching multiple independent API endpoints
 * - Processing multiple files in parallel
 * - Running multiple database queries concurrently
 * - Any scenario where you need all results and want maximum speed
 * 
 * ## Understanding Concurrency
 * 
 * ```
 * Sequential (slow):        Concurrent (fast):
 * Task A: [====]            Task A: [====]
 * Task B:       [====]      Task B: [====]
 * Task C:             [==]  Task C: [==]
 * Total: ~10s               Total: ~4s
 * ```
 * 
 * @param futures - An iterable of `Future` or `PromiseLike` objects to execute concurrently
 * @returns A Future that yields each completed result, then returns an array of all results in order
 * 
 * @example Basic usage
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
 * console.log(results); // [users, posts, comments] in order
 * ```
 * 
 * @example Monitoring progress
 * ```typescript
 * const futures = urls.map(url => from(fetch(url)));
 * 
 * for await (const result of all(futures)) {
 *   console.log('Got result:', result);
 * }
 * ```
 * 
 * @example With different types
 * ```typescript
 * const results = await all([
 *   from(Promise.resolve(42)),
 *   from(Promise.resolve("hello")),
 *   from(Promise.resolve(true))
 * ]).toPromise();
 * 
 * // results: [42, "hello", true]
 * ```
 * 
 * @example Error handling
 * ```typescript
 * try {
 *   await all([
 *     from(Promise.resolve(1)),
 *     from(Promise.reject(new Error("Failed!"))),
 *     from(Promise.resolve(3))
 *   ]).toPromise();
 * } catch (error) {
 *   console.error("One future failed:", error);
 *   // The whole operation fails
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
 * Executes multiple futures concurrently and returns ALL settled results (both successes and failures).
 * 
 * ## What This Does
 * 
 * Unlike `all()` which fails if ANY future fails, `allSettled()` is the reliable friend who
 * waits for everyone and tells you exactly what happened to each one - successes AND failures.
 * 
 * ### Key Characteristics:
 * - **Never Rejects**: Always succeeds, even if some futures fail
 * - **Complete Picture**: Returns status for every future (fulfilled or rejected)
 * - **Fault Tolerant**: One failure doesn't stop the others
 * - **Detailed Results**: Get both successful values and error reasons
 * 
 * ### When to Use:
 * - Batch operations where some failures are acceptable
 * - Multiple independent API calls where partial success is useful
 * - Data synchronization where you need to know what succeeded/failed
 * - Cleanup operations where you want to try everything
 * 
 * ## Result Structure
 * 
 * Each result is one of:
 * ```typescript
 * // Success
 * { status: "fulfilled", value: T }
 * 
 * // Failure
 * { status: "rejected", reason: Error }
 * ```
 * 
 * @param futures - An iterable of `Future` or `PromiseLike` objects
 * @returns A Future yielding settled results with status and value/reason
 * 
 * @example Basic usage with mixed results
 * ```typescript
 * import { allSettled, from } from "@okikio/future";
 * 
 * const results = await allSettled([
 *   from(Promise.resolve(1)),
 *   from(Promise.reject(new Error("Failed!"))),
 *   from(Promise.resolve(3))
 * ]).toPromise();
 * 
 * results.forEach((result, index) => {
 *   if (result.status === "fulfilled") {
 *     console.log(`Task ${index}: Success -`, result.value);
 *   } else {
 *     console.error(`Task ${index}: Failed -`, result.reason);
 *   }
 * });
 * 
 * // Output:
 * // Task 0: Success - 1
 * // Task 1: Failed - Error: Failed!
 * // Task 2: Success - 3
 * ```
 * 
 * @example Batch API calls with error handling
 * ```typescript
 * const userIds = [1, 2, 999, 4]; // 999 doesn't exist
 * 
 * const futures = userIds.map(id => 
 *   from(fetch(`/api/users/${id}`).then(r => r.json()))
 * );
 * 
 * const results = await allSettled(futures).toPromise();
 * 
 * const succeeded = results.filter(r => r.status === "fulfilled");
 * const failed = results.filter(r => r.status === "rejected");
 * 
 * console.log(`Loaded ${succeeded.length} users`);
 * console.log(`Failed to load ${failed.length} users`);
 * ```
 * 
 * @example File processing with partial failures
 * ```typescript
 * const files = ['file1.txt', 'missing.txt', 'file3.txt'];
 * 
 * const futures = files.map(file => 
 *   from(Deno.readTextFile(file))
 * );
 * 
 * for await (const result of allSettled(futures)) {
 *   if (result.status === "fulfilled") {
 *     processFileContent(result.value);
 *   } else {
 *     logError(`File read failed: ${result.reason}`);
 *   }
 * }
 * ```
 * 
 * @example Cleanup operations
 * ```typescript
 * // Close all connections, log failures
 * const connections = [db1, db2, db3];
 * 
 * const futures = connections.map(conn => 
 *   from(conn.close())
 * );
 * 
 * const results = await allSettled(futures).toPromise();
 * 
 * const failedCloses = results.filter(r => r.status === "rejected");
 * if (failedCloses.length > 0) {
 *   console.warn(`${failedCloses.length} connections failed to close properly`);
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
 * Returns the first Future to complete (resolve or reject), like a race between competitors.
 * 
 * ## What This Does
 * 
 * Imagine multiple runners starting a race - `race()` gives you the result of whoever crosses
 * the finish line first, whether they succeed or fail. The others keep running but you don't
 * wait for them.
 * 
 * ### Key Characteristics:
 * - **First Wins**: Returns as soon as ANY future completes (success or failure)
 * - **Fast Response**: Perfect for timeout scenarios or fallback strategies
 * - **Others Continue**: Losing futures keep running (but you don't wait for them)
 * - **No Guarantee**: Could be success or error depending on which finishes first
 * 
 * ### When to Use:
 * - Request timeout fallbacks (try primary, fallback to secondary)
 * - CDN failover (fastest server wins)
 * - User responsiveness (show loading spinner after 200ms)
 * - Multiple data sources (use whichever responds first)
 * 
 * ## Race Visualization
 * 
 * ```
 * Future A: [========] (slow)
 * Future B: [===] (fast - wins!)
 * Future C: [======] (medium)
 * 
 * Result: B's value returned immediately
 * ```
 * 
 * @param futures - An iterable of `Future` or `PromiseLike` objects to race
 * @returns A Future that resolves/rejects with the first future to complete
 * 
 * @example Request with timeout
 * ```typescript
 * import { race, from } from "@okikio/future";
 * 
 * const dataFuture = from(fetch('/api/data'));
 * const timeoutFuture = from(new Promise((_, reject) => 
 *   setTimeout(() => reject(new Error('Timeout!')), 5000)
 * ));
 * 
 * try {
 *   const result = await race([dataFuture, timeoutFuture]).toPromise();
 *   console.log('Got data:', result);
 * } catch (error) {
 *   console.error('Request timed out or failed');
 * }
 * ```
 * 
 * @example CDN fallback
 * ```typescript
 * const result = await race([
 *   from(fetch('https://cdn1.example.com/image.jpg')),
 *   from(fetch('https://cdn2.example.com/image.jpg')),
 *   from(fetch('https://cdn3.example.com/image.jpg'))
 * ]).toPromise();
 * 
 * // Uses whichever CDN responds first
 * ```
 * 
 * @example Loading spinner after delay
 * ```typescript
 * const loadingFuture = from(new Promise(resolve => 
 *   setTimeout(() => resolve('show-spinner'), 200)
 * ));
 * 
 * const dataFuture = from(fetchData());
 * 
 * const result = await race([loadingFuture, dataFuture]).toPromise();
 * 
 * if (result === 'show-spinner') {
 *   showSpinner();
 *   await dataFuture.toPromise();
 * }
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
 * Gets results from the first N futures to complete, useful for "best of N" scenarios.
 * 
 * ## What This Does
 * 
 * Think of it as a race where you only care about the top N finishers. Perfect for when you
 * need multiple results but don't want to wait for ALL futures to complete.
 * 
 * ### Key Characteristics:
 * - **Partial Results**: Get first N results, ignore the rest
 * - **Faster Than All**: Don't wait for slow stragglers
 * - **Maintains Order**: Results in input order (uses `allSettled` under the hood)
 * - **Includes Failures**: Returns settled results (both successes and failures)
 * 
 * ### When to Use:
 * - Load balancing across mirrors (first 3 successful downloads)
 * - Redundant requests (whichever 2 respond first)
 * - Sampling (test first 5 servers, not all 100)
 * - Quick validation (need confirmation from 2 out of 5 sources)
 * 
 * ## How It Works
 * 
 * ```
 * Input: [F1, F2, F3, F4, F5], count=3
 * 
 * Takes first 3: [F1, F2, F3]
 * Ignores rest: [F4, F5]
 * 
 * Returns settled results of [F1, F2, F3]
 * ```
 * 
 * @param futures - An iterable of `Future` or `PromiseLike` objects
 * @param count - Number of futures to wait for (takes first N from array)
 * @returns A Future yielding the first `count` settled results
 * 
 * @example Get first 3 results
 * ```typescript
 * import { some, from } from "@okikio/future";
 * 
 * const mirrors = [
 *   'cdn1.example.com',
 *   'cdn2.example.com',
 *   'cdn3.example.com',
 *   'cdn4.example.com',
 *   'cdn5.example.com'
 * ];
 * 
 * const futures = mirrors.map(url => 
 *   from(fetch(`https://${url}/file.zip`))
 * );
 * 
 * // Only wait for first 3
 * const results = await some(futures, 3).toPromise();
 * 
 * const successful = results.filter(r => r.status === "fulfilled");
 * console.log(`Got ${successful.length} successful downloads`);
 * ```
 * 
 * @example Redundant API calls
 * ```typescript
 * // Call 5 servers, use first 2 responses
 * const servers = ['us', 'eu', 'asia', 'au', 'sa'];
 * 
 * const futures = servers.map(region => 
 *   from(fetch(`https://api-${region}.example.com/data`))
 * );
 * 
 * const firstTwo = await some(futures, 2).toPromise();
 * 
 * // Use whichever 2 responded (even if others faster)
 * for (const result of firstTwo) {
 *   if (result.status === "fulfilled") {
 *     processData(result.value);
 *   }
 * }
 * ```
 * 
 * @example Sampling check
 * ```typescript
 * // Test 5 out of 100 servers
 * const allServers = [...]; // 100 servers
 * const sampleSize = 5;
 * 
 * const futures = allServers.map(server => 
 *   from(healthCheck(server))
 * );
 * 
 * const sample = await some(futures, sampleSize).toPromise();
 * 
 * const healthy = sample.filter(r => 
 *   r.status === "fulfilled" && r.value.ok
 * );
 * 
 * console.log(`${healthy.length}/${sampleSize} servers healthy`);
 * ```
 * 
 * @example Handle edge cases
 * ```typescript
 * // If count > array length, returns all
 * const results = await some([f1, f2], 10).toPromise();
 * // Returns 2 results, not 10
 * 
 * // If count = 0, returns empty array
 * const empty = await some([f1, f2], 0).toPromise();
 * // Returns []
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
 * Controls concurrent execution by limiting how many futures can run simultaneously.
 * 
 * ## What This Does
 * 
 * Imagine a restaurant with limited tables - `withConcurrencyLimit()` is like the host who ensures
 * you never seat more than N parties at once. As parties leave (futures complete), new ones are
 * seated (new futures start), maintaining steady throughput without overwhelming resources.
 * 
 * ### The Concurrency Problem
 * 
 * Running too many operations at once can:
 * - Overwhelm servers (rate limiting, timeouts)
 * - Exhaust memory (too many pending requests)
 * - Trigger resource limits (open file handles, connections)
 * - Cause browser tab crashes (too many network requests)
 * 
 * ### Key Characteristics:
 * - **Dynamic Pool**: Maintains exactly `limit` active futures (or fewer near the end)
 * - **Queue Management**: Automatically starts new futures as old ones complete
 * - **Resource Friendly**: Prevents overwhelming system resources
 * - **Progress Tracking**: Yields intermediate values as futures execute
 * - **Completion Order**: Final results in order of completion (not input order)
 * 
 * ### When to Use:
 * - API rate limiting (e.g., "max 5 requests/second")
 * - Batch file processing (prevent too many open files)
 * - Database connection pools (limited connections)
 * - Resource-intensive operations (image processing, video encoding)
 * - Preventing browser tab crashes (too many simultaneous fetches)
 * 
 * ## Concurrency Visualization
 * 
 * ```
 * Limit = 2, 5 total futures:
 * 
 * Time →
 * F1: [====]
 * F2: [=====]
 * F3:       [===]    ← Waits for F1
 * F4:            [====] ← Waits for F2
 * F5:                [==] ← Waits for F3
 * 
 * Never more than 2 running at once!
 * ```
 * 
 * ## How It Works (Step by Step)
 * 
 * 1. Start first `limit` futures immediately
 * 2. When any future completes:
 *    - Yield its intermediate values
 *    - Store its final result
 *    - Start the next queued future
 * 3. Repeat until all futures complete
 * 4. Return array of all final results
 * 
 * @template T - The type yielded by futures during execution
 * @template TReturn - The type returned by futures when complete
 * @template TNext - The type for pull-based iteration (advanced)
 * 
 * @param futures - An iterable of `Future` objects to execute
 * @param limit - Maximum number of futures to run concurrently
 * @returns A Future yielding intermediate values and returning final results array
 * 
 * @example Rate-limited API calls
 * ```typescript
 * import { withConcurrencyLimit, from } from "@okikio/future";
 * 
 * // 100 API calls, but only 5 at a time
 * const userIds = Array.from({ length: 100 }, (_, i) => i + 1);
 * 
 * const futures = userIds.map(id =>
 *   from(async function* () {
 *     yield `Fetching user ${id}...`;
 *     const response = await fetch(`/api/users/${id}`);
 *     return await response.json();
 *   })
 * );
 * 
 * // Only 5 concurrent requests at any time
 * const limited = withConcurrencyLimit(futures, 5);
 * 
 * // Monitor progress
 * for await (const status of limited) {
 *   console.log(status); // "Fetching user 1...", etc.
 * }
 * 
 * const allUsers = await limited.toPromise();
 * console.log(`Loaded ${allUsers.length} users`);
 * ```
 * 
 * @example File processing with memory limits
 * ```typescript
 * // Process 1000 images, 3 at a time (memory constraint)
 * const imagePaths = [...]; // 1000 paths
 * 
 * const futures = imagePaths.map(path =>
 *   from(async function* () {
 *     yield `Processing ${path}...`;
 *     
 *     const image = await loadImage(path);
 *     const processed = await processImage(image);
 *     await saveImage(processed);
 *     
 *     return `Completed ${path}`;
 *   })
 * );
 * 
 * // Only 3 images in memory at once
 * const results = await withConcurrencyLimit(futures, 3).toPromise();
 * console.log('All images processed');
 * ```
 * 
 * @example Database operations with connection pool
 * ```typescript
 * // Database has 10 connection limit
 * const queries = [
 *   'SELECT * FROM users',
 *   'SELECT * FROM posts',
 *   'SELECT * FROM comments',
 *   // ... 100 queries
 * ];
 * 
 * const futures = queries.map(sql =>
 *   from(async function* () {
 *     yield `Executing: ${sql}`;
 *     const result = await db.query(sql);
 *     return result.rows;
 *   })
 * );
 * 
 * // Respect connection pool limit
 * const limited = withConcurrencyLimit(futures, 8); // 8 < 10 (safety margin)
 * 
 * const allResults = await limited.toPromise();
 * ```
 * 
 * @example Web scraping with politeness
 * ```typescript
 * // Scrape 1000 pages from a website
 * // Limit to 2 concurrent requests to be polite
 * const urls = [...]; // 1000 URLs
 * 
 * const futures = urls.map(url =>
 *   from(async function* () {
 *     yield `Scraping ${url}...`;
 *     
 *     const response = await fetch(url);
 *     const html = await response.text();
 *     const data = parseHTML(html);
 *     
 *     // Respect robots.txt delay
 *     await new Promise(resolve => setTimeout(resolve, 1000));
 *     
 *     return data;
 *   })
 * );
 * 
 * // Only 2 concurrent requests (be nice to servers!)
 * const results = await withConcurrencyLimit(futures, 2).toPromise();
 * ```
 * 
 * @example Progress tracking with limit
 * ```typescript
 * const futures = items.map(item =>
 *   from(async function* () {
 *     yield { status: 'processing', item };
 *     const result = await process(item);
 *     return { status: 'complete', item, result };
 *   })
 * );
 * 
 * let completed = 0;
 * const total = items.length;
 * 
 * const limited = withConcurrencyLimit(futures, 10);
 * 
 * for await (const update of limited) {
 *   if (update.status === 'processing') {
 *     console.log(`Progress: ${completed}/${total}`);
 *   }
 * }
 * 
 * const final = await limited.toPromise();
 * console.log('All complete!', final);
 * ```
 * 
 * ## Performance Comparison
 * 
 * For 10 futures that each take 1 second:
 * - **Sequential** (limit=1): ~10 seconds
 * - **Limited** (limit=3): ~4 seconds
 * - **Unlimited** (all()): ~1 second (but may crash!)
 * 
 * Choose limit based on:
 * - Server rate limits
 * - Memory constraints
 * - Connection pools
 * - CPU cores
 * - Network bandwidth
 * 
 * ## Common Patterns
 * 
 * ```typescript
 * // API rate limit: 10 requests/second
 * withConcurrencyLimit(futures, 10)
 * 
 * // CPU-bound: Number of cores
 * withConcurrencyLimit(futures, navigator.hardwareConcurrency || 4)
 * 
 * // Memory-bound: Conservative limit
 * withConcurrencyLimit(futures, 5)
 * 
 * // Connection pool: 80% of max
 * withConcurrencyLimit(futures, Math.floor(maxConnections * 0.8))
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
