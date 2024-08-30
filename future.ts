/// <reference lib="dom" />
import type { StatusEnum, StatusEventMap } from "./status.ts";

import { createStatusEventDispatcher, waitForEvent } from "./events.ts";
import { Status, StatusEvent } from "./status.ts";
import { CancellationError } from "./errors.ts";

export interface FutureOperation<T, TReturn, TNext> {
  (
    abort: AbortController,
  ): AsyncGenerator<T, TReturn, TNext> | Generator<T, TReturn, TNext>;
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
export class Future<T, TReturn = unknown, TNext = unknown> extends
  // @ts-ignore Iterator is defined but typescript doesn't recognize it yet
  // globalThis.Iterator
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

  #setStatus<K extends keyof StatusEventMap>(status: K, event = new StatusEvent(status)) {
    this.#status = status;
    this.#events.dispatch(event as StatusEventMap[K]);
  }

  #handleEvent(event: Event) {
    if (event.type === "abort") {
      this.#status = Status.Cancelled;
    }
  }

  get #reason() {
    return this.#abort?.signal?.reason;
  }

  complete(value: TReturn) {
    // If the generator does not exist, resolve immediately with the provided value.
    this.#events.complete?.resolve?.(value);
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
   * @yields The values generated by the future.
   */
  // @ts-ignore Iterator is defined but typescript doesn't recognize it yet
  async *#wrapper(
    operation: FutureOperation<T, TReturn, TNext>,
  ): AsyncGenerator<T, T | TReturn, TNext> {
    let err: unknown;
    let result: IteratorResult<T, T | TReturn> | undefined;
    try {
      if (this.#abort?.signal?.aborted) {
        this.#abort?.signal?.removeEventListener?.("abort", this.#eventhandler);
        this.#abort = new AbortController();
      }

      this.#abort?.signal?.addEventListener?.("abort", this.#eventhandler);

      const generator = operation?.(this.#abort!);
      if (!generator || typeof generator?.next !== "function") {
        throw new Error("generator not defined");
      }

      // Continue yielding values until the generator completes
      do {
        try {
          // if (this.#abort?.signal?.aborted) throw this.#reason;

          // Handle pausing by awaiting the pause resolver
          if (this.is(Status.Paused)) {
            using events = this.#events.events;
            for await (const event of events) {
              if (
                event.type === Status.Running ||
                event.type === Status.Idle
              ) break;
            }
            continue;
          }

          // Handle completion by returning the final value
          if (this.is(Status.Completed)) {
            const value = result?.value;
            const finished = await generator?.return?.(
              value as unknown as TReturn,
            );
            if (finished) return finished?.value;
            break;
          }

          const iteratorResult = result
            // Yield the value to the consumer and wait for the next input
            ? generator?.next?.(yield result?.value! as T)
            // Prime the generator by starting the iteration process
            : generator?.next?.();

          using events = this.#events.events;
          const abortctrlr = new AbortController();
          await Promise.race([
            iteratorResult,
            waitForEvent(events, Status.Cancelled, abortctrlr.signal),
          ]);
          abortctrlr.abort();

          result = await iteratorResult;
        } catch (error) {
          // If an error occurs, propagate it to the generator
          if (generator?.return) {
            result = await generator.return(undefined as unknown as TReturn);
          }

          // Rethrow the error if it wasn't caught by the generator
          throw error;
        }
      } while (!result?.done);

      // Return the final value once iteration completes
      return result?.value as TReturn;
    } catch (error) {
      err = error;

      if (!this.#abort?.signal?.aborted) {
        try {
          this.#abort?.abort?.(err);
        } catch (e) {
          console.log("Error aborting", e);
        }
      }

      // Rethrow the error if it wasn't caught by the generator
      throw error;
    } finally {
      // Resolve or reject based on the completion state
      if (!err) {
        this.#events.dispatch(
          new StatusEvent(Status.Completed, { value: result?.value })
        );
      }
    }
  }

  [Symbol.asyncIterator](): AsyncGenerator<T, T | TReturn, TNext> {
    if (this.is(Status.Destroyed)) {
      throw new Error("Cannot iterate over a destroyed future");
    }

    if (!this.#generator) {
      throw new Error("Iterator not defined");
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

export default Future;
