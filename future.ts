/// <reference lib="dom" />
import type { StatusEnum, StatusEventDetailMap, StatusEventMap } from "./status.ts";

import { createStatusEventDispatcher, waitForEvent } from "./events.ts";
import { Status, StatusEvent } from "./status.ts";
import { CancellationError } from "./errors.ts";

/**
 * The timeout to use when `generator.return` is called to ensure cleanup logic is executed.
 * The reason for this timeout is to prevent the generator from hanging indefinitely,
 * if the cleanup logic fails to complete or gets stuck.
 */
export const GENERATOR_RETURN_TIMEOUT = 1000;

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
 * import * as Future from "./mod.ts";
 *
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
 * import * as Future from "./mod.ts";
 *
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
 * import * as Future from "./mod.ts";
 *
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
  // extends globalThis.Iterator
  implements PromiseLike<T | TReturn> {
  #generator?: AsyncGenerator<T, T | TReturn, TNext> | null;
  #operation?: FutureOperation<T, TReturn, TNext> | null;
  #abort: AbortController | null = null;

  #status: StatusEnum = Status.Idle;
  readonly #events = createStatusEventDispatcher();

  /**
   * Creates a new `Future` instance.
   * @param operation - A function that returns an async generator to define the asynchronous task.
   */
  constructor(operation: FutureOperation<T, TReturn, TNext>, abort = new AbortController()) {
    // super();

    this.#abort = abort;
    this.#operation = operation;
    this.#generator = this.#wrapper(this.#operation);
  }

  is(id: StatusEnum) {
    return this.#status === id;
  }

  getStatus() {
    return this.#status;
  }

  #setStatus<K extends keyof StatusEventMap>(status: K, details?: StatusEventDetailMap[K]) {
    this.#status = status;
    this.#events.dispatch(new StatusEvent(status, details));
  }

  #handleEvent(event: Event) {
    if (event.type === "abort") {
      this.#setStatus(Status.Cancelled, this.#reason);
    }
  }

  get #reason() {
    return this.#abort?.signal?.reason;
  }

  complete(value: T | TReturn | undefined) {
    this.#setStatus(Status.Completed, { value });
    return this;
  }

  /**
   * Cancels the future, preventing further execution.
   * @example
   * ```typescript
   * import * as Future from "./mod.ts";
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
   * import * as Future from "./mod.ts";
   * const future = Future.from(async function* () {
   *   yield 42;
   *   return 100;
   * });
   * future.pause(); // Pauses future execution
   * ```
   */
  pause() {
    if (!this.is(Status.Paused)) {
      this.#setStatus(Status.Paused);
    }
    return this;
  }

  /**
   * Resumes a paused future.
   * @example
   * ```typescript
   * import * as Future from "./mod.ts";
   * const future = Future.from(async function* () {
   *   yield 42;
   *   return 100;
   * });
   * future.resume(); // Resumes future execution
   * ```
   */
  resume() {
    if (this.is(Status.Paused)) {
      this.#setStatus(Status.Running);
    }
    return this;
  }

  /**
   * Resets the future for re-execution, allowing it to run from the beginning.
   * This can only be done if the future is complete.
   * @throws Error if the future is not complete.
   * @example
   * ```typescript
   * import * as Future from "./mod.ts";
   * const future = Future.from(async function* () {
   *   yield 42;
   *   return 100;
   * });
   * await future.toPromise(); // Completes the future
   * future.reset(); // Resets the future for reuse
   * ```
   */
  reset() {
    if (this.is(Status.Destroyed)) {
      throw new Error("Cannot reset a destroyed future");
    }

    if (!this.is(Status.Completed)) {
      throw new Error("Cannot reset an incomplete future");
    }

    this.#setStatus(Status.Idle);
    this.#generator = this.#wrapper(this.#operation!);
    return this;
  }

  dispose() {
    this.cancel();

    this.#abort?.signal?.removeEventListener?.("abort", this.#eventhandler);
    this.#eventhandler?.dispose?.();

    // @ts-ignore Resetting private properties
    this.#eventhandler = null as unknown;
    this.#events?.close?.();

    this.#abort = null;
    this.#operation = null;
    this.#generator = null;

    this.#status = Status.Destroyed;
  }

  [Symbol.dispose]() {
    this.dispose();
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
   * import * as Future from "./mod.ts";
   *
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
   * import * as Future from "./mod.ts";
   *
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
   * ### Method Breakdown:
   * 
   * This method is responsible for managing the generator's lifecycle, including handling:
   * - **Initialization**: Sets up the generator and ensures it's ready for iteration.
   * - **Event Handling**: Manages the status events, such as handling pauses, cancellations, and completion.
   * - **Error Handling**: Catches and propagates errors both within the generator and from external sources.
   * - **Finalization**: Ensures that the generator is properly cleaned up after completion or error.
   *
   * #### Note on `generator.return`:
   * - The `generator.return` method is called to ensure that any cleanup logic within the generator (e.g., releasing resources, closing connections) is executed if the generator is prematurely terminated.
   * - While this may not always be strictly necessary (e.g., if the generator has no cleanup tasks), it is considered good practice to call it when manually terminating a generator to avoid potential memory leaks or incomplete operations.
   *
   * @param operation - The async generator function representing the future's operation.
   * @returns An async generator that yields values generated by the `operation`.
   * @yields The values generated by the future.
   */
  async *#wrapper(
    operation: FutureOperation<T, TReturn, TNext>,
  ): AsyncGenerator<T, T | TReturn, TNext> {
    let result: IteratorResult<T, T | TReturn> | undefined;

    try {
      // Create generator.
      const generator = this.#createGenerator(operation);

      // Continue yielding values until the generator completes.
      do {
        try {
          // If the future is aborted, propagate the abort reason.
          this.#abort?.signal?.throwIfAborted();

          // Handle pausing of the future.
          await this.#handlePause();

          // Handle completion and return final value if needed.
          if (this.is(Status.Completed)) {
            return await this.#handleCompletion(generator, result);
          }

          // Proceed with the generator's next result.
          result = await this.#getNextResult(generator, result ? yield result?.value! as T : undefined);
        } catch (error) {
          // Handle error and attempt early return from generator.
          const returnedResult = await this.#handleError(generator);
          if (returnedResult) result = returnedResult;

          // Rethrow error if it wasn't handled.
          throw error;
        }

      } while (!result?.done);

      // Return final value once generator completes.
      return result?.value;
    } catch (error) {
      // If the future wasn't already aborted, abort it now.
      this.#abortFuture(error);

      // Rethrow the error to ensure it's handled upstream
      throw error;
    } finally {
      // Dispatch the completed event.
      this.#events.dispatch(
        new StatusEvent(
          Status.Completed,
          { value: result?.value }
        )
      );
    }
  }

  /** Helper method to initialize the generator. */
  #createGenerator(
    operation: FutureOperation<T, TReturn, TNext>
  ): AsyncGenerator<T, T | TReturn, TNext> | Generator<T, T | TReturn, TNext> {
    // Reset abort controller if already aborted.
    if (this.#abort?.signal?.aborted) {
      this.#abort?.signal?.removeEventListener?.("abort", this.#eventhandler);
      this.#abort = new AbortController();
    }

    // Attach event handler for abort signal.
    this.#abort?.signal?.addEventListener?.("abort", this.#eventhandler);

    const generator = operation?.(this.#abort!);
    if (!generator || typeof generator?.next !== "function") {
      throw new Error("Generator not defined");
    }

    return generator;
  }

  /** Helper method to handle pausing of the future. */
  async #handlePause() {
    if (this.is(Status.Paused)) {
      using events = this.#events.events;
      for await (const event of events) {
        if (
          event.type === Status.Running ||
          event.type === Status.Idle
        ) break;
      }
    }
  }

  /** Helper method to handle the completion of the future. */
  async #handleCompletion(
    generator: AsyncGenerator<T, T | TReturn, TNext> | Generator<T, T | TReturn, TNext>,
    result: IteratorResult<T, T | TReturn> | undefined
  ): Promise<T | TReturn> {
    const value = result?.value;

    const finished = await generator?.return?.(value!);
    if (finished) return finished?.value;

    return value!;
  }

  /** Helper method to get the next result from the generator. */
  async #getNextResult(
    generator: AsyncGenerator<T, T | TReturn, TNext> | Generator<T, T | TReturn, TNext>,
    input?: TNext
  ): Promise<IteratorResult<T, T | TReturn>> {
    // Advance the generator by calling `.next` with the provided input
    const iteratorResult = input !== undefined
      ? generator?.next?.(input as TNext)
      : generator?.next?.();

    // Wait for either the generator's next result or a cancellation event
    using events = this.#events.events;
    const event = await Promise.race([
      iteratorResult,  // Continue with the generator
      waitForEvent(events, Status.Cancelled, { signal: this.#abort?.signal }),  // Listen for cancellation
    ]);

    // If a cancellation event occurs or the abort signal is triggered, throw an error
    if (
      (event as StatusEvent)?.type === Status.Cancelled ||
      this.#abort?.signal?.aborted
    ) {
      throw this.#reason;
    }

    // Await and return the resolved iterator result
    return await iteratorResult;
  }

  /**
   * Handles errors within the generator, attempting to return early if possible.
   *
   * ### Purpose of `generator.return`:
   * - The `generator.return` method is called during error handling to allow the generator to perform any necessary cleanup.
   * - This is crucial in scenarios where the generator may need to release resources or save state before being discarded.
   * - Even though not all generators require `return` (e.g., those without cleanup logic), it is recommended to call `return` to avoid potential memory leaks or incomplete operations.
   *
   * @param generator - The async generator being managed.
   * @param error - The error that occurred during the generator's execution.
   * @returns A promise resolving to the result of the generator's return, if applicable.
   */
  async #handleError(
    generator: AsyncGenerator<T, T | TReturn, TNext> | Generator<T, T | TReturn, TNext>,
  ): Promise<IteratorResult<T, T | TReturn> | undefined> {
    try {
        // If an error occurs, attempt to return early from the generator
        if (generator?.return) {
        const returnedResult = generator.return(undefined as TReturn);

        // Attempt to return early if there's an error
        await Promise.race([
          returnedResult,
          new Promise((_, reject) => setTimeout(reject, 1000)),
        ]);
      
        return await returnedResult;
      }
    } catch {
      console.warn("[Future] Generator return timed out");
    }
  }

  /** Helper method to abort the future if it hasn't been aborted already. */
  #abortFuture(err: unknown) {
    // If the future wasn't already aborted, abort it now
    if (!this.#abort?.signal?.aborted) {
      this.#abort?.abort?.(err);
    }
  }

  [Symbol.asyncIterator](): AsyncGenerator<T, T | TReturn, TNext> {
    if (this.is(Status.Destroyed)) {
      throw new Error("Cannot iterate over a destroyed future");
    }

    if (!this.#generator) {
      throw new Error("Generator not defined");
    }

    return this.#generator!;
  }

  next(...args: [] | [TNext]): PromiseLike<IteratorResult<T, T | TReturn>> {
    return this.#generator!.next?.(...args);
  }

  /**
   * Converts the future into a promise and waits for its resolution.
   * Includes support for control flow operations including pausing, cancelling, and more...
   *
   * @returns A promise that resolves to the final result of the future.
   * If the generator does not have an explicit return, it will return undefined.
   * @example
   * ```typescript
   * import * as Future from "./mod.ts";
   *
   * const future = Future.from(async function* () {
   *   yield 42;
   *   // No explicit return, so the final result will be undefined
   * });
   * const result = await future.toPromise(); // result is undefined
   * ```
   */
  async toPromise(): Promise<T | TReturn> {
    let result: IteratorResult<T, T | TReturn>;

    // Iterate through the generator until completion
    do {
      result = await this.#generator?.next?.() as IteratorResult<
        T,
        T | TReturn
      >;
    } while (!result.done);

    // If the generator has no explicit return, result.value will be undefined
    return result!.value;
  }

  /**
   * `then` method to allow Future to be used with `await` and promise chaining.
   * @param onfulfilled Called when the future resolves successfully.
   * @param onrejected Called when the future is rejected.
   * @returns A promise that resolves with the result of the future.
   */
  then<TResult1 = T | TReturn, TResult2 = never>(
    onfulfilled?:
      | ((value: T | TReturn) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | undefined
      | null,
  ): Promise<TResult1 | TResult2> {
    return this.toPromise().then(onfulfilled, onrejected);
  }

  /**
   * `catch` method to handle rejections.
   * @param onrejected A callback that handles the rejection reason.
   * @returns A promise that resolves or rejects based on the future's outcome.
   */
  catch<TResult = never>(
    onrejected?:
      | ((reason: unknown) => TResult | PromiseLike<TResult>)
      | undefined
      | null,
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

  static #PrivateEventHandler = class PrivateEventHandler<T, TReturn, TNext> {
    #delegate: Future<T, TReturn, TNext> | undefined | null;
    constructor(delegate?: Future<T, TReturn, TNext>) {
      this.#delegate = delegate;
    }

    handleEvent(event: Event) {
      if (this.#delegate) {
        this.#delegate.#handleEvent(event);
      }
    }

    dispose() {
      this.#delegate = null;
    }

    [Symbol.dispose]() { 
      this.dispose();
    }
  };

  #eventhandler = new Future.#PrivateEventHandler(this);
}

export interface FutureOperation<T, TReturn, TNext> {
  (
    abort: AbortController,
  ): AsyncGenerator<T, TReturn, TNext> | Generator<T, TReturn, TNext>;
}

export default Future;
