// deno-lint-ignore-file no-explicit-any

// Type guards
export function isPromiseLike<T>(obj: any): obj is PromiseLike<T> {
  return typeof obj?.then === "function";
}

export function isAsyncGenerator<T, TReturn, TNext>(
  obj: any,
): obj is AsyncGenerator<T, TReturn, TNext> {
  return typeof obj?.[Symbol.asyncIterator] === "function" && (
    typeof obj?.next === "function" &&
    typeof obj?.throw === "function" &&
    typeof obj?.return === "function"
  );
}

export function isGenerator<T, TReturn, TNext>(
  obj: any,
): obj is Generator<T, TReturn, TNext> {
  return typeof obj?.[Symbol.iterator] === "function" && (
    typeof obj?.next === "function" &&
    typeof obj?.throw === "function" &&
    typeof obj?.return === "function"
  );
}

export function isAsyncIterable<T>(obj: any): obj is AsyncIterable<T> {
  return typeof obj?.[Symbol.asyncIterator] === "function";
}

export function isIterable<T>(obj: any): obj is Iterable<T> {
  return typeof obj?.[Symbol.iterator] === "function";
}

export function isBuiltinIterable<T>(obj: any): obj is Iterable<T> {
  // @ts-ignore The Iterator class provides a [Symbol.iterator]() method that returns the iterator object itself, making the iterator also iterable.
  return isIterable(obj) &&
  // @ts-ignore It also provides some helper methods for working with iterators.Typescript previously didn't respect this, but it seems in Typescript 5.6+ they will be adding the proper types for Iterator.
    obj?.[Symbol.iterator]?.() instanceof globalThis?.Iterator;
}

export function isAsyncIterator<T, TReturn, TNext>(
  obj: any,
): obj is AsyncIterator<T, TReturn, TNext> {
  return typeof obj?.next === "function";
}

export function isIterator<T, TReturn, TNext>(
  obj: any,
): obj is Iterator<T, TReturn, TNext> {
  return typeof obj?.next === "function";
}
