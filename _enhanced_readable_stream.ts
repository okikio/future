/**
 * Global constants for original ReadableStream methods.
 */
const originalReadableStreamGetReader = ReadableStream.prototype.getReader;
const originalReadableStreamCancel = ReadableStream.prototype.cancel;
const originalReadableStreamTee = ReadableStream.prototype.tee;

/**
 * Global constants for original ReadableStreamDefaultReader methods.
 */
const originalReadableStreamDefaultReaderReleaseLock =
  ReadableStreamDefaultReader.prototype.releaseLock;
const originalReadableStreamDefaultReaderCancel =
  ReadableStreamDefaultReader.prototype.cancel;

/**
 * Global constants for original ReadableStreamBYOBReader methods.
 */
const originalReadableStreamBYOBReaderReleaseLock =
  ReadableStreamBYOBReader.prototype.releaseLock;
const originalReadableStreamBYOBReaderCancel =
  ReadableStreamBYOBReader.prototype.cancel;

/**
 * A WeakMap that stores the `ReadableStreamReader` for a given `ReadableStream`.
 *
 * This map is used to track readers associated with specific streams, ensuring that each
 * stream's reader can be managed and disposed of properly.
 */
export const ReadableStreamReaderMap: WeakMap<
  ReadableStream<unknown>,
  WeakRef<ReadableStreamReaderWithDisposal<ReadableStreamReader<unknown>>>
  > = new WeakMap();

/**
 * WeakMap to track the parent of each stream branch.
 * The key is the child (branch) and the value is the parent stream.
 */
export const ReadableStreamParentMap: WeakMap<
  ReadableStream<unknown>,
  ReadableStream<unknown>
> = new WeakMap();

/**
 * WeakMap to track all branches for a given parent stream.
 * The key is the parent stream, and the value is a Set of child branches.
 */
export const ReadableStreamBranchesMap: WeakMap<
  ReadableStream<unknown>,
  Set<ReadableStream<unknown>>
> = new WeakMap();

/**
 * A WeakMap that stores the `ReadableStreamReader` for a given `ReadableStream`.
 *
 * This map is used to track readers associated with specific streams, ensuring that each
 * stream's reader can be managed and disposed of properly.
 */
export const ReadableStreamAvailableBranch: WeakMap<
  ReadableStream<unknown>,
  WeakRef<ReadableStream<unknown>>
> = new WeakMap();

/**
 * A Set that stores `ReadableStream` objects.
 *
 * This set is used to track streams that are currently active, allowing for management of
 * their lifecycle and ensuring that resources are cleaned up appropriately when streams are
 * disposed of.
 */
export const ReadableStreamSet: Set<ReadableStream<unknown>> = new Set();

/**
 * Interface representing an enhanced `ReadableStream` with disposal capabilities.
 */
export interface ReadableStreamWithDisposal<T> extends ReadableStream<T>, AsyncDisposable { }
export type EnhancedReadableStream<T> = Omit<ReadableStreamWithDisposal<T>, "getReader" | "tee"> & {
  getReader(options: { mode: "byob" }): ReadableStreamReaderWithDisposal<ReadableStreamBYOBReader>;
  getReader(): ReadableStreamReaderWithDisposal<ReadableStreamDefaultReader<T>, T>;
  getReader(options?: ReadableStreamGetReaderOptions): ReadableStreamReaderWithDisposal<ReadableStreamReader<T>, T>;
  getReader(...args: Parameters<ReadableStream<T>["getReader"]>): ReadableStreamReaderWithDisposal<ReadableStreamReader<T>, T>;
  tee(...args: Parameters<ReadableStream<T>["tee"]>): ReturnType<typeof enhancedTee<T>>;
}

/**
 * Interface representing an enhanced `ReadableStreamReader` with disposal capabilities.
 */
export type ReadableStreamReaderWithDisposal<
  R extends ReadableStreamReader<T>,
  T = unknown
> = R & AsyncDisposable & {
  stream: ReadableStream<T>;
}

/**
 * Enhances the `ReadableStream` by adding disposal capabilities.
 *
 * @template T - The type of data in the `ReadableStream`.
 * @param stream - The `ReadableStream` to wrap and enhance with disposal support.
 * @returns A new `ReadableStream` that includes methods for synchronous and asynchronous disposal.
 */
export function enhanceReadableStream<T = unknown>(
  stream: ReadableStream<T>,
): EnhancedReadableStream<T> {
  const enhancedStream = Object.assign(stream, {
    getReader(
      this: ReadableStream<T>,
      ...args: Parameters<ReadableStream<T>["getReader"]> | []
    ) { return enhancedGetReader<T>(this, ...args) },
    cancel(
      this: ReadableStream<T>,
      ...args: Parameters<ReadableStream<T>["cancel"]>
    ) { return enhancedCancel<T>(this, ...args) },
    tee(
      this: ReadableStream<T>,
      ...args: Parameters<ReadableStream<T>["tee"]>
    ) { return enhancedTee<T>(this, ...args) },
    [Symbol.asyncIterator](
      this: ReadableStream<T>
    ) { return enhancedAsyncIterator<T>(this) },
    [Symbol.asyncDispose](
      this: ReadableStream<T>
    ) { return enhancedAsyncDispose<T>(this) },
  });
  return enhancedStream as EnhancedReadableStream<T>;
}

/**
 * Overrides the default `getReader` method to track and manage the reader.
 * Ensures that the reader is properly associated with the stream and can be disposed of.
 *
 * @template T - The type of data in the `ReadableStream`.
 * @param this - The enhanced `ReadableStream` instance.
 * @param args - Arguments passed to the original `getReader` method.
 * @returns The `ReadableStreamReader` associated with the stream.
 */
export function enhancedGetReader<T>(
  stream: ReadableStream<T>,
  ...args: Parameters<ReadableStream<T>["getReader"]> | []
): ReadableStreamReaderWithDisposal<ReadableStreamReader<T>, T> {
  // If the stream has been branched before, retrieve the available branch
  const currentStream = ReadableStreamAvailableBranch.get(stream)?.deref?.() ?? stream;

  // Create two new branches of the stream
  const [inactive, active] = originalReadableStreamTee.call(currentStream);

  // If the stream is already tracked, update the available branch map with one of the branches
  ReadableStreamAvailableBranch.set(stream, new WeakRef(inactive));

  // Add both new branches to the ReadableStreamSet for lifecycle tracking
  ReadableStreamSet.add(inactive);
  ReadableStreamSet.add(active);

  // Track all branches for the parent stream in ReadableStreamBranchesMap
  trackBranches(stream, active);
  trackBranches(stream, inactive);

  // Create a new reader from the second branch using the original getReader method
  const rawReader = originalReadableStreamGetReader.apply(active, args);
  
  // Enhance the reader with disposal logic to ensure proper cleanup
  const reader = enhanceReaderWithDisposal(active as ReadableStream<T>, rawReader);

  // Track the reader in the ReadableStreamReaderMap to manage disposal
  ReadableStreamReaderMap.set(currentStream, new WeakRef(reader));

  // Return the enhanced reader
  return reader as ReadableStreamReaderWithDisposal<ReadableStreamReader<T>, T>;
}

/**
 * Tracks the branches created for a given parent stream.
 * This allows us to cancel the streams in the correct order, starting from the most recent branches.
 *
 * @param parent - The parent `ReadableStream`.
 * @param branch - The new `ReadableStream` branch created.
 */
function trackBranches(
  parent: ReadableStream<unknown>,
  branch: ReadableStream<unknown>
) {
  // Get the set of branches for the parent, or create a new set
  const branches = ReadableStreamBranchesMap.get(parent) ?? new Set<ReadableStream<unknown>>();
  
  // Add the new branch to the set
  branches.add(branch);

  // Update the branches map with the new set
  ReadableStreamBranchesMap.set(parent, branches);
}

/**
 * Provides an async iterator over the `ReadableStream`.
 *
 * Note: This method only works with the default reader, not the BYOB reader.
 *
 * @template T - The type of data in the `ReadableStream`.
 * @param this - The enhanced `ReadableStream` instance.
 */
export async function* enhancedAsyncIterator<T>(
  stream: ReadableStream<T>
): AsyncGenerator<T, void, unknown> {
  const _reader = enhancedGetReader(stream);

  if (isBYOBReader(_reader)) {
    throw new Error(
      "Cannot use async iterator with a BYOB reader. Use the default reader instead.",
    );
  }

  const reader = _reader as ReadableStreamDefaultReader<T>;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield value;
    }
  } finally {
    reader.releaseLock(); // Release the lock when done
  }
}

/**
 * Overrides the default `getReader` method to track and manage the reader.
 * Ensures that the reader is properly associated with the stream and can be disposed of.
 *
 * @template T - The type of data in the `ReadableStream`.
 * @param stream - The `ReadableStream` instance for which the reader is being requested.
 * @param args - Arguments passed to the original `getReader` method.
 * @returns The `ReadableStreamReader` associated with the stream.
 */
export async function enhancedCancel<T>(
  stream: ReadableStream<T>,
  ...args: Parameters<ReadableStream<T>["cancel"]>
): Promise<void> {
  // Stack to hold streams that need to be processed (cancelled)
  const stack: ReadableStream<unknown>[] = [stream];

  // Set to keep track of streams that have been processed to avoid reprocessing
  const cancelledStreams = new Set<ReadableStream<unknown>>();

  // Result of the original cancel method
  let result: Awaited<ReturnType<typeof originalReadableStreamCancel>>;

  console.log({
    stack,
    cancelledStreams,
  })

  // Process the stack
  while (stack.length > 0) {
    const currentStream = stack.pop()!; // Get the current stream to be cancelled

    if (cancelledStreams.has(currentStream)) {
      continue; // If the stream has already been cancelled, skip it
    }

    // Mark the stream as cancelled
    cancelledStreams.add(currentStream);

    // Cancel the current stream
    result = await originalReadableStreamCancel.apply(currentStream, args);

    // Get the branches of the current stream (if any)
    const branches = ReadableStreamBranchesMap.get(currentStream);
    if (branches) {
      // Add branches to the stack for cancellation (latest branches first)
      Array.from(branches).reverse().forEach(branch => stack.push(branch));
    }

    // Get the parent of the current stream (if any)
    const parentStream = ReadableStreamParentMap.get(currentStream);
    if (parentStream) {
      stack.push(parentStream); // Add the parent to the stack for cancellation
    }

    // Clean up the maps and sets related to the current stream
    ReadableStreamSet.delete(currentStream);
    ReadableStreamReaderMap.delete(currentStream);
    ReadableStreamAvailableBranch.delete(currentStream);
    ReadableStreamParentMap.delete(currentStream);
    ReadableStreamBranchesMap.delete(currentStream);
  }

  return result;
}

/**
 * Asynchronous disposal of the `ReadableStream`.
 *
 * This method cancels the stream and releases resources asynchronously. If the stream is
 * locked, the lock is explicitly released before the stream is canceled.
 *
 * @template T - The type of data in the `ReadableStream`.
 * @param this - The enhanced `ReadableStream` instance.
 * @param reason - The reason for disposing of the stream.
 * @returns A promise that resolves when the disposal is complete.
 */
export async function enhancedAsyncDispose<T>(
  stream: ReadableStream<T>,
  reason?: unknown,
): Promise<void> {
  if (stream.locked) {
    const reader = enhancedGetReader(stream);
    enhancedReaderAsyncDispose(reader);
  }

  return await enhancedCancel(stream, reason);
}

/**
 * Enhances a `ReadableStreamReader` by adding disposal capabilities.
 *
 * @template R - The type of the reader.
 * @param stream - The `ReadableStream` associated with the reader.
 * @param reader - The reader to enhance with disposal capabilities.
 * @returns The enhanced reader with disposal methods.
 */
export function enhanceReaderWithDisposal<R extends ReadableStreamReader<T>, T = unknown>(
  stream: ReadableStream<T>,
  reader: R,
): ReadableStreamReaderWithDisposal<R, T> {
  const enhancedReader = Object.assign(reader, {
    stream,
    cancel(
      this: ReadableStreamReaderWithDisposal<R, T>,
      ...args: Parameters<R["cancel"]>
    ) { return enhancedReaderCancel(this, ...args) },
    releaseLock(
      this: ReadableStreamReaderWithDisposal<R, T>,
      ...args: Parameters<R["releaseLock"]>
    ) { return enhancedReaderReleaseLock(this, ...args) },
    [Symbol.asyncDispose](
      this: ReadableStreamReaderWithDisposal<R, T>,
    ) { return enhancedReaderAsyncDispose(this) },
  });
  return enhancedReader;
}

/**
 * Overrides the `releaseLock` method to ensure proper cleanup.
 *
 * @template R - The type of the reader.
 * @param this - The enhanced reader instance.
 * @param args - Arguments passed to the original `releaseLock` method.
 */
export function enhancedReaderReleaseLock<R extends ReadableStreamReader<T>, T = unknown>(
  reader: ReadableStreamReaderWithDisposal<R, T> | ReadableStreamReader<T>,
  ...args: Parameters<R["releaseLock"]> | []
) {
  const originalReleaseLock = isBYOBReader(reader)
    ? originalReadableStreamBYOBReaderReleaseLock
    : originalReadableStreamDefaultReaderReleaseLock;

  const result = originalReleaseLock.apply(reader, args);
  if ("stream" in reader) {
    ReadableStreamReaderMap.delete(reader.stream);
    reader.stream = null as unknown as ReadableStream<T>;
  }
  return result;
}

/**
 * Overrides the `cancel` method to ensure proper cleanup.
 *
 * @template R - The type of the reader.
 * @param this - The enhanced reader instance.
 * @param args - Arguments passed to the original `cancel` method.
 * @returns A promise that resolves when the reader has been canceled.
 */
export async function enhancedReaderCancel<
  R extends ReadableStreamReader<T>,
  T = unknown
>(
  reader: ReadableStreamReaderWithDisposal<R, T> | ReadableStreamReader<T>,
  ...args: Parameters<R["cancel"]> | []
) {
  const originalCancel = isBYOBReader(reader)
    ? originalReadableStreamBYOBReaderCancel
    : originalReadableStreamDefaultReaderCancel;

  const result = await originalCancel.apply(reader, args);
  if ("stream" in reader) {
    ReadableStreamReaderMap.delete(reader.stream);
    reader.stream = null as unknown as ReadableStream<T>;
  }
  return result;
}

/**
 * Asynchronous disposal of the `ReadableStreamReader`.
 *
 * This method cancels the reader and releases the lock asynchronously.
 *
 * @template R - The type of the reader.
 * @param this - The enhanced reader instance.
 * @param args - Arguments passed to the original `cancel` method.
 * @returns A promise that resolves when the disposal is complete.
 */
export async function enhancedReaderAsyncDispose<
  R extends ReadableStreamReader<T>,
  T = unknown
>(
  reader: ReadableStreamReaderWithDisposal<R, T> | ReadableStreamReader<T>,
) {
  await enhancedReaderCancel(reader);
  enhancedReaderReleaseLock(reader);
}

/**
 * Custom tee function that works with enhanced streams.
 * Splits the stream into two branches, each of which is an enhanced stream.
 */
export function enhancedTee<T>(
  stream: ReadableStream<T>, 
  ..._args: Parameters<ReadableStream<T>["tee"]> | []
): [EnhancedReadableStream<T>, EnhancedReadableStream<T>] {
  // Create two TransformStreams to act as branches
  const branch1 = new TransformStream<T>();
  const branch2 = new TransformStream<T>();

  // Start reading from the original stream and write to both branches
  (async () => {
    const reader = stream.getReader();
    const writer1 = branch1.writable.getWriter();
    const writer2 = branch2.writable.getWriter();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          await writer1.close();
          await writer2.close();
          break;
        }
        await Promise.all([
          writer1.write(value),
          writer2.write(value),
        ]);
      }
    } catch (error) {
      await writer1.abort(error);
      await writer2.abort(error);
    } finally {
      reader.releaseLock();
      writer1.releaseLock();
      writer2.releaseLock();
    }
  })();

  // Enhance the branches
  const enhancedBranch1 = enhanceReadableStream(branch1.readable);
  const enhancedBranch2 = enhanceReadableStream(branch2.readable);

  return [enhancedBranch1, enhancedBranch2];
}

/**
 * Custom pipeTo function that works with enhanced streams.
 * Pipes the stream to a writable destination.
 */
export async function enhancedPipeTo<T>(
  stream: ReadableStream<T>,
  destination: WritableStream<T>,
  options?: StreamPipeOptions
): Promise<void> {
  options = options ?? {};
  const { preventClose = false, preventAbort = false, preventCancel = false, signal } = options;

  const reader = stream.getReader();
  const writer = destination.getWriter();

  let shuttingDown = false;
  let currentWrite: Promise<void> = Promise.resolve();

  // Handle abort signal
  if (signal) {
    if (signal.aborted) {
      await abort();
      throw new DOMException("Aborted", "AbortError");
    }
    signal.addEventListener("abort", () => {
      abort().catch(() => {});
    }, { once: true });
  }

  async function abort() {
    if (shuttingDown) return;
    shuttingDown = true;

    const actions = [];

    if (!preventAbort) {
      actions.push(writer.abort(new DOMException("Aborted", "AbortError")));
    } else {
      actions.push(writer.releaseLock());
    }

    if (!preventCancel) {
      actions.push(reader.cancel(new DOMException("Aborted", "AbortError")));
    } else {
      actions.push(reader.releaseLock());
    }

    await Promise.all(actions);
  }

  async function pipeLoop(): Promise<void> {
    while (true) {
      let readResult: ReadableStreamReadResult<T>;
      try {
        readResult = await reader.read();
        if (readResult.done) {
          break;
        }
      } catch (readError) {
        if (!preventAbort) {
          try {
            await writer.abort(readError);
          } catch {
            // Ignore errors during abort
          }
        }
        throw readError;
      }

      try {
        currentWrite = writer.write(readResult.value);
        await currentWrite;
      } catch (writeError) {
        if (!preventCancel) {
          try {
            await reader.cancel(writeError);
          } catch {
            // Ignore errors during cancel
          }
        }
        throw writeError;
      }
    }
  }

  try {
    await pipeLoop();

    if (!preventClose) {
      await writer.close();
    } else {
      writer.releaseLock();
    }
  } catch (error) {
    // Handle errors already handled in pipeLoop
    throw error;
  } finally {
    reader.releaseLock();
    writer.releaseLock();
  }
}


/**
 * Type guard to check if a reader is a BYOB reader.
 *
 * @param reader - The reader to check.
 * @returns True if the reader is a BYOB reader, false otherwise.
 */
function isBYOBReader(
  reader: any,
): reader is ReadableStreamBYOBReader {
  return 'readAtLeast' in reader || 'byobRequest' in reader;
}
