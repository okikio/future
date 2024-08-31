import * as Future from "./mod.ts";

async function* gen(abort: AbortController) {
  // throw new Error("Random message");

  // Simulate a long-running task
  yield new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, 100, 50);
    abort.signal.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(new Error("Aborted"));
    }, { once: true });
  });
  yield 42;
  yield 54;
  yield 65;

  // yield new Error("Random message");
  return 42;
}

try {
  const iterator = Future.inBackground(
    Future.from(gen)
  );
  // setTimeout(() => iterator.cancel(), 1000);
  
  for await (const value of iterator) {
    console.log("Value:", value);
  }
} catch (e) {
  console.log("Future", { e });
}

console.log("Done!!!")