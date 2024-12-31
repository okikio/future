/**
 * Creates an infinite `ReadableStream` that emits sequential numbers at a specified interval.
 *
 * @param delay - The delay in milliseconds between each number emitted. Defaults to 10ms.
 * @returns A `ReadableStream` that emits numbers starting from 0, incremented by 1 at each interval.
 *
 * @example
 * ```ts
 * const infiniteStream = createInfiniteStream(1000); // Emits a number every 1 second
 * const reader = infiniteStream.getReader();
 * reader.read().then(({ value, done }) => {
 *   console.log(value); // Outputs: 0
 * });
 * ```
 */
function createInfiniteStream(delay = 10) {
  let intervalId: ReturnType<typeof setInterval>;
  return new ReadableStream({
    start(controller) {
      // Initialize a counter to emit sequential numbers
      let count = 0;
      // Use setInterval to enqueue numbers at the specified delay
      intervalId = setInterval(() => {
        controller.enqueue(count++);
      }, delay);
    },
    cancel() {
      // Clean up the interval when the stream is canceled
      clearInterval(intervalId);
    }
  });
}

/**
 * Custom `tee` function that splits a `ReadableStream` into two branches with additional control and tracking.
 *
 * This function acts similarly to the native `ReadableStream.tee()` method but provides enhanced functionality
 * such as tracking availability and supporting asynchronous disposal.
 *
 * @typeParam T - The type of data chunks emitted by the stream.
 * @param stream - The original `ReadableStream` to split.
 * @returns A tuple containing two new `ReadableStreams`, a `Promise` that resolves when the streams are available,
 *          and implements `AsyncDisposable` for proper cleanup.
 *
 * @example
 * ```ts
 * const [branch1, branch2, available] = enhancedTee(originalStream);
 * // Use branch1 and branch2 independently
 * ```
 *
 * @remarks
 * This function is designed to work with streams that need enhanced control over cancellation and resource management.
 * It ensures that both branches are properly handled in case of errors or cancellations.
 */
export function enhancedTee<T>(
  stream: ReadableStream<T>,
  ..._args: Parameters<ReadableStream<T>["tee"]> | []
): [ReadableStream<T>, ReadableStream<T>, Promise<boolean>] & AsyncDisposable {
  // Create two TransformStreams to act as branches.
  // TransformStream allows us to write to its writable end and read from its readable end.
  const branch1 = new TransformStream<T>();
  const branch2 = new TransformStream<T>();

  // Create a promise that will be resolved when the branches are fully set up.
  const { promise: available, resolve } = Promise.withResolvers<boolean>();

  // Start an async function to read from the original stream and write to both branches.
  (async () => {
    // Get a reader from the original stream to read data chunks.
    const reader = stream.getReader();
    // Get writers for both branches to write data into them.
    const writer1 = branch1.writable.getWriter();
    const writer2 = branch2.writable.getWriter();

    try {
      while (true) {
        // Read a chunk from the original stream.
        const { done, value } = await reader.read();
        if (done) {
          // If the original stream is done, close both writers.
          // Use Promise.any to proceed as soon as one writer is closed successfully.
          await Promise.any([
            writer1.close(),
            writer2.close()
          ]);
          break;
        }

        // Write the chunk to both branches.
        // Use Promise.any to proceed as soon as one write is successful.
        // This prevents the read loop from being blocked if one of the branches is slow.
        await Promise.any([
          writer1.write(value),
          writer2.write(value)
        ]);
      }
    } catch (error) {
      // If an error occurs, abort both writers.
      // Use Promise.all to ensure both writers are aborted.
      await Promise.all([
        writer1.abort(error),
        writer2.abort(error)
      ]);
    } finally {
      // Release the locks on the reader and writers.
      reader.releaseLock();
      writer1.releaseLock();
      writer2.releaseLock();
      // Resolve the available promise to signal that the branches are available.
      resolve(true);
    }
  })();

  // Get the readable ends of the TransformStreams to return as the branches.
  const stream1 = branch1.readable;
  const stream2 = branch2.readable;

  // Prepare the result tuple with the two branches and the availability promise.
  const result: [
    ReadableStream<T>,
    ReadableStream<T>,
    Promise<boolean>
  ] = [stream1, stream2, available];

  // Implement AsyncDisposable to allow for proper cleanup.
  return Object.assign(result, {
    async [Symbol.asyncDispose]() {
      const err = new Error("Cancelled");
      // Cancel both branches and wait for them to be available.
      await Promise.all([
        stream1.cancel(err),
        stream2.cancel(err),
        available
      ]);
    }
  });
}

/**
 * Metadata interface for tracking streams and their relationships.
 */
interface StreamMetadata<T> {
  id?: string;                       // Optional identifier for debugging.
  available: Promise<boolean>;       // Promise that resolves when the stream is available.
  parent: ReadableStream<T> | null;  // Parent stream, if any.
  children: Set<ReadableStream<T>>;  // Set of child streams.
}

// Registry to keep track of streams and their metadata.
const ReadableStreamRegistry = new WeakMap<ReadableStream<any>, StreamMetadata<any>>();
// Map to track the current inactive streams associated with each source stream.
const AvailableReadableStream = new WeakMap<ReadableStream<any>, ReadableStream<any>>();
// Map to keep count of streams created from each source stream.
const ReadableStreamCounter = new WeakMap<ReadableStream<any>, number>();

/**
 * Creates a new `ReadableStream<T>` from a source stream, allowing dynamic branching.
 *
 * This function maintains a registry of streams and their relationships, enabling the creation of multiple
 * readable streams from a single source stream. It uses an enhanced tee function to split the current inactive
 * stream into active and inactive branches.
 *
 * @typeParam T - The type of data chunks emitted by the stream.
 * @param sourceStream - The original `ReadableStream` to create a new readable from.
 * @returns A new `ReadableStream<T>` that reads data from the source stream.
 *
 * @example
 * ```ts
 * const sourceStream = createInfiniteStream();
 * const streamA = createReadable(sourceStream);
 * const streamB = createReadable(sourceStream);
 * // Now streamA and streamB are independent readers of the sourceStream.
 * ```
 *
 * @remarks
 * This function keeps track of the current inactive stream associated with the source stream.
 * Each time `createReadable` is called, it splits the current inactive stream into active and inactive branches.
 * The active branch is returned, and the inactive branch becomes the new current inactive stream.
 * This allows for dynamic creation of new readables from the source stream at any time.
 */
function createReadable<T>(sourceStream: ReadableStream<T>): ReadableStream<T> {
  // Initialize the count for the sourceStream if not already set
  if (!ReadableStreamCounter.has(sourceStream)) ReadableStreamCounter.set(sourceStream, 0);

  // Get the current inactive stream associated with the sourceStream, or default to the sourceStream
  const currentInactiveStream = AvailableReadableStream.get(sourceStream) || sourceStream;

  // Use enhancedTee to split the currentInactiveStream into active and inactive branches
  const [active, inactive, available] = enhancedTee<T>(currentInactiveStream);

  // Retrieve the metadata for the currentInactiveStream from the registry
  let sourceNode = ReadableStreamRegistry.get(currentInactiveStream);

  // If the sourceNode doesn't exist, initialize it
  if (!sourceNode) {
    const count = ReadableStreamCounter.get(sourceStream)!;
    // Set metadata for the currentInactiveStream in the registry
    ReadableStreamRegistry.set(currentInactiveStream, sourceNode = {
      id: `${count}-source`,
      available,
      parent: null,
      children: new Set([active, inactive]),
    });

    // Optionally mark the sourceStream for debugging purposes
    Object.assign(sourceStream, { source: true });
    // Increment the count for the sourceStream
    ReadableStreamCounter.set(sourceStream, count + 1);
  } else {
    // If the sourceNode exists, update its available promise and add the new branches to its children
    sourceNode.available = available;
    sourceNode.children.add(active);
    sourceNode.children.add(inactive);
  }

  // Get the updated count for naming purposes
  const count = ReadableStreamCounter.get(sourceStream)!;

  // Create metadata for the active branch (the new readable to return)
  ReadableStreamRegistry.set(active, {
    id: `${count}-active`,
    available,
    parent: currentInactiveStream,
    children: new Set(),
  });
  // Optionally assign an id to the active stream for debugging
  Object.assign(active, { id: `${count}-active` });

  // Create metadata for the inactive branch (the new current inactive stream)
  ReadableStreamRegistry.set(inactive, {
    id: `${count}-inactive`,
    available,
    parent: currentInactiveStream,
    children: new Set(),
  });
  // Optionally assign an id to the inactive stream for debugging
  Object.assign(inactive, { id: `${count}-inactive` });

  // Update the currentStreams map with inactive as the new current inactive stream
  AvailableReadableStream.set(sourceStream, inactive);
  // Increment the count for the sourceStream
  ReadableStreamCounter.set(sourceStream, count + 1);

  // Return the active branch as the new readable stream
  return active;
}

/**
 * Cancels all streams starting from the given `sourceStream`, recursively canceling all its children.
 *
 * This function traverses the stream tree starting from the `sourceStream` and cancels each stream,
 * ensuring that resources are properly cleaned up.
 *
 * @typeParam T - The type of data chunks emitted by the streams.
 * @param sourceStream - The original `ReadableStream` from which to start cancellation.
 * @returns A `Promise` that resolves when all streams have been canceled.
 *
 * @example
 * await cancelAll(sourceStream);
 *
 * @remarks
 * This function uses a stack to perform a depth-first traversal of the stream tree.
 * It keeps track of visited streams to prevent processing the same stream multiple times.
 * After canceling each stream, it updates the registry and currentStreams maps accordingly.
 */
async function cancelAll<T>(sourceStream: ReadableStream<T>): Promise<void> {
  // Initialize the stack with the sourceStream
  const stack = [[sourceStream]];
  // Initialize a set to keep track of visited streams
  const visited = new WeakSet<ReadableStream<T>>();

  // Perform a depth-first traversal of the stream tree
  for (let i = 0; i < stack.length; i++) {
    const queue = stack[i];
    const len = queue.length;

    for (let j = 0; j < len; j++) {
      const stream = queue[j];

      if (!visited.has(stream)) {
        // Get the metadata for the stream
        const node = ReadableStreamRegistry.get(stream);
        if (node?.children?.size) {
          // If the stream has children, add them to the stack for later processing
          stack.push(Array.from(node.children));
        }

        // Mark the stream as visited
        visited.add(stream);
      }
    }
  }

  // Cancel streams in reverse order to ensure proper cleanup
  while (stack.length > 0) {
    // Get the streams at the current level
    const streams = stack.pop();

    // Cancel each stream at this level
    const cancellations = Array.from(streams ?? [], async substream => {
      // Get the metadata for the substream
      const substreamMetadata = ReadableStreamRegistry.get(substream);
      // Cancel the substream, passing its id as a reason (optional)
      await substream.cancel(substreamMetadata?.id);

      // Get the parent stream
      const parent = substreamMetadata?.parent!;
      // Get the metadata for the parent
      const metadata = ReadableStreamRegistry.get(parent);
      // Wait for the parent's available promise to ensure it's ready
      await metadata?.available;

      // Remove the substream from the parent's children
      metadata?.children.delete(substream);
      // Remove the substream from the registry
      ReadableStreamRegistry.delete(substream);

      // Return the substream's metadata for debugging or logging
      return Object.assign({}, substreamMetadata, substream);
    });

    // Wait for all cancellations at this level to complete
    await Promise.all(cancellations);
  }

  // Clean up the currentStreams map
  AvailableReadableStream.delete(sourceStream);
  ReadableStreamCounter.delete(sourceStream);
}

// Usage Example

// Initialize the source stream
const sourceStream = createInfiniteStream();

// Dynamically create new readables
const streamA = createReadable(sourceStream);
const streamB = createReadable(sourceStream);

// Use the streams as needed
const readerA = streamA.getReader();
const readerB = streamB.getReader();

// Read data from streamA
const valueA = await readerA.read();
console.log('Stream A Value:', valueA);

// Read data from streamB
const valueB = await readerB.read();
console.log('Stream B Value:', valueB);

// Release the readers when done
readerA.releaseLock();
readerB.releaseLock();

// When done, cancel all streams starting from the source
await cancelAll(sourceStream);

// Output the final state for debugging purposes
console.log({
  streamA,
  streamB,
  readerA: streamA.getReader(),
  readerB: streamB.getReader(),
});

// Exit the process if running in Deno
globalThis?.Deno?.exit?.(0);