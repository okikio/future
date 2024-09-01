import * as Future from "./mod.ts";

async function* gen() {
  // throw new Error("Random message");

  yield 154;
  yield 200;
  // Simulate a long-running task
  await Future.delay(1000, 50);
  // yield new Promise((resolve, reject) => {
  //   const timeout = setTimeout(resolve, 100, 50);
  //   abort.signal.addEventListener("abort", () => {
  //     clearTimeout(timeout);
  //     reject(new Error("Aborted"));
  //   }, { once: true });
  // });
  yield 42;
  yield 54;
  yield 65;

  // yield new Error("Random message");
  return 42;
}

await Promise.all([
  (async () => {
    try {
      const iterator = Future.inBackground(
        Future.from(gen),
      );
      // setTimeout(() => iterator.cancel(), 1000);

      for await (const value of iterator) {
        console.log("inBackground - Value:", value);
      }
    } catch (e) {
      console.log("Future", { e });
    }
  })(),
  (async () => {
    try {
      const iterator = Future.from(gen);
      // setTimeout(() => iterator.cancel(), 1000);

      for await (const value of iterator) {
        console.log("Normal Value:", value);
      }
    } catch (e) {
      console.log("Future", { e });
    }
  })(),
]);

console.log("Done!!!");
