import { cancelIdle, idle } from "./idle.ts";


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
export class Future<T> implements PromiseLike<T>, AsyncIterableIterator<T> {
  #generator?: AsyncGenerator<T, T, IteratorResult<T>> | null;
  #operation?: ((signal: AbortSignal) => AsyncGenerator<T, T, IteratorResult<T>>) | null;
  #status: StatusEnum = Status.Idle;
  readonly #resolvers = {
    pause: Promise.withResolvers<void>(),
    complete: Promise.withResolvers<void>(),
    abort: new AbortController(),
  }

  static #EventHandler = class PrivateEventHandler<T> {
    #delegate: Future<T> | undefined | null;
    constructor(delegate?: Future<T>) {
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
  constructor(operation: (signal: AbortSignal) => AsyncGenerator<T, T, IteratorResult<T>>) {
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
    this.#resolvers?.abort?.abort(new CancellationError());
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
    this.#eventhandler = null as unknown as any;

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
  async *[Symbol.asyncIterator](): AsyncGenerator<Awaited<T>, Awaited<T>, unknown> {
    let err: unknown;
    try {
      if (
        !(this.#generator ?? null) || 
        typeof this.#generator?.next !== "function"
      ) throw new Error("generator not defined");

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

  /**
   * Converts the future into a promise and waits for its resolution.
   * Includes support for control flow operations including pausing, cancelling, and more...
   * 
   * @returns A promise that resolves to the result of the future.
   * @example
   * ```typescript
   * const future = Future.fromOperation(async function* () {
   *   yield 42;
   *   return 100;
   * });
   * const result = await future.toPromise(); // result is 100
   * ```
   */
  async toPromise() {
    let finalValue: T;
    for await (const value of this) {
      finalValue = value;
    }

    return finalValue!;
  }

  /**
   * `then` method to allow Future to be used with `await` and promise chaining.
   * @param onfulfilled Called when the future resolves successfully.
   * @param onrejected Called when the future is rejected.
   * @returns A promise that resolves with the result of the future.
   */
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, 
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2> {
    return this.toPromise().then(onfulfilled, onrejected);
  }

  /**
   * `catch` method to handle rejections.
   * @param onrejected A callback that handles the rejection reason.
   * @returns A promise that resolves or rejects based on the future's outcome.
   */
  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null
  ): Promise<T | TResult> {
    return this.toPromise().catch(onrejected);
  }

  /**
   * `finally` method to allow adding a cleanup step after the future resolves or rejects.
   * @param onfinally Called when the future is complete.
   * @returns A promise that resolves to the final result.
   */
  finally(onfinally?: (() => void) | undefined | null): Promise<T> {
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
  static fromOperation<T>(
    operation:
      | ((signal: AbortSignal) => AsyncGenerator<T, T, IteratorResult<T>> | Generator<T, T, IteratorResult<T>>)
      | PromiseLike<T>
      | AsyncIterable<T>
      | Iterable<T>
  ): Future<T> {
    // Handle Future instances directly
    if (operation instanceof Future) {
      return operation;
    }

    // Handle ReadableStreams (common in web APIs)
    if (operation instanceof ReadableStream) {
      return Future.fromStream(operation);
    }

    // Handle Promise-like objects
    if (typeof (operation as PromiseLike<T>)?.then === 'function') {
      return Future.fromPromise(operation as PromiseLike<T>);
    }

    return new Future<T>(async function* (signal: AbortSignal) {
      // Check what the source of the async generator or generator is
      const source = typeof operation === 'function' ? await operation(signal) : operation;
      if ((source ?? null) === null) {
        yield source;
        return source;
      }

      // Check if the operation is an async generator or generator
      const generator =
        (source as AsyncIterable<T>)?.[Symbol.asyncIterator]?.() ??
        (source as Iterable<T>)?.[Symbol.iterator]?.() ??
        source as AsyncIterator<T>;

      // Handle async iterators or generators
      if (
        Symbol.asyncIterator in source ||
        Symbol.iterator in source ||
        typeof (generator as AsyncIterator<T>)?.next === 'function'
      ) {
        // Prime the generator once before starting the main loop
        let result = await generator.next();

        // Continue yielding values until the generator completes
        while (!result?.done) {
          // Wait for the next value to be passed in through next()
          result = await generator.next(yield result.value);
        }

        // Return the final value
        return result.value;
      } else {
        // Handle single value cases (e.g., a plain value or Promise)
        yield generator as T;
      }

      return generator as T;
    });
  }

  /**
   * Creates a `Future` from a standard JavaScript `Promise`.
   * 
   * This method allows you to wrap a `Promise` in a `Future` to take advantage of the
   * additional control provided by `Future`, such as pausing, resuming, and cancellation.
   * 
   * @param promise - The promise to wrap in a `Future`.
   * @returns A new `Future` instance wrapping the given promise.
   * 
   * @example
   * ```typescript
   * const future = Future.fromPromise(fetch('https://api.example.com/data'));
   * 
   * const data = await future.toPromise(); // data is the fetched result
   * ```
   */
  static fromPromise<T>(promise: PromiseLike<T>): Future<T> {
    return new Future<T>(async function* () {
      yield promise;
      return promise;
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
  static fromStream<T>(stream: ReadableStream<T>): Future<T> {
    return new Future<T>(async function* (signal: AbortSignal) {
      const reader = stream.getReader();

      try {
        while (true) {
          if (signal.aborted) break;
          const { done, value } = await reader.read();
          if (done || signal.aborted) {
            break;
          }
          if (value) {
            yield value; // Yield each chunk of data
          }
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
   * Utility method to collect and normalize iterable, async iterable, or iterator of Futures or PromiseLike objects.
   * Converts each Future or promise into a promise, ensuring consistent handling of both sync and async iterables/iterators.
   *
   * This method supports the following types:
   * - `Iterable<Future<T> | PromiseLike<T>>`
   * - `AsyncIterable<Future<T> | PromiseLike<T>>`
   * - `Iterator<Future<T> | PromiseLike<T>>`
   * - `AsyncIterator<Future<T> | PromiseLike<T>>`
   *
   * @param futures - An iterable, async iterable, iterator, or async iterator of `Future` or `PromiseLike` objects.
   * @returns A promise that resolves with an array of promises.
   *
   * ### Usage Examples:
   * 
   * ```typescript
   * // Example 1: Synchronous iterable
   * const syncIterable = [Promise.resolve(1), Promise.resolve(2), Future.fromPromise(Promise.resolve(3))];
   * for await (const result of Future.all(syncIterable)) {
   *   console.log(result);  // Logs: 1, 2, 3
   * }
   * 
   * // Example 2: Asynchronous iterable
   * async function* asyncIterable() {
   *   yield Promise.resolve(4);
   *   yield Future.fromOperation(async function* () {
   *     yield 5;
   *     return 6;
   *   });
   * }
   * 
   * for await (const result of Future.all(asyncIterable())) {
   *   console.log(result);  // Logs: 4, 6
   * }
   * 
   * // Example 3: Synchronous iterator
   * function* syncIterator() {
   *   yield Promise.resolve(7);
   *   yield Future.fromPromise(Promise.resolve(8));
   * }
   * 
   * for await (const result of Future.all(syncIterator())) {
   *   console.log(result);  // Logs: 7, 8
   * }
   * 
   * // Example 4: Asynchronous iterator
   * async function* asyncIterator() {
   *   yield Future.fromPromise(Promise.resolve(9));
   *   yield Promise.resolve(10);
   * }
   * 
   * for await (const result of Future.all(asyncIterator())) {
   *   console.log(result);  // Logs: 9, 10
   * }
   * ```
   */
  static async collectIterable<T>(
    futures: Iterable<Future<T> | PromiseLike<T>> | AsyncIterable<Future<T> | PromiseLike<T>> | Iterator<Future<T> | PromiseLike<T>> | AsyncIterator<Future<T> | PromiseLike<T>>
  ): Promise<Array<Future<T> | PromiseLike<T>>> {
    const collected: Array<Promise<T>> = [];

    // Check if the input is an async iterator, sync iterator, or iterable
    // We use Symbol.asyncIterator and Symbol.iterator to distinguish between different types
    const iterator = (futures as AsyncIterable<Future<T> | PromiseLike<T>>)?.[Symbol.asyncIterator]?.() ||
      (futures as Iterable<Future<T> | PromiseLike<T>>)?.[Symbol.iterator]?.() ||
      (futures as AsyncIterator<Future<T> | PromiseLike<T>>);

    // If no valid iterator was found, throw an error indicating that the input is not iterable or an iterator
    if (
      (iterator ?? null) === null ||
      typeof (iterator as AsyncIterator<Future<T> | PromiseLike<T>>)?.next !== 'function'
    ) throw new TypeError("The provided input is not an iterable nor an iterator.");

    // IteratorResult contains `value` and `done` properties. `done` indicates if iteration is complete.
    let result: IteratorResult<Future<T> | PromiseLike<T>>;

    // Iterate through the input using `next()` to process each item
    while (!(result = await iterator.next()).done) {
      const future = result.value;

      // Allow for pausing and resuming of each future
      const futureIterator = Symbol.asyncIterator in future ? future[Symbol.asyncIterator]() : (async function* () { 
        yield (future instanceof Future ? future.toPromise<T>() : future); 
      })();

      // Process the future step-by-step, handling the push workflow
      let futureResult: IteratorResult<T> = await futureIterator.next();

      while (!futureResult.done) {
        // Yield the value from the current future to the scope consumer
        futureResult = await futureIterator.next();
      }

      // Push the normalized promise into the collected array
      collected.push(futureResult.value);
    }

    // Return the collected array of promises
    return collected;
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
  static async *all<T>(futures: Iterable<Future<T> | PromiseLike<T>> | AsyncIterable<Future<T> | PromiseLike<T>> | Iterator<Future<T> | PromiseLike<T>> | AsyncIterator<Future<T> | PromiseLike<T>>): AsyncIterable<T> {
    const collectedFutures = await Future.collectIterable(futures);

    // We trigger all futures at once, using Promise.all to await them concurrently.
    const results = await Promise.all(collectedFutures);
    for (const result of results) {
      yield result;  // Yield each result in the original order.
    }
  }

  /**
   * Alias for {@link Future.all}
   */
  static concurrent = Future.all;

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
  static allSettled<T>(
    futures: Iterable<Future<T> | PromiseLike<T>> | AsyncIterable<Future<T> | PromiseLike<T>> | Iterator<Future<T> | PromiseLike<T>> | AsyncIterator<Future<T> | PromiseLike<T>>
  ): Future<PromiseSettledResult<T>> {
    return new Future<PromiseSettledResult<T>>(async function* () {
      const collectedFutures = await Future.collectIterable(futures);

      // We trigger all futures at once, using Promise.allSettled to await them concurrently.
      const results = await Promise.allSettled(collectedFutures);

      for (const result of results) {
        yield result;  // Yield each result in the original order.
      }
    });
  }

  /**
   * Runs multiple Futures in sequence, yielding each result as they complete.
   * 
   * This method is useful when you need to ensure that Futures are run one after the other,
   * rather than concurrently.
   * 
   * @param futures - An iterable or async iterable of `Future` or `PromiseLike` objects.
   * @returns An AsyncIterable yielding each result as they complete.
   */
  static sequence<T>(
    futures: Iterable<Future<T> | PromiseLike<T>> | AsyncIterable<Future<T> | PromiseLike<T>> | Iterator<Future<T> | PromiseLike<T>> | AsyncIterator<Future<T> | PromiseLike<T>>
  ): Future<T> {
    // Check if the input is an async iterator, sync iterator, or iterable
    // We use Symbol.asyncIterator and Symbol.iterator to distinguish between different types
    // Iterate over the iterable/async iterable futures in a controlled manner
    const iterator = 
      (futures as AsyncIterable<Future<T> | PromiseLike<T>>)?.[Symbol.asyncIterator]?.() ||
      (futures as Iterable<Future<T> | PromiseLike<T>>)?.[Symbol.iterator]?.() ||
      (futures as AsyncIterator<Future<T> | PromiseLike<T>>);

    return new Future<T>(async function* () {
      // If no valid iterator was found, throw an error indicating that the input is not iterable or an iterator
      if (
        (iterator ?? null) === null ||
        typeof (iterator as AsyncIterator<T>)?.next === 'function'
      ) throw new TypeError("The provided input is not an iterable nor an iterator.");

      // Handle the async generator or generator in a pull-based workflow
      let result: IteratorResult<Future<T> | PromiseLike<T>>;

      // Start the iteration
      while (!(result = await iterator.next()).done) {
        const future = result.value;

        // Allow for pausing and resuming of each future
        const futureIterator = Symbol.asyncIterator in future ? future[Symbol.asyncIterator]() : (async function* (): AsyncGenerator<Awaited<T>, Awaited<T>, unknown> {
          const promise = (future instanceof Future ? future.toPromise() : future) as Promise<T>;
          yield promise;
          return promise;
        })();

        // Process the future step-by-step, handling the push/pull workflow
        let futureResult = await futureIterator.next();

        while (!futureResult.done) {
          // Yield the value from the current future to the scope consumer
          futureResult = await futureIterator.next(yield futureResult.value);
        }

        // Yield the final result of the future
        yield futureResult.value;
        if (futureResult.done) return futureResult.value;
      }
    });
  }

  /**
   * Returns the first settled Future, similar to `Promise.race`.
   * 
   * @param futures - An iterable or async iterable of `Future` or `PromiseLike` objects.
   * @returns An AsyncIterable yielding the first result that resolves.
   */
  static any<T>(
    futures: Iterable<Future<T> | PromiseLike<T>> | AsyncIterable<Future<T> | PromiseLike<T>> | Iterator<Future<T> | PromiseLike<T>> | AsyncIterator<Future<T> | PromiseLike<T>>
  ): Future<T> {
    return new Future<T>(async function* () {
      yield await Promise.race(await Future.collectIterable(futures));
    });
  }

  /**
   * Executes multiple Futures concurrently, but only returns results for the first `count` Futures.
   * 
   * @param futures - An iterable or async iterable of `Future` or `PromiseLike` objects.
   * @param count - The number of Futures to resolve before yielding results.
   * @returns An AsyncIterable yielding the first `count` resolved results.
   */
  static some<T>(
    futures: Iterable<Future<T> | PromiseLike<T>> | AsyncIterable<Future<T> | PromiseLike<T>> | Iterator<Future<T> | PromiseLike<T>> | AsyncIterator<Future<T> | PromiseLike<T>>, 
    count: number
  ): Future<PromiseSettledResult<T>> {
    return new Future<PromiseSettledResult<T>>(async function* () {
      const collectedFutures = await Future.collectIterable(futures);
      yield* Future.allSettled(
        collectedFutures.slice(0, count)
      );
    });
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
  static scope<T>(
    futures: Iterable<Future<T> | PromiseLike<T>> | AsyncIterable<Future<T> | PromiseLike<T>> | Iterator<Future<T> | PromiseLike<T>> | AsyncIterator<Future<T> | PromiseLike<T>>
  ): Future<T> {
    // Check if the input is an async iterator, sync iterator, or iterable
    // We use Symbol.asyncIterator and Symbol.iterator to distinguish between different types
    const iterator = 
      (futures as AsyncIterable<T>)?.[Symbol.asyncIterator]?.() ||
      (futures as Iterable<T>)?.[Symbol.iterator]?.() ||
      (futures as AsyncIterator<T>);

    // Iterate over the iterable/async iterable futures in a controlled manner
    return new Future<T>(async function* () {
      // If no valid iterator was found, throw an error indicating that the input is not iterable or an iterator
      if (
        (iterator ?? null) === null ||
        typeof (iterator as AsyncIterator<T>)?.next === 'function'
      ) throw new TypeError("The provided input is not an iterable nor an iterator.");

      // Handle the async generator or generator in a pull-based workflow
      let result: IteratorResult<Future<T>>;

      // Start the iteration
      while (!(result = await iterator.next()).done) {
        const future = result.value;

        // Allow for pausing and resuming of each future
        const futureIterator = future?.[Symbol.asyncIterator]?.() ?? (async function* () { yield future.toPromise(); })();

        // Process the future step-by-step, handling the push/pull workflow
        let futureResult: IteratorResult<T> = await futureIterator.next();

        while (!futureResult.done) {
          // Yield the value from the current future to the scope consumer
          futureResult = await futureIterator.next(yield futureResult.value);
        }

        // Yield the final result of the future
        yield futureResult.value;
      }
    });
  }

  /**
   * Chains two futures together, where the result of the first future is passed to the second future.
   * This method allows for sequential execution of dependent futures.
   * 
   * @param future - The initial future whose result will be passed to the next future.
   * @param continuation - A function that takes the result of the first future and returns a new future.
   * @returns A future representing the continuation of both futures.
   * @example
   * ```typescript
   * const future = Future.fromOperation(async function* () {
   *   yield 42;
   *   return 100;
   * });
   * 
   * const continuedFuture = Future.continueWith(future, (result) => {
   *   return Future.fromOperation(async function* () {
   *     yield result + 10;
   *     return result + 20;
   *   });
   * });
   * 
   * const finalResult = await continuedFuture.toPromise(); // finalResult is 120
   * ```
   */
  static continueWith<T, U>(
    future: Future<T>,
    continuation: (result: T) => Future<U>
  ): Future<U> {
    return new Future<U>(async function* () {
      const result = await (yield* future);
      yield* continuation(result);
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
  static inBackground<T>(future: Future<T>): Future<T> {
    return new Future<T>(async function* () {
      let idleResolver: PromiseWithResolvers<void> | null = Promise.withResolvers<void>();
      let idleId = idle(() => idleResolver?.resolve?.());

      try {
        let finalValue: T;
        for await (const value of future) {
          await idleResolver.promise;
          cancelIdle(idleId);

          yield (finalValue = value);

          idleResolver = Promise.withResolvers<void>();
          idleId = idle(() => idleResolver?.resolve?.());
        }

        return finalValue!;
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
   *   Future.fromPromise(Promise.resolve(1)),
   *   Future.fromPromise(Promise.resolve(2)),
   *   Future.fromPromise(Promise.resolve(3)),
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
   *   Future.fromPromise(fetch('https://api.example.com/1')),
   *   Future.fromPromise(fetch('https://api.example.com/2')),
   *   Future.fromPromise(fetch('https://api.example.com/3'))
   * ];
   * 
   * const limitedFuture = Future.withConcurrencyLimit(futures, 2);
   * 
   * for await (const result of limitedFuture) {
   *   console.log(result); // Process each result as it becomes available
   * }
   * ```
   */
  static withConcurrencyLimit<T>(
    futures: Iterable<Future<T> | PromiseLike<T>> | AsyncIterable<Future<T> | PromiseLike<T>>,
    limit: number
  ): Future<AsyncIterable<T>> {
    return new Future<AsyncIterable<T>>(async function* () {
      const activeFutures = new Set<Promise<T>>();
      
      // Check if the input is an async iterator, sync iterator, or iterable
      // We use Symbol.asyncIterator and Symbol.iterator to distinguish between different types
      const iterator =
        (futures as AsyncIterable<T>)?.[Symbol.asyncIterator]?.() ||
        (futures as Iterable<T>)?.[Symbol.iterator]?.() ||
        (futures as AsyncIterator<T>);

      while (activeFutures.size < limit) {
        const { done, value } = iterator.next();
        if (done) break;

        // Start the future concurrently
        const futurePromise = value instanceof Future ? value.toPromise() : value;
        activeFutures.add(futurePromise);

        // If we hit the concurrency limit, wait for one to resolve
        if (activeFutures.size >= limit) {
          const finished = await Promise.race(activeFutures);
          activeFutures.delete(finished);
          yield finished;
        }
      }

      // After the main loop, yield any remaining futures
      for (const remainingFuture of activeFutures) {
        yield await remainingFuture;
      }
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
  static withDeadline<T>(future: Future<T>, ms: number): Future<T> {
    return new Future<T>(async function* () {
      let timeoutId: ReturnType<typeof setTimeout>;

      const timeout = new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          future.cancel();
          reject(new Error("Future timed out"));
        }, ms);
      });

      try {
        const result = await Promise.race([future.toPromise(), timeout]);
        clearTimeout(timeoutId);  // Clear the timeout if the future resolves in time
        yield result;
        return result;
      } catch (error) {
        throw error;
      }
    });
  }

  /**
   * Provides resolvers for manually controlling the resolution of a future.
   * @returns An object containing the Future, the resolve and reject methods.
   */
  static withResolvers<T>(): {
    future: Future<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: any) => void;
  } {
    let resolveFn: (value: T | PromiseLike<T>) => void;
    let rejectFn: (reason?: any) => void;

    const future = new Future<T>(async function* () {
      return await new Promise<T>((resolve, reject) => {
        resolveFn = resolve;
        rejectFn = reject;
      });
    });

    return {
      future,
      resolve: resolveFn!,
      reject: rejectFn!
    };
  }
}

// Example usage:
const future = Future.scope(
  Future.withConcurrencyLimit([
    Promise.resolve(10),
    Future.fromOperation(async function* () {
      yield 5;
      return 5;
    }),
    Future.fromOperation(async function () {
      return await 10;
    }).runInBackground(),
    Future.all([Promise.resolve(20), Promise.resolve(30)]).runInBackground(),
    Future.any([Promise.resolve(5), Promise.resolve(20)]),
  ], 5)
);

setTimeout(() => future.pause(), 1000);
setTimeout(() => future.resume(), 3000);

for await (const value of future) {
  console.log(value);
}
