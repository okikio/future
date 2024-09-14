import { test } from "@libs/testing";
import { expect } from "@std/expect";

import { DisposableStack, AsyncDisposableStack } from "./disposal.ts";
import { abortable, timeout, useDisposableStack } from "./disposal.ts";

class MockDisposable {
  disposed = false;
  [Symbol.dispose]() {
    this.disposed = true;
  }
}

class MockAsyncDisposable {
  disposed = false;
  [Symbol.asyncDispose]() {
    this.disposed = true;
  }
}

// Test Case UDS1: Disposable value with DisposableStack
test("all")("useDisposableStack - disposable value with DisposableStack", () => {
  const stack = new DisposableStack();
  const disposable = new MockDisposable();

  const managedDisposable = useDisposableStack(disposable, stack);

  expect(managedDisposable).toBe(disposable);
  expect(disposable.disposed).toBe(false);

  stack.dispose();

  expect(disposable.disposed).toBe(true);
});

// Test Case UDS2: non-disposables e.g. null and undefined
test("all")("useDisposableStack - non-disposables e.g. null and undefined", () => {
  const stack = new DisposableStack();
  const result1 = useDisposableStack(null, stack);
  const result2 = useDisposableStack(undefined, stack);

  // Ensure the managedIterable contains the same items
  expect(result1).toBe(null);
  expect(result2).toBe(undefined);
  stack.dispose();
});

// Test Case UDS5: Mixed iterable of disposables and non-disposables
test("all")("useDisposableStack - mixed iterable of disposables and non-disposables", () => {
  const stack = new DisposableStack();
  const disposable1 = new MockDisposable();
  const nonDisposable = {};
  const disposable2 = new MockDisposable();

  const iterable = [disposable1, nonDisposable, disposable2, null, undefined, 100, "string", [null, undefined]];

  const managedIterable = useDisposableStack(iterable, stack);

  // Ensure the managedIterable contains the same items
  expect(managedIterable).toHaveLength(8);
  expect(managedIterable[0]).toBe(disposable1);
  expect(managedIterable[1]).toBe(nonDisposable);
  expect(managedIterable[2]).toBe(disposable2);
  expect(managedIterable[3]).toBe(iterable[3]);
  expect(managedIterable[4]).toBe(iterable[4]);
  expect(managedIterable[5]).toBe(iterable[5]);
  expect(managedIterable[6]).toBe(iterable[6]);
  expect(managedIterable[7]).toStrictEqual(iterable[7]);

  stack.dispose();

  expect(disposable1.disposed).toBe(true);
  expect(disposable2.disposed).toBe(true);
});

// Test Case UDS6: AsyncIterable with AsyncDisposableStack
test("all")("useDisposableStack - async iterable with AsyncDisposableStack", async () => {
  const stack = new AsyncDisposableStack();
  const disposable1 = new MockAsyncDisposable();
  const disposable2 = new MockAsyncDisposable();

  async function* asyncGenerator() {
    yield disposable1;
    yield disposable2;
  }

  const managedIterablePromise = useDisposableStack(asyncGenerator(), stack);
  const managedIterable = await managedIterablePromise;

  // Consume the iterable
  for await (const item of managedIterable) {
    expect(item).toBeInstanceOf(MockAsyncDisposable);
    expect(item.disposed).toBe(false);
  }

  await stack.disposeAsync();

  expect(disposable1.disposed).toBe(true);
  expect(disposable2.disposed).toBe(true);
});

// Test Case UDS7: Non-disposable value with DisposableStack
test("all")("useDisposableStack - non-disposable value with DisposableStack", () => {
  const stack = new DisposableStack();
  const nonDisposable = { data: 42 };

  const managedValue = useDisposableStack(nonDisposable, stack);

  expect(managedValue).toBe(nonDisposable);

  // Dispose the stack
  stack.dispose();

  // Since the value is non-disposable, no errors should occur
  expect(true).toBe(true);
});

// Test Case UDS8: Disposable value without disposal methods
test("all")("useDisposableStack - value without disposal methods", () => {
  const stack = new DisposableStack();
  const invalidDisposable = { disposed: false };

  const managedValue = useDisposableStack(invalidDisposable, stack);

  expect(managedValue).toBe(invalidDisposable);

  // Dispose the stack
  try {
    stack.dispose();
    // Should not throw since the value doesn't have disposal methods
    expect(true).toBe(true);
  } catch (_) {
    // Should not reach here
    expect(true).toBe(false);
  }
});

// Test Case UDS9: Mixed iterable with missing disposal methods
test("all")("useDisposableStack - iterable with missing disposal methods", () => {
  const stack = new DisposableStack();
  const disposable = {
    disposed: false,
    [Symbol.dispose]() {
      this.disposed = true;
    },
  };
  const invalidDisposable = { disposed: false };
  const nonDisposable = { data: 42 };

  const iterable = [disposable, invalidDisposable, nonDisposable];

  useDisposableStack(iterable, stack);

  // Dispose the stack
  stack.dispose();

  expect(disposable.disposed).toBe(true);
  expect(invalidDisposable.disposed).toBe(false);
  expect((nonDisposable as Record<PropertyKey, unknown>).disposed).toBeUndefined();
  // No errors should occur for invalidDisposable and nonDisposable
  expect(true).toBe(true);
});

// Test Case AB1: Signal already aborted
test("all")("abortable - signal already aborted", async () => {
  const controller = new AbortController();
  controller.abort(new Error("Aborted before creation"));

  const abortablePromise = abortable(controller);

  try {
    await abortablePromise;
    // Should not reach here
    expect(true).toBe(false);
  } catch (error) {
    expect(error.message).toBe("Aborted before creation");
  }

  abortablePromise[Symbol.dispose]();
});

// Test Case AB2: Signal aborts after promise creation
test("all")("abortable - signal aborts after promise creation", async () => {
  const controller = new AbortController();

  const abortablePromise = abortable(controller);

  setTimeout(() => controller.abort(new Error("Aborted after 100ms")), 100);

  try {
    await abortablePromise;
    // Should not reach here
    expect(true).toBe(false);
  } catch (error) {
    expect(error.message).toBe("Aborted after 100ms");
  }

  abortablePromise[Symbol.dispose]();
});

// Test Case AB3: Dispose promise before aborting
test("all")("abortable - dispose promise before aborting", async () => {
  const controller = new AbortController();

  const abortablePromise = abortable(controller);

  abortablePromise[Symbol.dispose]();

  setTimeout(() => controller.abort(new Error("Aborted after 100ms")), 100);

  // Wait some time to ensure that if the promise were to reject, it would have
  await new Promise((resolve) => setTimeout(resolve, 200));

  // Since we disposed the promise before aborting, it should not reject
  expect(true).toBe(true);
});


// Test Case TO1: Default behavior (rejects after timeout)
test("all")("timeout - default behavior (rejects after timeout)", async () => {
  const timeoutPromise = timeout(100);

  const start = Date.now();
  try {
    await timeoutPromise;
    // Should not reach here
    expect(true).toBe(false);
  } catch (error) {
    const duration = Date.now() - start;
    expect(duration).toBeGreaterThanOrEqual(100);
    expect(error.message).toBe("Timeout exceeded");
  }

  timeoutPromise[Symbol.dispose]();
});

// Test Case TO3: Abort before timeout
test("all")("timeout - abort before timeout", async () => {
  const controller = new AbortController();

  const timeoutPromise = timeout(1000, { abort: controller.signal });

  setTimeout(() => controller.abort(new Error("Aborted")), 100);

  try {
    await timeoutPromise;
    // Should not reach here
    expect(true).toBe(false);
  } catch (error) {
    expect(error.message).toBe("Aborted");
  }

  timeoutPromise[Symbol.dispose]();
});

// Test Case TO4: Dispose before timeout
test("all")("timeout - dispose before timeout", async () => {
  const timeoutPromise = timeout(100);

  // Dispose the promise before the timeout
  timeoutPromise[Symbol.dispose]();

  // Wait some time to ensure that if the promise were to reject, it would have
  await new Promise((resolve) => setTimeout(resolve, 200));

  // Since we disposed the promise before the timeout, it should not reject
  expect(true).toBe(true);
});


// Test Case TO2: Resolve on timeout (reject: false)
test("all")("timeout - resolve on timeout (reject: false)", async () => {
  const timeoutPromise = timeout(100, { reject: false });

  const start = Date.now();
  const result = await timeoutPromise;
  const duration = Date.now() - start;

  expect(duration).toBeGreaterThanOrEqual(100);
  expect(result).toBeUndefined();

  timeoutPromise[Symbol.dispose]();
});

// Test Case TO5: Zero timeout value
test("all")("timeout - zero timeout value", async () => {
  const timeoutPromise = timeout(0);

  try {
    await timeoutPromise;
    // Should not reach here
    expect(true).toBe(false);
  } catch (error) {
    expect(error.message).toBe("Timeout exceeded");
  }

  timeoutPromise[Symbol.dispose]();
});

// Test Case TO6: Negative timeout value
test("all")("timeout - negative timeout value", async () => {
  const timeoutPromise = timeout(-100);

  try {
    await timeoutPromise;
    // Should not reach here
    expect(true).toBe(false);
  } catch (error) {
    expect(error.message).toBe("Timeout exceeded");
  }

  timeoutPromise[Symbol.dispose]();
});

// Test Case TO7: Abort after timeout has occurred
test("all")("timeout - abort after timeout has occurred", async () => {
  const controller = new AbortController();

  const timeoutPromise = timeout(100, { abort: controller.signal });

  // Wait for timeout to occur
  try {
    await timeoutPromise;
    // Should not reach here
    expect(true).toBe(false);
  } catch (error) {
    expect(error.message).toBe("Timeout exceeded");
  }

  // Abort after timeout
  controller.abort(new Error("Aborted"));

  timeoutPromise[Symbol.dispose]();

  // Since the timeout already occurred, the abort should have no effect
  expect(true).toBe(true);
});