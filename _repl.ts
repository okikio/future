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
  (async () => {
    try {
      const iterator = Future.withConcurrencyLimit([
        Future.from(gen),
        Future.inBackground(
          Future.from<string | number>(async function* () {
            // throw new Error("Random message");
          
            yield "---> InBackground: 154";
            yield "---> InBackground: 200";
            // Simulate a long-running task
            await Future.delay(1000, 50);
            // yield new Promise((resolve, reject) => {
            //   const timeout = setTimeout(resolve, 100, 50);
            //   abort.signal.addEventListener("abort", () => {
            //     clearTimeout(timeout);
            //     reject(new Error("Aborted"));
            //   }, { once: true });
            // });
            yield "---> InBackground: 42";
            yield "---> InBackground: 54";
            yield "---> InBackground: 65";
          
            // yield new Error("Random message");
            return "---> InBackground: 42";
          })
        ),
      ], 4);
      // setTimeout(() => iterator.cancel(), 1000);

      for await (const value of iterator) {
        console.log("Concurrent Value:", value);
      }
    } catch (e) {
      console.log("Future", { e });
    }
  })(),
]);

console.log("Done!!!");

const futures = [
  Future.from(async function* () {
    yield 42;
    return 100;
  }),
  Future.from(async function* () {
    yield 10;
    return 20;
  })
];
const limitedFuture = Future.withConcurrencyLimit(futures, 2);
// Yield intermediate results
for await (const value of limitedFuture) {
  console.log(value); // Logs 42 and 10 as they are yielded
}
// Get the final results
const finalResults = await limitedFuture.toPromise();
console.log(finalResults); // Logs [100, 20], which are the final results of the futures.