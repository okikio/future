import { Future } from "./future.ts";

/**
 * Provides resolvers for manually controlling the resolution of a future.
 * @returns An object containing the Future, the resolve and reject methods.
 */
export function withResolvers<TReturn>(): FutureWithResolvers<TReturn> {
  const { promise, resolve, reject } = Promise.withResolvers<TReturn>();
  const future = Future.fromPromise(promise);

  return {
    future,
    resolve,
    reject
  };
}

export interface FutureWithResolvers<TReturn> extends Omit<PromiseWithResolvers<TReturn>, "promise"> {
  future: Future<TReturn, TReturn, undefined>;
  resolve: (value: TReturn | PromiseLike<TReturn>) => void;
  reject: (reason?: unknown) => void;
}