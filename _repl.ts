import { enhanceReadableStream, timeout } from "./disposal.ts";
import { streamTee } from "./_stream.ts";

import * as Future from "./mod.ts";
import { delay } from "./deadline.ts";

async function* gen(_: unknown, stack: AsyncDisposableStack) {
  // throw new Error("Random message");
  // yield new Error("Random message");

  yield 154;
  // yield 200;

  // // Simulate a long-running task
  // await stack.use(Future.delay(1000, 50));

  // yield 42;
  // yield 54;
  // yield 65;

  return 42;
}


// const iterator = Future.from(gen);
// // Future.inBackground();

// for await (const value of iterator) {
//   console.log("inBackground - Value:", value);
// }

// console.log("result", await iterator);
// iterator[Symbol.dispose]();




const transformStream = new TransformStream();
const writableStream = transformStream.writable;
const readableStream = transformStream.readable;

const enhancedReadableStream = enhanceReadableStream(readableStream);
let currentReadableStream = enhancedReadableStream;

const writer = writableStream.getWriter();
writer.write(1);
writer.write(2);
writer.write(3);

const [branch1, branch2] = streamTee(currentReadableStream);

const wrappedBranch1 = enhanceReadableStream(branch1);
const wrappedBranch2 = enhanceReadableStream(branch2);
currentReadableStream = wrappedBranch1;

// (async () => {
//   await Promise.all([
//     Promise.all([
//       (async () => {
//         for await (const value of wrappedBranch1) {
//           console.log("Branch 1 - Value:", value);
//         }
//       })(),

//       (async () => {
//         for await (const value of wrappedBranch2) {
//           console.log("Branch 2 - Value:", value);
//         }
//       })(),
//     ]),

//     // timeout(1000).then(() => writer.close()),
//   ]);
// })();


(async () => {
  await timeout(1000, { reject: false });

  console.log({ view: "2nd effect" })
  
  const [branch3, branch4] = streamTee(currentReadableStream);

  const wrappedBranch3 = enhanceReadableStream(branch3);
  const wrappedBranch4 = enhanceReadableStream(branch4);

  writer.write(4);
  writer.write(5);
  writer.write(6);

  Promise.all([
    Promise.all([
      (async () => {
        for await (const value of wrappedBranch3) {
          console.log("Branch 3 - Value:", value);
        }
      })(),

      (async () => {
        for await (const value of wrappedBranch4) {
          console.log("Branch 4 - Value:", value);
        }
      })(),
    ]),

    timeout(2_000, { reject: false }).finally(() => writer.close()),
  ]);
})();