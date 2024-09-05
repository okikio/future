import * as Future from "./mod.ts";

async function* gen(_: unknown, stack: AsyncDisposableStack) {
  // throw new Error("Random message");
  // yield new Error("Random message");

  yield 154;
  yield 200;

  // Simulate a long-running task
  await stack.use(Future.delay(1000, 50));
  
  yield 42;
  yield 54;
  yield 65;

  return 42;
}

const result = await Promise.all([
  (async () => {
    // using future = Future.delay(5000, 50);
    using iterator = Future.inBackground(
      Future.from(gen)
    );

    for await (const value of iterator) {
      console.log("inBackground - Value:", value);
    }

    console.log(await iterator)

    return await iterator;
  })(),
  // (async () => {
  //   try {
  //     const iterator = Future.from(gen);
  //     // setTimeout(() => iterator.cancel(), 1000);

  //     for await (const value of iterator) {
  //       console.log("Normal Value:", value);
  //     }
  //   } catch (e) {
  //     console.log("Future", { e });
  //   }
  // })(),
  // (async () => {
  //   try {
  //     const iterator = Future.withConcurrencyLimit([
  //       Future.from(gen),
  //       Future.inBackground(
  //         Future.from<string | number>(async function* () {
  //           // throw new Error("Random message");

  //           yield "---> InBackground: 154";
  //           yield "---> InBackground: 200";
  //           // Simulate a long-running task
  //           await Future.delay(1000, 50);
  //           // yield new Promise((resolve, reject) => {
  //           //   const timeout = setTimeout(resolve, 100, 50);
  //           //   abort.signal.addEventListener("abort", () => {
  //           //     clearTimeout(timeout);
  //           //     reject(new Error("Aborted"));
  //           //   }, { once: true });
  //           // });
  //           yield "---> InBackground: 42";
  //           yield "---> InBackground: 54";
  //           yield "---> InBackground: 65";

  //           // yield new Error("Random message");
  //           return "---> InBackground: 42";
  //         })
  //       ),
  //     ], 4);
  //     // setTimeout(() => iterator.cancel(), 1000);

  //     for await (const value of iterator) {
  //       console.log("Concurrent Value:", value);
  //     }
  //   } catch (e) {
  //     console.log("Future", { e });
  //   }
  // })(),
]);

console.log("Done!!!", result);

// const futures = [
//   Future.from(async function* () {
//     yield 42;
//     return 100;
//   }),
//   Future.from(async function* () {
//     yield 10;
//     return 20;
//   }),
//   Future.from(async function*(_, stack) {
//     return [
//       yield* stack.use(Future.delay(0, "cool")),
//       yield* stack.use(Future.delay(2000, "delay")),
//       yield* stack.use(Future.delay(2000, "what")),
//     ];
//   })
// ];
// const limitedFuture = Future.withConcurrencyLimit<string | number, number | string[]>(futures, 2);
// console.log(
//   limitedFuture,
// )
// // Yield intermediate results
// for await (const value of limitedFuture) {
//   console.log(value); // Logs 42 and 10 as they are yielded
// }
// // Get the final results
// const finalResults = await limitedFuture.toPromise();
// console.log(finalResults); // Logs [100, 20], which are the final results of the futures.


// // Get the final results
// const finalResults2 = await limitedFuture.toPromise();
// console.log(finalResults2); 


// const channel = createChannel<number>();

// // Get the writer and write values
// const writer = channel.getWriter();
// writer.write(42);
// writer.write(47);

// // Close the writer to indicate no more values will be written
// writer.close();

// const future = Future.delay(1000, 50);

// // Use the channel's readable stream and log the values
// using readable = channel.readable;
// for await (const value of readable) {
//   console.log("Channel Value:", value);
// }

// // Now this will be logged after the readable loop is done
// console.log({
//   future: await future,
// });

