import { cancelIdle, idle } from "./idle.ts";
import { isAsyncIterable, isAsyncIterator, isIterable } from "./utils.ts";

export class CancellationError extends Error {
  constructor() {
    super("Future was canceled");
  }
}

export const Status = {
  Idle: 0,
  Running: 1,
  Paused: 2,
  Completed: 3,
  Cancelled: 4,
  Destroyed: -1,
}

export type StatusEnum = typeof Status[keyof typeof Status];

/**
 * The `Future` class is a more powerful and flexible alternative to JavaScript's native `Promise`, 
 * designed to address several weaknesses of Promises such as lack of cancellation, limited concurrency control, and
 * inability to pause/resume tasks. `Future` instances are cancellable, pausable, compositional, and structured for 
 * concurrency management.
 *
 * ## Key Features
 *
 * - **Pausable**: Execution can be paused and resumed at will, giving precise control over flow.
 * - **Cancellable**: Futures can be cancelled at any point.
 * - **Background Execution**: You can prepare Futures for background execution with the `inBackground` method.
 * - **Compositional**: Chain, sequence, and compose multiple futures with ease.
 * - **Advanced Concurrency Control**: Supports throttling, limiting concurrency, and structured concurrency.
 * 
 * ## Usage Examples
 *
 * ### Simple Future Creation
 * ```typescript
 * const future = Future.fromOperation(async function* () {
 *   yield 42; // Pauses and returns 42
 *   return 100; // Completes and returns 100
 * });
 * 
 * console.log(await future.toPromise()); // Logs 100
 * ```
 *
 * ### Pausing and Resuming
 * ```typescript
 * const future = Future.fromOperation(async function* () {
 *   yield 1;
 *   yield 2;
 *   return 3;
 * });
 * 
 * future.pause();
 * setTimeout(() => future.resume(), 1000);
 * 
 * for await (const value of future) {
 *   console.log(value); // Logs 1, 2, then 3
 * }
 * ```
 *
 * ### Running in the Background
 * ```typescript
 * const backgroundFuture = Future.inBackground(Future.fromOperation(async function* () {
 *   yield 1;
 *   return 2;
 * }));
 * 
 * console.log(await backgroundFuture.toPromise()); // Executes in idle time, returns 2
 * ```
 * 
 * @template T - The type of the value that the future will resolve to.
 */
export class Future<T, TReturn = unknown, TNext = unknown> implements PromiseLike<TReturn> {
  #generator?: AsyncGenerator<T, TReturn, TNext> | null;
  #operation?: ((signal: AbortSignal) => AsyncGenerator<T, TReturn, TNext>) | null;
  #status: StatusEnum = Status.Idle;
  readonly #resolvers = {
    pause: Promise.withResolvers<void>(),
    complete: Promise.withResolvers<void>(),
    abort: new AbortController(),
  }

  static #EventHandler = class PrivateEventHandler<T, TReturn, TNext> {
    #delegate: Future<T, TReturn, TNext> | undefined | null;
    constructor(delegate?: Future<T, TReturn, TNext>) {
      this.#delegate = delegate;
    }

    handleEvent(event: Event) {
      if (this.#delegate) {
        this.#delegate.#handleEvent(event);
      }
    }

    destroy() {
      this.#delegate = null;
    }
  }

  #eventhandler = new Future.#EventHandler(this);

  /**
   * Creates a new `Future` instance.
   * @param operation - A function that returns an async generator to define the asynchronous task.
   */
  constructor(operation: (signal: AbortSignal) => AsyncGenerator<T, TReturn, TNext>) {
    this.#operation = operation;
    this.#setup();

    this.#generator = this.#operation?.(this.#resolvers.abort?.signal);
  }

  #setup() {
    this.#resolvers.abort?.signal?.removeEventListener?.("abort", this.#eventhandler);

    Object.assign(this.#resolvers, {
      pause: Promise.withResolvers<void>(),
      complete: Promise.withResolvers<void>(),
      abort: new AbortController(),
    });

    this.#resolvers.abort?.signal?.addEventListener?.("abort", this.#eventhandler);
    this.#resolvers.complete?.promise?.finally?.(() => (this.#status = Status.Completed));

    const rotatingResolver = () => {
      this.#status = Status.Running;
      this.#resolvers.pause = Promise.withResolvers<void>();
      this.#resolvers.pause?.promise?.then?.(rotatingResolver);
    }

    this.#resolvers.pause?.promise?.then?.(rotatingResolver);
    this.#status = Status.Idle;
  }

  #handleEvent(event: Event) {
    if (event.type === "abort") {
      this.#status = Status.Cancelled;
      this.#resolvers?.pause?.reject?.(this.#reason);
      this.#resolvers?.complete?.reject?.(this.#reason);
    }
  }

  get #reason() {
    return this.#resolvers.abort?.signal?.reason;
  }

  isCancelled() {
    return this.#status === Status.Cancelled;
  }

  isPaused() {
    return this.#status === Status.Paused;
  }

  isComplete() {
    return this.#status === Status.Completed;
  }

  isRunning() {
    return this.#status === Status.Running;
  }

  isDestroyed() {
    return this.#status === Status.Destroyed;
  }

  isIdle() {
    return this.#status === Status.Idle;
  }

  paused() {
    return this.#resolvers.pause.promise;
  }

  completed() {
    return this.#resolvers.complete.promise;
  }

  /**
   * Cancels the future, preventing further execution. 
   * @example
   * ```typescript
   * const future = Future.fromOperation(async function* () {
   *   yield 42;
   *   return 100;
   * });
   * future.cancel(); // Aborts future execution
   * ```
   */
  cancel() {
    this.#resolvers?.abort?.abort?.(new CancellationError());
    return this;
  }

  /**
   * Pauses the execution of the future.
   * @example
   * ```typescript
   * const future = Future.fromOperation(async function* () {
   *   yield 42;
   *   return 100;
   * });
   * future.pause(); // Pauses future execution
   * ```
   */
  pause() {
    if (!this.isPaused()) {
      this.#status = Status.Paused;
    }
    return this;
  }

  /**
   * Resumes a paused future.
   * @example
   * ```typescript
   * const future = Future.fromOperation(async function* () {
   *   yield 42;
   *   return 100;
   * });
   * future.resume(); // Resumes future execution
   * ```
   */
  resume() {
    if (this.isPaused()) {
      this.#resolvers?.pause?.resolve?.();
    }
    return this;
  }

  /**
   * Resets the future for re-execution, allowing it to run from the beginning.
   * This can only be done if the future is complete.
   * @throws Error if the future is not complete.
   * @example
   * ```typescript
   * const future = Future.fromOperation(async function* () {
   *   yield 42;
   *   return 100;
   * });
   * await future.toPromise(); // Completes the future
   * future.reset(); // Resets the future for reuse
   * ```
   */
  reset() {
    if (this.isDestroyed()) {
      throw new Error("Cannot reset a destroyed future");
    }

    if (!this.isComplete()) {
      throw new Error("Cannot reset an incomplete future");
    }

    this.#setup();
    this.#generator = this.#operation?.(this.#resolvers.abort?.signal);
    return this;
  }

  destroy() {
    this.cancel();

    this.#resolvers.abort?.signal?.removeEventListener?.("abort", this.#eventhandler);
    this.#eventhandler?.destroy?.();

    // @ts-ignore Resetting private properties
    this.#eventhandler = null as unknown;

    Object.assign(this.#resolvers, {
      pause: null,
      complete: null,
      abort: null,
    });

    this.#generator = null;
    this.#operation = null;

    this.#status = Status.Destroyed;
  }

  /**
   * Implements the async iterator protocol, allowing futures to be used in `for await...of` loops.
   * 
   * This method is designed to support both **push-based** and **pull-based** workflows, 
   * where values can either be automatically yielded by the generator or "pulled" from it via external input.
   * 
   * ### Key Concepts to Understand:
   * 
   * **Iterators and Iterables**:
   * - An **iterator** is an object that defines a sequence of values, typically with a `.next()` method.
   * - An **iterable** is an object that implements the `Symbol.iterator` method, returning an iterator.
   * - **Async iterators** are similar to iterators but involve asynchronous operations (using `Promise`).
   * - **for await...of loops** allow you to consume async iterators just like regular iterators but in an asynchronous context.
   * 
   * **next() and yield**:
   * - The `yield` keyword pauses a generator and returns a value to the outside world.
   * - The `next()` method resumes the generator and can **both send a value in** and **receive the next yielded value**.
   * - The confusing part: `yield` can be the value that `next()` returns, and the input passed into `next()` can be used as the value of the last `yield`.
   * 
   * In essence, each call to `next()` resumes the generator from where it last left off, and the value passed to `next()` can be accessed within the generator.
   * 
   * ### Push-Based Workflow:
   * The generator automatically yields values in a push-based workflow, so the consumer doesn't need to send any input.
   * 
   * @example Push-Based Workflow
   * ```typescript
   * // Push-based async generator example
   * const future = Future.fromOperation(async function* () {
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
   * ### Pull-Based Workflow:
   * In a pull-based workflow, the generator waits for input via `next()`. The generator will only proceed when `next()` is called.
   * 
   * @example Pull-Based Workflow
   * ```typescript
   * // Pull-based async generator example
   * const future = Future.fromOperation(async function* () {
   *   let result = { value: 1, done: false };
   *   
   *   // Wait for external input before proceeding
   *   while (!result.done) {
   *     result = await (yield result.value);
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
   * ### Breakdown of the Code:
   * 
   * **Push-Based**: 
   * - The generator automatically yields values, and the consumer just needs to await those values.
   * - Example: A generator yielding values without expecting input.
   * 
   * **Pull-Based**:
   * - The generator waits for input from the consumer using the `yield` keyword.
   * - The consumer controls when the next value is processed by passing in data via `next()`.
   * 
   * ### Advanced Concepts:
   * 
   * - **Priming the Generator**: 
   *   - We prime the generator by calling `next()` once before the loop starts. This ensures the generator is ready to receive input.
   * - **Handling Pauses and Cancellation**: 
   *   - If the future is paused, the generator will wait until it's resumed.
   *   - If the future is canceled, an error will be thrown.
   * 
   * @yields The values generated by the future.
   */
  async *[Symbol.asyncIterator](): AsyncGenerator<T, TReturn, TNext> {
    let err: unknown;
    try {
      if (!this.#generator || typeof this.#generator?.next !== "function") {
        throw new Error("generator not defined");
      }

      // Prime the generator by starting the iteration process
      let result = await this.#generator?.next?.();

      // Continue yielding values until the generator completes
      while (!result?.done) {
        if (this.isCancelled()) throw this.#reason;

        // Handle pausing by awaiting the pause resolver
        if (this.isPaused()) {
          await this.#resolvers.pause?.promise;
          continue;
        }

        // Set status to running
        if (this.#status !== Status.Running) {
          this.#status = Status.Running;
        }

        // Yield the value to the consumer and wait for the next input
        result = await this.#generator?.next?.(yield result?.value);
      }

      // Return the final value once iteration completes
      return result?.value;
    } catch (error) {
      // Handle errors during iteration
      throw (err = error);
    } finally {
      // Resolve or reject based on the completion state
      if (err) this.#resolvers.complete?.reject?.(err);
      else this.#resolvers.complete?.resolve?.();
    }
  }

  [Symbol.dispose]() { 
    this.destroy();
  }

  /**
   * Converts the future into a promise and waits for its resolution.
   * Includes support for control flow operations including pausing, cancelling, and more...
   * 
   * @returns A promise that resolves to the final result of the future. 
   * If the generator does not have an explicit return, it will return undefined.
   * @example
   * ```typescript
   * const future = Future.fromOperation(async function* () {
   *   yield 42;
   *   // No explicit return, so the final result will be undefined
   * });
   * const result = await future.toPromise(); // result is undefined
   * ```
   */
  async toPromise(): Promise<TReturn> {
    let result: IteratorResult<T, TReturn>;
    const generator = this[Symbol.asyncIterator]();

    // Iterate through the generator until completion
    do {
      result = await generator.next();
    } while (!result.done);

    // If the generator has no explicit return, result.value will be undefined
    return result.value;
  }

  /**
   * `then` method to allow Future to be used with `await` and promise chaining.
   * @param onfulfilled Called when the future resolves successfully.
   * @param onrejected Called when the future is rejected.
   * @returns A promise that resolves with the result of the future.
   */
  then<TResult1 = TReturn, TResult2 = never>(
    onfulfilled?: ((value: TReturn) => TResult1 | PromiseLike<TResult1>) | undefined | null, 
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2> {
    return this.toPromise().then(onfulfilled, onrejected);
  }

  /**
   * `catch` method to handle rejections.
   * @param onrejected A callback that handles the rejection reason.
   * @returns A promise that resolves or rejects based on the future's outcome.
   */
  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | undefined | null
  ): Promise<TReturn | TResult> {
    return this.toPromise().catch(onrejected);
  }

  /**
   * `finally` method to allow adding a cleanup step after the future resolves or rejects.
   * @param onfinally Called when the future is complete.
   * @returns A promise that resolves to the final result.
   */
  finally(onfinally?: (() => void) | undefined | null): Promise<TReturn> {
    return this.toPromise().finally(onfinally);
  }

  /**
   * Creates a `Future` from an operation, such as an async generator, a promise-like object, 
   * or any kind of iterable. This method converts different types of async tasks into a Future.
   * 
   * ### What Does `fromOperation` Do?
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
   * ### How It Works:
   * 
   * **Push-Based**:
   * - This is the traditional workflow where the generator (or operation) autonomously pushes values to the consumer.
   * - In this scenario, the generator continues yielding values until it is complete.
   * 
   * @example Push-Based Workflow:
   * ```typescript
   * const future = Future.fromOperation(async function* () {
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
   * const future = Future.fromOperation(async function* () {
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
   * @param operation The operation to convert into a Future. It could be a promise-like object, 
   * a generator, an async generator, an iterator, or an iterable.
   * 
   * @returns {Future<T>} A future representing the given operation.
   * 
   * @example Handling a simple promise-like operation:
   * ```typescript
   * const future = Future.fromOperation(Promise.resolve(42));
   * const result = await future.toPromise(); // result is 42
   * ```
   * 
   * @example Handling a synchronous iterable (like an array):
   * ```typescript
   * const future = Future.fromOperation([1, 2, 3]);
   * for await (const value of future) {
   *   console.log(value); // Logs 1, 2, and 3
   * }
   * ```
   * 
   * @example Handling an async generator:
   * ```typescript
   * const future = Future.fromOperation(async function* () {
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
   * const future = Future.fromOperation(async function* (signal: AbortSignal) {
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
   * 
   */
  static fromOperation<T, TReturn, TNext>(
    operation:
      | ((signal: AbortSignal) => AsyncGenerator<T, TReturn, TNext> | Generator<T, TReturn, TNext> | PromiseLike<TReturn>)
      | PromiseLike<TReturn>
      | Future<T, TReturn, TNext>
      | ReadableStream<T>
      | AsyncIterable<T>
      | Iterable<T>
      | Iterator<T, TReturn, TNext>
      | AsyncIterator<T, TReturn, TNext>
  ) {
    // Handle Future instances directly
    if (operation instanceof Future) {
      return operation;
    }

    // Handle ReadableStreams (common in web APIs)
    if (operation instanceof ReadableStream) {
      return Future.fromStream(operation);
    }
    
    if (typeof operation === "function") {
      return new Future<T, TReturn, TNext>(async function* (signal: AbortSignal) {
        const result = await operation(signal) as 
          | AsyncGenerator<T, TReturn, TNext> 
          | Generator<T, TReturn, TNext> 
          | PromiseLike<TReturn>;

        if (isAsyncIterable(result) || isIterable(result)) {
          // Handle async iterable or iterable result
          return yield* result as AsyncGenerator<T, TReturn, TNext>;
        }

        // Handle promise-like result or single value
        yield result as T;
        return result as TReturn;
      });
    }

    return new Future<T, TReturn, TNext>(async function* () {
      const result = operation as
        | AsyncIterable<T>
        | Iterable<T>
        | Iterator<T, TReturn, TNext>
        | AsyncIterator<T, TReturn, TNext>;
      if (isAsyncIterable(result) || isIterable(result)) {
        return yield* result;
      } else if (isAsyncIterator(result)) {
        let iteratorResult = await result.next();
        while (!iteratorResult.done) {
          iteratorResult = await result.next(yield iteratorResult.value);
        }

        return iteratorResult.value;
      }

      // Yield a single value from the resolved promise
      yield operation as T;
      return operation as TReturn;
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
  static fromStream<T, TNext>(stream: ReadableStream<T>): Future<Awaited<T>, Awaited<T> | undefined, Awaited<Awaited<TNext>>> {
    return new Future<Awaited<T>, Awaited<T> | undefined, Awaited<Awaited<TNext>>>(async function* () {
      const reader = stream.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) return value;
          
          // Yield each chunk of data
          yield value; 
        }
      } catch (error) {
        reader.cancel(error);
        throw error;
      } finally {
        reader.releaseLock();
      }
    });
  }

  /**
   * Runs multiple Futures concurrently, yielding their results as they all complete.
   * 
   * This is similar to `Promise.all` but with support for yielding results in sequence
   * once all the futures have been resolved.
   * 
   * @param futures - An iterable of `Future` or `PromiseLike` objects.
   * @returns An AsyncIterable yielding each result as they complete.
   */
  static all<T, TReturn, TNext>(futures: Iterable<Future<T, TReturn, TNext> | PromiseLike<TReturn>>): Future<Awaited<TReturn>, Awaited<TReturn>[]> {
    return new Future<Awaited<TReturn>, Awaited<TReturn>[]>(async function* () {
      // We trigger all futures at once, using Promise.all to await them concurrently.
      const results = await Promise.all(futures);
      yield* results;
      return results;
    });
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
   *   Future.fromOperation(async function* () {
   *     yield 42;
   *     return 100;
   *   }),
   *   Future.fromOperation(async function* () {
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
  static allSettled<T, TReturn, TNext>(
    futures: Iterable<Future<T, TReturn, TNext> | PromiseLike<TReturn>>
  ): Future<PromiseSettledResult<Awaited<TReturn>>, PromiseSettledResult<Awaited<TReturn>>[], undefined> {
    return new Future<PromiseSettledResult<Awaited<TReturn>>, PromiseSettledResult<Awaited<TReturn>>[], undefined>(async function* () {
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
  static any<T, TReturn, TNext>(
    futures: Iterable<Future<T, TReturn, TNext> | PromiseLike<TReturn>>
  ): Future<TReturn, TReturn, TNext> {
    return new Future<TReturn, TReturn, TNext>(async function* () {
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
  static some<T, TReturn, TNext>(
    futures: Iterable<Future<T, TReturn, TNext> | PromiseLike<TReturn>>,
    count: number
  ): Future<PromiseSettledResult<Awaited<TReturn>>, PromiseSettledResult<Awaited<TReturn>>[]> {
    return Future.allSettled(
      Array.from(futures).slice(0, count)
    );
  }

  /**
   * Runs multiple Futures within a defined scope, ensuring that all Futures are executed
   * with full control over their execution (e.g., pausing, resuming, and pulling/pushing values).
   *
   * This method supports `Iterable` and `AsyncIterable` containers of Futures, allowing for
   * both push-based and pull-based workflows.
   *
   * `Future.scope` is designed to handle non-concurrent execution by default, allowing you to
   * control the flow of each future one at a time. If concurrency is needed, you can use
   * `Future.all`, `Future.some`, or similar methods inside the scope.
   *
   * ### Push vs. Pull Workflows:
   * 
   * - **Push-Based Workflow**: The generator yields values autonomously, and the consumer simply awaits those values.
   * - **Pull-Based Workflow**: The generator waits for external input before proceeding to the next value.
   *
   * @param futures - An iterable or async iterable of Futures to be run within the scope.
   * @returns A Future that yields the results of the contained Futures, controlled by the scope.
   *
   * ### Example Usage:
   * 
   * ```typescript
   * const scopeFuture = Future.scope([
   *   Future.fromOperation(async function* () {
   *     yield 42;
   *     return 100;
   *   }),
   *   Future.fromOperation(async function* () {
   *     yield 10;
   *     return 20;
   *   })
   * ]);
   * 
   * for await (const result of scopeFuture) {
   *   console.log(result); // Logs 100, 20
   * }
   * 
   * const pullFuture = Future.scope([
   *   Future.fromOperation(async function* () {
   *     let result = { value: 42, done: false };
   *     
   *     while (!result.done) {
   *       result = await (yield result.value); // Wait for input from the consumer
   *     }
   * 
   *     return result.value;
   *   })
   * ]);
   * 
   * const iterator = pullFuture[Symbol.asyncIterator]();
   * console.log(await iterator.next());  // { value: 42, done: false }
   * console.log(await iterator.next({ value: 100, done: true })); // { value: 100, done: true }
   * ```
   */
  static scope<T, TReturn, TNext>(
    futures: Iterable<Future<T, TReturn, TNext>>
  ): Future<T, TReturn, TNext> {
    // Check if the input is iterable
    const iterator = futures?.[Symbol.iterator]?.();

    // Iterate over the iterable/async iterable futures in a controlled manner
    return new Future<T, TReturn, TNext>(async function* () {
      // If no valid iterator was found, throw an error indicating that the input is not iterable or an iterator
      if (
        (iterator ?? null) === null ||
        typeof (iterator as Iterator<Future<T, TReturn, TNext>>)?.next === 'function'
      ) throw new TypeError("The provided input is not an iterable nor an iterator.");

      // Handle the async generator or generator in a pull-based workflow
      let result: IteratorResult<Future<T, TReturn, TNext>>;

      // Start the iteration
      while (!(result = iterator.next()).done) {
        yield yield* result.value;
      }

      return yield* result.value;
    });
  }

  /**
   * Sets up a `Future` to execute in the background during idle time.
   * 
   * This method does not execute the future itself, but prepares it to be run using
   * `requestIdleCallback`. Execution is still controlled by methods like `toPromise()` or `async` iterators.
   * 
   * @param future The future to be executed in the background.
   * @returns A new `Future` instance set up for background execution.
   * @example
   * ```typescript
   * const future = Future.fromOperation(async function* () {
   *   yield 42;
   *   return 100;
   * });
   * const backgroundFuture = Future.inBackground(future); // result is 100, processed in the background
   * ```
   */
  static inBackground<T, TReturn, TNext>(future: Future<T, TReturn, TNext>): Future<T, TReturn, TNext> {
    // Check if the input is iterable
    const generator = future?.[Symbol.asyncIterator]?.();

    // Iterate over the iterable/async iterable futures in a controlled manner
    return new Future<T, TReturn, TNext>(async function* () {
      // If no valid iterator was found, throw an error indicating that the input is not iterable or an iterator
      if (
        (generator ?? null) === null ||
        typeof (generator as AsyncGenerator<T, TReturn, TNext>)?.next === 'function'
      ) throw new TypeError("The provided input is not a future.");

      let idleResolver: PromiseWithResolvers<void> | null = Promise.withResolvers<void>();
      let idleId = idle(() => idleResolver?.resolve?.());

      try {
        await idleResolver.promise;
        cancelIdle(idleId);

        // Handle the async generator or generator in a pull-based workflow
        let result = await generator.next();
        
        idleResolver = Promise.withResolvers<void>();
        idleId = idle(() => idleResolver?.resolve?.());

        // Start the iteration
        while (!result.done) {
          await idleResolver.promise;
          cancelIdle(idleId);

          result = await generator.next(yield result.value);
        
          idleResolver = Promise.withResolvers<void>();
          idleId = idle(() => idleResolver?.resolve?.());
        }

        return result.value;
      } finally {
        idleResolver = null;
        cancelIdle(idleId);
      }
    });
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
   *   Future.fromOperation(async function* () {
   *     yield 42;
   *     return 100;
   *   }),
   *   Future.fromOperation(async function* () {
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
  static withConcurrencyLimit<T, TReturn, TNext>(
    futures: Iterable<Future<T, TReturn, TNext> | PromiseLike<TReturn>>,
    limit: number
  ) {
    // Check if the input is an async iterator, sync iterator, or iterable
    // We use Symbol.asyncIterator and Symbol.iterator to distinguish between different types
    const iterator = futures?.[Symbol.iterator]?.();

    return new Future(async function* () {
      // If no valid iterator was found, throw an error indicating that the input is not iterable or an iterator
      if (
        (iterator ?? null) === null ||
        typeof iterator?.next === 'function'
      ) throw new TypeError("The provided input is not an iterable nor an iterator.");

      const activeFutures = new Map<
        PromiseLike<TReturn>,
        Promise<{ result: TReturn, promise: PromiseLike<TReturn> }>
      >();
      let finalResult: TReturn | undefined;

      while (activeFutures.size < limit) {
        const { done, value } = iterator.next();
        if (done) break;

        // Start the future concurrently
        const promise = value instanceof Future ? value.toPromise() : value;

        // Wrap the promise and store it in the map with the original promise as the key
        activeFutures.set(promise, Promise.resolve(promise).then(result => ({ result, promise })));  

        // If we hit the concurrency limit, wait for one to resolve
        if (activeFutures.size >= limit) {
          const { result: finished, promise } = await Promise.race(activeFutures.values())
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
    });
  }


  /**
   * Sets a deadline for a future, canceling it if it takes longer than the specified time to complete.
   * If the future resolves before the deadline, the timeout is cleared.
   * 
   * @param future - The future to set a deadline for.
   * @param ms - The time in milliseconds before the future is canceled.
   * @returns A future that will be canceled if it exceeds the specified time.
   * @example
   * ```typescript
   * const future = Future.fromOperation(async function* () {
   *   yield 42;
   *   return 100;
   * });
   * 
   * const deadlineFuture = Future.withDeadline(future, 1000); // Sets a 1-second deadline
   * ```
   */
  static withDeadline<T, TReturn, TNext>(future: Future<T, TReturn, TNext>, ms: number): Future<T, TReturn, TNext> {
    return new Future<T, TReturn, TNext>(async function* () {
      let timeoutId: ReturnType<typeof setTimeout>;

      const timeout = new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          future.cancel();
          reject(new Error("Future timed out"));
        }, ms);
      });

      const result = await Promise.race([future.toPromise(), timeout]);
      if ((timeoutId! ?? null) !== null) clearTimeout(timeoutId!);  // Clear the timeout if the future resolves in time
      
      yield result as T;
      return result as TReturn;
    });  
  }

  /**
   * Provides resolvers for manually controlling the resolution of a future.
   * @returns An object containing the Future, the resolve and reject methods.
   */
  static withResolvers<T, TReturn>(): FutureWithResolvers<T, TReturn> {
    const { promise, resolve, reject } = Promise.withResolvers<TReturn>();
    const future = Future.fromOperation<T, TReturn, undefined>(promise);

    return {
      future,
      resolve,
      reject
    };
  }
}



export interface FutureWithResolvers<T, TReturn> extends Omit<PromiseWithResolvers<TReturn>, "promise"> {
  future: Future<T, TReturn>;
  resolve: (value: TReturn | PromiseLike<TReturn>) => void;
  reject: (reason?: unknown) => void;
}