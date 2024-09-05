/**
 * `DualDisposable` interface combines the capabilities of both `Disposable` and `AsyncDisposable` interfaces.
 *
 * This interface is used for objects that require explicit resource management, typically for cleaning up
 * resources such as file handles, database connections, or any other resources that need to be disposed
 * of when no longer in use.
 *
 * @example
 * ```typescript
 * class MyResource implements DualDisposable {
 *   [Symbol.dispose]() {
 *     // Synchronous cleanup logic
 *   }
 *
 *   async [Symbol.asyncDispose]() {
 *     // Asynchronous cleanup logic
 *   }
 * }
 *
 * const resource = new MyResource();
 *
 * // Ensure resource is disposed synchronously
 * using (resource) {
 *   // Work with resource
 * }
 *
 * // Ensure resource is disposed asynchronously
 * await using (await resource) {
 *   // Work with resource asynchronously
 * }
 * ```
 *
 * The `Symbol.dispose` method will be invoked automatically when the scope in which the `using` keyword is used
 * is exited, ensuring that resources are properly released. Similarly, `Symbol.asyncDispose` will be called
 * for asynchronous disposal.
 *
 * @interface
 * @extends Disposable
 * @extends AsyncDisposable
 */
export interface DualDisposable extends Disposable, AsyncDisposable { }

/**
 * `WithDisposal` is a utility type that enhances a given type `T` by combining it with
 * one or more disposal interfaces (`Disposable`, `AsyncDisposable`, or `DualDisposable`).
 * 
 * This type is useful when you want to ensure that an object not only fulfills its primary role 
 * but also conforms to a disposal pattern, making it easier to manage resources explicitly.
 *
 * @example
 * ```typescript
 * class MyResource implements DualDisposable {
 *   [Symbol.dispose]() {
 *     // Synchronous cleanup logic
 *   }
 * 
 *   async [Symbol.asyncDispose]() {
 *     // Asynchronous cleanup logic
 *   }
 * }
 * 
 * let resource: WithDisposal<MyResource>;
 * ```
 *
 * @type
 * @template T - The primary type to be combined with a disposal interface.
 */
export type WithDisposal<T> = T & (Disposable | AsyncDisposable | DualDisposable);


/**
 * An interface representing a `ReadableStream` with added disposal capabilities.
 * This interface extends the `ReadableStream` and includes methods for both
 * synchronous and asynchronous disposal of the stream.
 *
 * @template T - The type of data in the `ReadableStream`.
 */
export interface ReadableStreamDefaultReaderWithDisposal<T> extends ReadableStreamDefaultReader<T>, DualDisposable { }
export interface ReadableStreamBYOBReaderWithDisposal extends ReadableStreamBYOBReader, DualDisposable { }
export type ReadableStreamReaderWithDisposal<T> = ReadableStreamDefaultReaderWithDisposal<T> | ReadableStreamBYOBReaderWithDisposal;


/**
 * An interface representing a `ReadableStream` with added disposal capabilities.
 * This interface extends the `ReadableStream` and includes methods for both
 * synchronous and asynchronous disposal of the stream.
 *
 * @template T - The type of data in the `ReadableStream`.
 */
export interface ReadableStreamWithDisposal<T> extends ReadableStream<T>, DualDisposable { }

export type EnhancedReadableStream<T> = Omit<ReadableStreamWithDisposal<T>, "getReader"> & {
  getReader(options: { mode: "byob" }): ReadableStreamBYOBReaderWithDisposal;
  getReader(): ReadableStreamDefaultReaderWithDisposal<T>;
  getReader(options?: ReadableStreamGetReaderOptions): ReadableStreamReaderWithDisposal<T>;
  getReader(...args: Parameters<ReadableStream<T>["getReader"]>): ReadableStreamReaderWithDisposal<T>;
}

/**
 * A `PromiseWithDisposable` is an extension of the standard `Promise` interface, designed to include
 * the ability to clean up resources once the promise is no longer needed or has completed its operation.
 *
 * ## What is a Disposable?
 *
 * A **disposable** is an object that implements the `Disposable` and/or `AsyncDisposable` interfaces,
 * providing a standard way to release or clean up resources, such as memory or file handles, when they
 * are no longer needed. This is particularly important in scenarios where failing to release resources
 * can lead to memory leaks or other performance issues.
 *
 * The `Disposable` interface typically includes a `dispose` method, which can be called to perform
 * synchronous cleanup. The `AsyncDisposable` interface includes an `asyncDispose` method, which is
 * used for asynchronous cleanup operations.
 *
 * When using a `PromiseWithDisposable`, you can be confident that any associated resources will be
 * properly cleaned up once the promise is settled (resolved or rejected) or when it's manually disposed of.
 * This makes it particularly useful in scenarios where promises represent operations tied to external
 * resources, such as file I/O, network requests, or UI components.
 *
 * @template T - The type of the value that the promise resolves to.
 *
 * @example
 * ```typescript
 * // Create a disposable promise
 * const disposablePromise: PromiseWithDisposable<string> = someAsyncOperation();
 *
 * // Use the promise as you would any other promise
 * disposablePromise.then(result => console.log(result));
 *
 * // When done, dispose of the promise to clean up resources
 * disposablePromise[Symbol.dispose]();
 * ```
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise Promise Documentation}
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol/dispose Symbol.dispose Documentation}
 */
export interface PromiseWithDisposal<T> extends Promise<T>, DualDisposable { }

/**
 * Extends `PromiseWithDisposable` with additional properties for handling abortable operations.
 *
 * @template T - The type of the value that the promise resolves to.
 */
export interface AbortablePromiseWithDisposal<T>
  extends PromiseWithDisposal<T> {
  /**
   * The `AbortSignal` associated with this promise, which allows the promise to be aborted.
   */
  signal: AbortSignal | null;

  /**
   * The `AbortController` used to control the abort signal. If the signal was passed in, this will be `null`.
   */
  controller: AbortController | null;
}

/**
 * This module provides utility functions for creating both unidirectional and bidirectional communication channels built on top of Web Streams.
 * The channels enable data flow between one or more producers (writers) and multiple consumers (readers), with support for full-duplex communication in the bidirectional case.
 *
 * The unidirectional `createChannel` function allows multiple independent readers to access the same stream of data written by one or more producers.
 * The bidirectional `createBidirectionalChannel` function enables two endpoints to communicate in a full-duplex manner, each with its own readable and writable streams.
 *
 * Both types of channels support proper resource disposal via `Symbol.dispose`, and the writable streams are accessible for piping or direct writing, while the readable streams allow for multiple independent consumers.
 *
 * The Web Streams API serves as the foundation for these channels, offering efficient handling of continuous or large data flows with built-in backpressure management. This makes them ideal for scenarios such as real-time communication, file processing, or network data streaming.
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/Streams_API Streams API Documentation} for more details on Web Streams.
 *
 * @module
 */

/**
 * Interface representing a unidirectional communication channel.
 *
 * @template T - The type of data transmitted through the channel.
 */
export interface Channel<T> {
  /**
   * The writable stream that can be used for piping or writing directly.
   */
  readonly writable: WritableStream<T>;

  /**
   * Method to get the shared writer for direct writing.
   * @returns WritableStreamDefaultWriter<T>
   */
  getWriter(): WritableStreamDefaultWriter<T>;

  /**
   * Getter for the readable stream, which supports multiple readers via tee.
   * Each time it's accessed, it provides a new reader wrapped with disposal support.
   *
   * @returns A new readable stream with disposal support.
   */
  readonly readable: EnhancedReadableStream<T>;

  /**
   * Closes the channel by closing the shared writer and canceling all branches of the readable stream.
   */
  close(): void;

  /**
   * Disposes of the channel resources using the Symbol.dispose protocol.
   */
  [Symbol.dispose](): void;

  /**
   * Asynchronously disposes of the channel resources using the Symbol.asyncDispose protocol.
   * This ensures that all readers are properly canceled and cleaned up asynchronously.
   * @returns A promise that resolves when the disposal is complete.
   */
  [Symbol.asyncDispose](): Promise<void>;
}

/**
 * Interface representing a bidirectional communication channel.
 *
 * @template TRequest - The type of data sent from endpoint A to B.
 * @template TResponse - The type of data sent from endpoint B to A.
 */
export interface BidirectionalChannel<TRequest, TResponse> {
  /**
   * Endpoint A can write requests and read responses.
   */
  readonly endpointA: {
    readonly writer: WritableStreamDefaultWriter<TRequest>;
    readonly readable: EnhancedReadableStream<TResponse>;
  };

  /**
   * Endpoint B can write responses and read requests.
   */
  readonly endpointB: {
    readonly writer: WritableStreamDefaultWriter<TResponse>;
    readonly readable: EnhancedReadableStream<TRequest>;
  };

  /**
   * Disposes of the bidirectional channel resources using the Symbol.dispose protocol.
   * This ensures that all streams are closed and resources are released.
   */
  [Symbol.dispose](): void;

  /**
   * Asynchronously disposes of the bidirectional channel resources using the Symbol.asyncDispose protocol.
   * This ensures that all streams are closed and resources are released asynchronously.
   * @returns A promise that resolves when the disposal is complete.
   */
  [Symbol.asyncDispose](): Promise<void>;
}


export interface FutureOperation<T, TReturn, TNext> {
  (
    abort: AbortController,
    disposables: AsyncDisposableStack,
  ): AsyncGenerator<T, TReturn, TNext> | Generator<T, TReturn, TNext>;
}


export interface FutureFromOperation<T, TReturn, TNext> {
  (
    abort: AbortController,
    disposables: AsyncDisposableStack,
  ): ReturnType<FutureOperation<T, TReturn, TNext>> | PromiseLike<T> | T;
}