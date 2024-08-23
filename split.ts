/**
 * Splits a source iterator or iterable into two separate iterators: one for valid values and one for errors encountered during iteration.
 *
 * This function allows both sub-iterators to independently pull values from the source when they need them.
 * Valid values go to the first iterator, while errors encountered during the iteration process (not yielded values) go to the second iterator.
 *
 * ### How It Works
 * - The function creates two queues: `validQueue` for valid values and `errorQueue` for errors.
 * - As the source iterator is processed, values are placed into the appropriate queue.
 * - Each sub-iterator pulls values from its corresponding queue, ensuring that valid values and errors are handled separately.
 * 
 * ### Iterator Behavior
 * - An iterator is a protocol that allows you to traverse through a collection of values one by one.
 * - In this case, `sourceIterator` is the source iterator, which yields values one at a time when its `next()` method is called.
 * - If an error occurs during iteration (like a thrown exception), it's caught and placed in the `errorQueue`.
 * - The `done` state indicates when the iterator has finished yielding all values.
 *
 * ### Error Handling
 * - Errors encountered during iteration are caught in a `try-catch` block.
 * - Only errors that occur during the iteration process are added to the `errorQueue`.
 * - You can yield `Error` instances as valid values, they will be treated as such and not added to the error queue.
 * - Errors are added to the `errorQueue`, while valid values continue to be processed.
 * - The iteration only stops when the `done` flag is set to `true`.
 *
 * ### Why We Use Sets for Queues
 * - `Set`s are used to store the results because they automatically handle uniqueness and provide efficient add and delete operations.
 * - Values are deleted from the `Set` after being processed to avoid duplication and memory leaks.
 *
 * @template V The type of valid values being iterated over by the source.
 * @template E The type of errors encountered during the iteration process.
 * 
 * @param source The original source iterator or iterable to be split.
 * @returns An array containing two iterators: one for valid values and one for errors encountered during iteration.
 * 
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
 *   // Yielding an Error instance as a valid value 
 *   yield new Error("This is a valid error value");
 *   yield 42;
 * 
 *   // Throwing an error during iteration
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
  // Create a shared source iterator that allows us to pull values from the source
  const sourceIterator =
    (source as AsyncIterable<V>)?.[Symbol.asyncIterator]?.() ??
    (source as Iterable<V>)?.[Symbol.iterator]?.() ??
    source as AsyncIterator<V>;

  // Queues to hold valid values and errors separately
  const validQueue = new Set<IteratorResult<V>>();
  const errorQueue = new Set<IteratorResult<E>>();

  // Shared state to manage the iteration process
  const sharedState = {
    done: false,
    validQueue,
    errorQueue,
  };

  /**
   * Creates an async sub-iterator that pulls values from the source based on whether they are valid or errors.
   * @param _sourceIterator The iterator providing values from the source.
   * @param _state The shared state containing queues and flags for managing iteration.
   * @param _type Indicates whether this sub-iterator is handling errors.
   */
  async function* createSubIterator<I>(
    _sourceIterator: AsyncIterator<V | E>,
    _state: typeof sharedState,
    _type: { error: boolean }
  ): AsyncGenerator<I, I> {
    while (true) {
      // Continue pulling values from the source until done or queues are populated
      if (!_state.done && (
        _state.validQueue.size <= 0 ||
        _state.errorQueue.size <= 0
      )) {
        try {
          // Pull the next value from the source iterator
          const result = await _sourceIterator.next();

          // Place valid values into the valid queue, it will automatically handle the termination of the iterator
          _state.validQueue.add(result as IteratorResult<V>);

          // Handle the end of iteration
          if (result.done) {
            _state.done = true;

            // Push the done message to the error queue so the iterator can terminate
            _state.errorQueue.add({ value: undefined, done: true } as IteratorResult<E>);
          }
        } catch (error) {
          // Catch any error that occurs during iteration and add it to the error queue
          _state.errorQueue.add({ value: error as E, done: false } as IteratorResult<E>);
        }
      }

      // Pull the next item from the appropriate queue
      let result: IteratorResult<V | E> | undefined;
      if (_type.error) {
        // Handle errors
        result = _state.errorQueue.values().next().value;
        _state.errorQueue.delete(result as IteratorResult<E>); // Remove from the queue after processing
      } else {
        // Handle valid values
        result = _state.validQueue.values().next().value;
        _state.validQueue.delete(result as IteratorResult<V>); // Remove from the queue after processing
      }

      // Skip if the result is null or undefined
      // This can happen if the queue is empty or the iterator is done
      if (!result) {
        // If the iterator is done, return undefined
        if (_state.done) return result as I; 
        continue;
      }

      // If the iteration is complete, return the final value
      if (result?.done) {
        // Clear the queues if this is the last value
        if (!_type.error) _state.validQueue.clear();
        else _state.errorQueue.clear();

        return result?.value as I;
      }

      // Yield the value if it's appropriate for this iterator (valid or error)
      yield result?.value as I;
    }
  }

  // Return the two sub-iterators: one for valid values and one for errors
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
 * ### How It Works
 * - This function creates two queues: `matchQueue` for values that satisfy the predicate and `nonMatchQueue` for values that do not.
 * - As the source iterator is processed, values are placed into the appropriate queue based on whether they match the predicate.
 * - Each sub-iterator pulls values from its corresponding queue, ensuring that values are processed independently based on the predicate.
 * 
 * ### Iterator Behavior
 * - The source iterator yields values one at a time, and these are placed in either the `matchQueue` or the `nonMatchQueue` based on the predicate function.
 * - The `done` state signals when the iterator has finished yielding all values, allowing each sub-iterator to terminate gracefully.
 *
 * ### Error Handling
 * - If an error occurs during iteration, it is thrown and will terminate the entire operation.
 * - Values are added to their respective queues, and the iteration only stops when the `done` flag is set to `true`.
 *
 * ### Why We Use Sets for Queues
 * - `Set`s are used to store the results because they automatically handle uniqueness and provide efficient add and delete operations.
 * - Values are deleted from the `Set` after being processed to avoid duplication and memory leaks.
 *
 * @template T The type of values being iterated over by the source.
 * @template F The type of values being directed to the second iterator.
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
  
  // Queues to hold values based on the predicate outcome
  const trueQueue = new Set<IteratorResult<T>>();
  const falseQueue = new Set<IteratorResult<F>>();

  // Shared state for managing the iteration process
  const sharedState = {
    done: false,
    trueQueue,
    falseQueue,
  };

  /**
   * Creates an async sub-iterator that pulls values from the source based on the predicate.
   * @param _sourceIterator The iterator providing values from the source.
   * @param _state The shared state containing queues and flags for managing iteration.
   * @param _type Indicates whether this sub-iterator is matching the predicate or not.
   */
  async function* createSubIterator<I>(
    _sourceIterator: AsyncIterator<T | F>,
    _state: typeof sharedState,
    _type: { match: boolean },
  ): AsyncGenerator<I, I> {
    while (true) {
      // Continue pulling values from the source until done or queues are populated
      if (!_state.done && (_state.trueQueue.size <= 0 || _state.falseQueue.size <= 0)) {
        // Pull the next value from the source iterator
        const result = await sourceIterator.next();

        // Check if the value matches the predicate
        const match = await predicate(result.value);

        // Place the result in the appropriate queue
        if (match) {
          _state.trueQueue.add(result as IteratorResult<T>);
        } else {
          _state.falseQueue.add(result as IteratorResult<F>);
        }

        // Handle the end of iteration
        if (result.done) {
          _state.done = true;

          // Push the done message to the false queue so the iterator can terminate
          _state.trueQueue.add({ value: undefined, done: true } as IteratorResult<T>);
          _state.falseQueue.add({ value: undefined, done: true } as IteratorResult<F>);
        }
      }

      // Get the next value from the appropriate queue
      let result: IteratorResult<T | F> | undefined;

      if (_type.match) {
        result = _state.trueQueue.values().next().value;
        _state.trueQueue.delete(result as IteratorResult<T>); // Remove from queue after processing
      } else {
        result = _state.falseQueue.values().next().value;
        _state.falseQueue.delete(result as IteratorResult<F>); // Remove from queue after processing
      }

      // Skip if the result is null or undefined
      // This can happen if the queue is empty or the iterator is done
      if (!result) {
        // If the iterator is done, return undefined
        if (_state.done) return result as I; 
        continue;
      }

      // If the result is done, return the final value
      if (result?.done) {
        // Clear the queues if this is the last value
        if (_type.match) _state.trueQueue.clear();
        else _state.falseQueue.clear();

        return result?.value as I;
      }

      // Yield the value if it's appropriate for this iterator (match or non-match)
      yield result?.value as I;
    }
  }

  // Return two sub-iterators: one for values that match the predicate and one for values that do not
  return [
    createSubIterator<T>(sourceIterator, sharedState, { match: true }),
    createSubIterator<F>(sourceIterator, sharedState, { match: false }),
  ] as const;
}
