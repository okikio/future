import { CancellationError } from "./errors.ts";

export const Status = {
  Idle: 0,
  Running: 1,
  Paused: 2,
  Completed: 3,
  Cancelled: 4,
  Destroyed: -1,
}

export type StatusEnum = typeof Status[keyof typeof Status];

export interface FutureOperation<T, TReturn, TNext> {
  (abort: AbortController): AsyncGenerator<T, TReturn, TNext> | Generator<T, TReturn, TNext>
}

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
 * const future = Future.from(async function* () {
 *   yield 42; // Pauses and returns 42
 *   return 100; // Completes and returns 100
 * });
 * 
 * console.log(await future.toPromise()); // Logs 100
 * ```
 *
 * ### Pausing and Resuming
 * ```typescript
 * const future = Future.from(async function* () {
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
 * const backgroundFuture = Future.inBackground(Future.from(async function* () {
 *   yield 1;
 *   return 2;
 * }));
 * 
 * console.log(await backgroundFuture.toPromise()); // Executes in idle time, returns 2
 * ```
 * 
 * @template T - The type of the value that the future will resolve to.
 */
export class Future<T, TReturn = unknown, TNext = unknown>
  // @ts-ignore Iterator is defined but typescript doesn't recognize it yet
  extends globalThis.Iterator
  implements PromiseLike<T | TReturn> {
  #generator?: ReturnType<FutureOperation<T, TReturn, TNext>> | null;
  #operation?: FutureOperation<T, TReturn, TNext> | null;
  #status: StatusEnum = Status.Idle;
  #abort: AbortController | null = new AbortController();
  readonly #resolvers = {
    pause: Promise.withResolvers<void>(),
    complete: Promise.withResolvers<T | TReturn | undefined>(),
    abort: Promise.withResolvers<unknown>(),
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
  constructor(operation: FutureOperation<T, TReturn, TNext>) {
    super();
    this.#operation = operation;
    this.#setup();

    this.#generator = this.#operation?.(this.#abort!);
  }

  #setup() {
    this.#abort?.signal?.removeEventListener?.("abort", this.#eventhandler);

    this.#abort = new AbortController();
    Object.assign(this.#resolvers, {
      pause: Promise.withResolvers<void>(),
      complete: Promise.withResolvers<void>(),
      abort: Promise.withResolvers<unknown>(),
    });

    this.#abort?.signal?.addEventListener?.("abort", this.#eventhandler);
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
      this.#resolvers.abort?.resolve?.(this.#reason);
      this.#resolvers?.pause?.reject?.(this.#reason);
      this.#resolvers?.complete?.reject?.(this.#reason);
    }
  }

  get #reason() {
    return this.#abort?.signal?.reason;
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
    return this.#resolvers.pause?.promise;
  }

  completed() {
    return this.#resolvers.complete?.promise;
  }

  cancelled() {
    return this.#resolvers.abort?.promise;
  }

  complete(value: TReturn) {
    // If the generator does not exist, resolve immediately with the provided value.
    this.#resolvers.complete.resolve(value);
    return this;
  }

  /**
   * Cancels the future, preventing further execution. 
   * @example
   * ```typescript
   * const future = Future.from(async function* () {
   *   yield 42;
   *   return 100;
   * });
   * future.cancel(); // Aborts future execution
   * ```
   */
  cancel(reason: unknown = new CancellationError()) {
    this.#abort?.abort?.(reason);
    return this;
  }

  /**
   * Pauses the execution of the future.
   * @example
   * ```typescript
   * const future = Future.from(async function* () {
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
   * const future = Future.from(async function* () {
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
   * const future = Future.from(async function* () {
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
    this.#generator = this.#operation?.(this.#abort!);
    return this;
  }

  destroy() {
    this.cancel();

    this.#abort?.signal?.removeEventListener?.("abort", this.#eventhandler);
    this.#eventhandler?.destroy?.();

    // @ts-ignore Resetting private properties
    this.#eventhandler = null as unknown;

    Object.assign(this.#resolvers, {
      pause: null,
      complete: null,
      abort: null,
    });

    this.#abort = null;
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
   * const future = Future.from(async function* () {
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
   * const future = Future.from(async function* () {
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
  async *[Symbol.asyncIterator](): AsyncGenerator<T, T | TReturn, TNext> {
    let err: unknown;
    let result: IteratorResult<T, T | TReturn> | undefined;
    try {
      if (!this.#generator || typeof this.#generator?.next !== "function") {
        throw new Error("generator not defined");
      }

      if (this.isComplete()) {
        const value = (await this.#resolvers.complete?.promise) ?? result?.value;
        const finished = await this.#generator?.return?.(value as unknown as TReturn);
        if (finished) return finished?.value;
      }

      // Prime the generator by starting the iteration process
      result = await this.#generator?.next?.();
      
      // Continue yielding values until the generator completes
      while (!result?.done) {
        if (this.isCancelled()) {
          await this.#generator?.throw?.(this.#reason);
          throw this.#reason;
        }

        // Handle pausing by awaiting the pause resolver
        if (this.isPaused()) {
          await this.#resolvers.pause?.promise;
          continue;
        }

        if (this.isComplete()) {
          const value = (await this.#resolvers.complete?.promise) ?? result?.value;
          const finished = await this.#generator?.return?.(value as unknown as TReturn);
          if (finished) return finished?.value;
          break;
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
      if (!this.isCancelled()) this.#abort?.abort?.(error);
      throw (err = error);
    } finally {
      // Resolve or reject based on the completion state
      if (err) this.#resolvers.complete?.reject?.(err);
      else this.#resolvers.complete?.resolve?.(result?.value);
    }
  }

  next(...args: [] | [TNext]): PromiseLike<IteratorResult<T, T | TReturn>> {
    return this[Symbol.asyncIterator]()?.next?.(...args);
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
   * const future = Future.from(async function* () {
   *   yield 42;
   *   // No explicit return, so the final result will be undefined
   * });
   * const result = await future.toPromise(); // result is undefined
   * ```
   */
  async toPromise(): Promise<T | TReturn> {
    let result: IteratorResult<T, T | TReturn>;
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
  then<TResult1 = T | TReturn, TResult2 = never>(
    onfulfilled?: ((value: T | TReturn) => TResult1 | PromiseLike<TResult1>) | undefined | null,
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
  ): Promise<T | TReturn | TResult> {
    return this.toPromise().catch(onrejected);
  }

  /**
   * `finally` method to allow adding a cleanup step after the future resolves or rejects.
   * @param onfinally Called when the future is complete.
   * @returns A promise that resolves to the final result.
   */
  finally(onfinally?: (() => void) | undefined | null): Promise<T | TReturn> {
    return this.toPromise().finally(onfinally);
  }
}

export default Future;