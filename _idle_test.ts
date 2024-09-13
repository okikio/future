import { test } from "@libs/testing";
import { expect } from "@std/expect";
import { idle, cancelIdle, IDLE_TIMEOUT } from "./_idle.ts";

/**
 * Utility functions to simulate the presence or absence of `requestIdleCallback`.
 */
function simulateRequestIdleCallbackAvailable() {
  const originalRequestIdleCallback = globalThis.requestIdleCallback;
  const originalCancelIdleCallback = globalThis.cancelIdleCallback;

  globalThis.requestIdleCallback = function (
    callback: IdleRequestCallback,
    options?: IdleRequestOptions,
  ): number {
    const handle = setTimeout(() => {
      callback({
        didTimeout: false,
        timeRemaining: () => 50,
      });
    }, 0);
    return handle;
  };

  globalThis.cancelIdleCallback = function (handle: number): void {
    clearTimeout(handle);
  };

  return () => {
    globalThis.requestIdleCallback = originalRequestIdleCallback;
    globalThis.cancelIdleCallback = originalCancelIdleCallback;
  };
}

function simulateRequestIdleCallbackUnavailable() {
  const originalRequestIdleCallback = globalThis.requestIdleCallback;
  const originalCancelIdleCallback = globalThis.cancelIdleCallback;

  delete (globalThis as any).requestIdleCallback;
  delete (globalThis as any).cancelIdleCallback;

  return () => {
    globalThis.requestIdleCallback = originalRequestIdleCallback;
    globalThis.cancelIdleCallback = originalCancelIdleCallback;
  };
}

// Test Case 1: Idle callback is called with `requestIdleCallback` available
test("all")(
  "idle callback is called with requestIdleCallback available",
  async () => {
    const restore = simulateRequestIdleCallbackAvailable();

    let callbackCalled = false;

    const handle = idle((deadline) => {
      callbackCalled = true;
      expect(deadline.didTimeout).toBe(false);
      expect(deadline.timeRemaining()).toBeGreaterThan(0);
    });

    // Wait for the idle callback to be called
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(callbackCalled).toBe(true);

    // Clean up
    restore();
  },
);

// Test Case 2: Idle callback is called without `requestIdleCallback` (fallback)
test.only("all")(
  "idle callback is called without requestIdleCallback (fallback)",
  async () => {
    const restore = simulateRequestIdleCallbackUnavailable();

    let callbackCalled = false;

    const handle = idle((deadline) => {
      callbackCalled = true;
      expect(deadline.didTimeout).toBe(false);
      expect(deadline.timeRemaining()).toBeGreaterThanOrEqual(0);
    });

    // Wait for the fallback timeout to be called
    await new Promise((resolve) => setTimeout(resolve, IDLE_TIMEOUT + 10));

    expect(callbackCalled).toBe(true);

    // Clean up
    restore();
  },
);

// Test Case 4: Cancel idle callback before it's called (`requestIdleCallback` available)
test("all")(
  "idle callback is not called if canceled before execution with requestIdleCallback",
  async () => {
    const restore = simulateRequestIdleCallbackAvailable();

    let callbackCalled = false;

    const handle = idle(() => {
      callbackCalled = true;
    });

    cancelIdle(handle);

    // Wait to ensure callback would have been called
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(callbackCalled).toBe(false);

    // Clean up
    restore();
  },
);

// Test Case 5: Cancel idle callback before it's called (fallback scenario)
test("all")(
  "idle callback is not called if canceled before execution without requestIdleCallback",
  async () => {
    const restore = simulateRequestIdleCallbackUnavailable();

    let callbackCalled = false;

    const handle = idle(() => {
      callbackCalled = true;
    });

    cancelIdle(handle);

    // Wait to ensure callback would have been called
    await new Promise((resolve) => setTimeout(resolve, IDLE_TIMEOUT + 10));

    expect(callbackCalled).toBe(false);

    // Clean up
    restore();
  },
);

// Test Case 6: Schedule multiple idle callbacks and cancel one
test("all")("only non-canceled idle callbacks are called", async () => {
  const restore = simulateRequestIdleCallbackUnavailable();

  let callback1Called = false;
  let callback2Called = false;

  const handle1 = idle(() => {
    callback1Called = true;
  });

  const handle2 = idle(() => {
    callback2Called = true;
  });

  cancelIdle(handle1);

  // Wait for callbacks to be called
  await new Promise((resolve) => setTimeout(resolve, IDLE_TIMEOUT + 10));

  expect(callback1Called).toBe(false);
  expect(callback2Called).toBe(true);

  // Clean up
  restore();
});

// Test Case 7: Callback throws an error
test("all")("error in idle callback is propagated", async () => {
  const restore = simulateRequestIdleCallbackUnavailable();

  const errorMessage = "Test error";
  let errorCaught = false;

  try {
    const handle = idle(() => {
      throw new Error(errorMessage);
    });

    // Wait for the callback to be called
    await new Promise((resolve) => setTimeout(resolve, IDLE_TIMEOUT + 10));
  } catch (error) {
    errorCaught = true;
    expect(error.message).toBe(errorMessage);
  }

  expect(errorCaught).toBe(true);

  // Clean up
  restore();
});

// Test Case 8: Schedule idle callback with zero timeout
test("all")("idle callback is called immediately with zero timeout", async () => {
  const restore = simulateRequestIdleCallbackUnavailable();

  let callbackCalled = false;

  const handle = idle(
    (deadline) => {
      callbackCalled = true;
      expect(deadline.didTimeout).toBe(false);
    },
    { timeout: 0 },
  );

  // Wait a minimal amount of time
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(callbackCalled).toBe(true);

  // Clean up
  restore();
});
