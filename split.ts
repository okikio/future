/**
 * Splits a source iterator or iterable into two separate iterators: one for valid values and one for errors encountered during iteration.
 *
 * This function allows both sub-iterators to independently pull values from the source when they need them.
 * Valid values go to the first iterator, while errors encountered during the iteration process (not yielded values) go to the second iterator.
 *
 * ### Synchronization
 * The sub-iterators are synchronized using a shared state and explicit queues for valid values and errors. 
 * This ensures that the source iterator's values are only pulled once, and each sub-iterator can pull from its respective queue without busy waiting.
 *
 * ### Deadlock Prevention
 * By using separate queues for valid values and errors, this method avoids deadlocks that could occur if one sub-iterator is stuck waiting for values while the other continues pulling.
 *
 * @template V The type of valid values being iterated over by the source.
 * @template E The type of errors encountered during the iteration process.
 * 
 * @param source The original source iterator or iterable to be split.
 * @returns An array containing two iterators: one for valid values and one for errors encountered during iteration.
 * @example
 * ```ts
 * async function* sourceIterator() {
 *   yield 1;
 *   yield 2;
 *   throw new Error("Something went wrong during iteration");
 * }
 *
 * const [resolved, errored] = split(sourceIterator());
 *
 * for await (const value of resolved) {
 *   console.log("Resolved:", value); // Logs: 1, 2
 * }
 *
 * for await (const error of errored) {
 *   console.error("Errored:", error); // Logs: Error: Something went wrong during iteration
 * }
 * ```
 *
 * @example
 * ```ts
 * // Handling errors and valid Error instances
 * async function* errorYieldingIterator() {
 *   yield new Error("This is a valid error value");
 *   yield 42;
 *   throw new Error("Iteration failed");
 * }
 *
 * const [resolved, errored] = split(errorYieldingIterator());
 *
 * for await (const value of resolved) {
 *   console.log("Resolved:", value); // Logs: Error: This is a valid error value, 42
 * }
 *
 * for await (const error of errored) {
 *   console.error("Errored:", error); // Logs: Error: Iteration failed
 * }
 * ```
 *
 * @example
 * ```ts
 * // Deadlock scenario due to slow source
 * async function* slowSourceIterator() {
 *   yield 1;
 *   await new Promise(resolve => setTimeout(resolve, 1000));
 *   yield 2;
 *   await new Promise(resolve => setTimeout(resolve, 1000));
 *   throw new Error("Something went wrong during iteration");
 * }
 *
 * const [resolved, errored] = split(slowSourceIterator());
 *
 * for await (const value of resolved) {
 *   console.log("Resolved:", value); // Logs: 1, 2
 * }
 *
 * for await (const error of errored) {
 *   console.error("Errored:", error); 
 * }
 * ```
 */
export function split<V, E = unknown>(
  source: AsyncIterable<V> | Iterable<V> | AsyncIterator<V> | Iterator<V>,
): readonly [
  AsyncGenerator<V, V>,
  AsyncGenerator<E, E>,
] {
  // Create a shared source iterator
  const sourceIterator =
    (source as AsyncIterable<V>)?.[Symbol.asyncIterator]?.() ??
    (source as Iterable<V>)?.[Symbol.iterator]?.() ??
    source as AsyncIterator<V>;

  const validQueue = new Set<IteratorResult<V>>();
  const errorQueue = new Set<IteratorResult<E>>();

  // Shared state for managing iteration
  const sharedState: {
    done: boolean;
    validQueue: Set<IteratorResult<V>>;
    errorQueue: Set<IteratorResult<E>>;
  } = {
    done: false,
    validQueue,
    errorQueue,
  };

  /**
   * Helper function to create an async sub-iterator that pulls values based on whether they are valid or errors.
   * @param sourceIterator The source iterator being processed.
   * @param state The shared state containing the queues and done flag.
   * @param type Whether this sub-iterator is for handling errors.
   */
  async function* createSubIterator<I>(
    sourceIterator: AsyncIterator<V | E>,
    state: typeof sharedState,
    type: { error: boolean }
  ): AsyncGenerator<I, I> {
    while (true) {
      // Process the next item from the source if needed
      if (!state.done && (
        state.validQueue.size <= 0 ||
        state.errorQueue.size <= 0
      )) {
        try {
          const result = await sourceIterator.next();
          state.validQueue.add(result as IteratorResult<V>);

          if (result.done) {
            state.done = true;
            state.errorQueue.add({ value: undefined, done: true } as IteratorResult<E>);
          }
        } catch (error) {
          state.errorQueue.add({ value: error as E, done: false } as IteratorResult<E>);
        }
      }

      // Get the next value from the appropriate queue
      let result: IteratorResult<V | E> | undefined;
      if (type.error) {
        result = state.errorQueue.values().next().value;
        state.errorQueue.delete(result as IteratorResult<E>);

        // If the result is done, return the final value
        if (result?.done) return result?.value as I;

        // Yield the error value, so long as there is one
        if ((result?.value ?? null) !== null) {
          // Yield the value if it's appropriate for this iterator
          yield result?.value as I;
        }
      } else {
        result = state.validQueue.values().next().value;
        state.validQueue.delete(result as IteratorResult<V>);

        // Yield the value all the time
        yield result?.value as I;

        // If the result is done, return the final value
        if (result?.done) {
          return result?.value as I;
        }
      }
    }
  }

  // Return two sub-iterators: one for valid results and one for iteration errors
  return [
    createSubIterator<V>(sourceIterator, sharedState, { error: false }),
    createSubIterator<E>(sourceIterator, sharedState, { error: true }),
  ] as const;
}


/**
 * Splits a source iterator or iterable into two independent sub-iterators
 * based on a predicate function. The first sub-iterator will pull values
 * that satisfy the predicate, while the second will pull values that do not
 * satisfy the predicate.
 *
 * ### Synchronization and Deadlock Handling
 * This function uses a shared state between the sub-iterators to ensure that
 * they can independently pull from the source without stepping on each other's toes.
 * However, synchronization issues could occur if the source iterator blocks or
 * produces results slowly, leading one sub-iterator to hang while waiting for
 * the other to finish processing a value.
 *
 * Potential deadlocks could happen if one sub-iterator gets stuck in a state
 * where it cannot move forward, while the other keeps waiting for the shared
 * promise to resolve. These issues are managed by carefully resetting the shared
 * state after each result is processed and ensuring that both sub-iterators
 * check the shared state before attempting to pull from the source again.
 *
 * @template T The type of values being iterated over by the source.
 * @template F The type of values being sent to the second iterator.
 * 
 * @param source The original source iterator or iterable to be split.
 * @param predicate The predicate function that determines which values go to the first iterator.
 *
 * @returns An array containing two iterators: one for values that satisfy the predicate and one
 * for values that do not.
 *
 * @example
 * ```ts
 * // Example 1: Basic usage with a simple predicate
 * async function* sourceIterator() {
 *   yield 1;
 *   yield 2;
 *   yield 3;
 *   yield 4;
 * }
 * 
 * const isEven = (value: number) => value % 2 === 0;
 * 
 * const [evens, odds] = splitBy(sourceIterator(), isEven);
 * 
 * // Iterate through the even values
 * for await (const even of evens) {
 *   console.log("Even:", even); // Logs: 2, 4
 * }
 * 
 * // Iterate through the odd values
 * for await (const odd of odds) {
 *   console.log("Odd:", odd); // Logs: 1, 3
 * }
 * ```
 *
 * @example
 * ```ts
 * // Example 2: Handling errors in the source iterator
 * async function* errorProneIterator() {
 *   yield 1;
 *   yield 2;
 *   throw new Error("Something went wrong");
 * }
 * 
 * const isEven = (value: number) => value % 2 === 0;
 * 
 * const [evens, odds] = splitBy(errorProneIterator(), isEven);
 * 
 * try {
 *   for await (const even of evens) {
 *     console.log("Even:", even);
 *   }
 * } catch (error) {
 *   console.error("Error in evens:", error);
 * }
 * 
 * try {
 *   for await (const odd of odds) {
 *     console.log("Odd:", odd);
 *   }
 * } catch (error) {
 *   console.error("Error in odds:", error);
 * }
 * // Logs: Error: Something went wrong (in both sub-iterators)
 * ```
 *
 * @example
 * ```ts
 * // Example 3: Deadlock scenario due to slow source
 * async function* slowSourceIterator() {
 *   yield 1;
 *   await new Promise((resolve) => setTimeout(resolve, 1000));
 *   yield 2;
 *   await new Promise((resolve) => setTimeout(resolve, 1000));
 *   yield 3;
 *   await new Promise((resolve) => setTimeout(resolve, 1000));
 * }
 * 
 * const isEven = (value: number) => value % 2 === 0;
 * 
 * const [evens, odds] = splitBy(slowSourceIterator(), isEven);
 * 
 * // Deadlock can happen if one of the sub-iterators doesn't pull values consistently
 * for await (const even of evens) {
 *   console.log("Even:", even);
 * }
 * 
 * for await (const odd of odds) {
 *   console.log("Odd:", odd); 
 *   // Be cautious of the delay, as the odd iterator might take a long time
 *   // to get the values due to the slow source.
 * }
 * ```
 */
export function splitBy<T, F = T>(
  source:
    | AsyncIterable<T | F>
    | Iterable<T | F>
    | AsyncIterator<T | F>
    | Iterator<T | F>,
  predicate: (value: T | F) => boolean | Promise<boolean>,
): readonly [
  AsyncGenerator<T, T>,
  AsyncGenerator<F, F>,
] {
  // Create a shared source iterator
  const sourceIterator =
    (source as AsyncIterable<T | F>)?.[Symbol.asyncIterator]?.() ??
    (source as Iterable<T | F>)?.[Symbol.iterator]?.() ??
    source as AsyncIterator<T | F>;

  // Explicitly pass shared state through parameters
  const sharedState: {
    result?: IteratorResult<T | F>;
    done: boolean;
    resolvers: PromiseWithResolvers<IteratorResult<T | F>> | null;
  } = {
    done: false,
    resolvers: null,
  };

  /**
   * Helper function to create an async sub-iterator that pulls values based on the predicate.
   * @param predicateMatch Whether the iterator should yield values that match the predicate.
   * @param state Shared state passed explicitly to manage the iteration.
   */
  async function* createSubIterator<I>(
    state: typeof sharedState,
    predicateMatch: boolean,
  ): AsyncGenerator<I, I> {
    while (true) {
      // Check if the shared promise resolvers are initialized
      if (!state.resolvers) {
        state.resolvers = Promise.withResolvers<IteratorResult<T | F>>();
        sourceIterator.next().then(state.resolvers.resolve).catch(state.resolvers.reject);
      }

      // Wait for the shared promise to resolve with the next value
      const result = await state.resolvers.promise;

      // Clear the resolvers so the next iteration can create a new one
      state.resolvers = null;

      // If the iterator is done, return the final value
      if (result.done) {
        state.done = true;
        return result.value as I;
      }

      // Check if the value matches the predicate
      const matches = await predicate(result.value);

      // Yield the value only if it matches the desired predicate outcome
      if (matches === predicateMatch) {
        yield result.value as I;
      }
    }
  }

  // Return two sub-iterators, one for true results and one for false results
  return [
    createSubIterator<T>(sharedState, true),
    createSubIterator<F>(sharedState, false),
  ] as const;
}
