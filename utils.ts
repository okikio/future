// Type guards
export function isPromiseLike<T>(obj: any): obj is PromiseLike<T> {
  return typeof obj?.then === "function";
}

export function isAsyncGenerator<T, TReturn, TNext>(obj: any): obj is AsyncGenerator<T, TReturn, TNext> {
  return typeof obj?.[Symbol.asyncIterator] === "function";
}

export function isGenerator<T, TReturn, TNext>(obj: any): obj is Generator<T, TReturn, TNext> {
  return typeof obj?.[Symbol.iterator] === "function";
}

export function isAsyncIterable<T>(obj: any): obj is AsyncIterable<T> {
  return typeof obj?.[Symbol.asyncIterator] === "function";
}

export function isIterable<T>(obj: any): obj is Iterable<T> {
  return typeof obj?.[Symbol.iterator] === "function";
}

export function isAsyncIterator<T, TReturn, TNext>(obj: any): obj is AsyncIterator<T, TReturn, TNext> {
  return typeof obj?.next === "function";
}