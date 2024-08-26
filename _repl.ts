import Future from "./mod.ts";

const future = Future.from<number, string, undefined>(async function* () {
  let count = 0;
  while (true) {
    const timeout: number = 1000;
    await new Promise((resolve) => setTimeout(resolve, timeout));
    (yield count++);
  }

});

// console.log({ value: await future.next() })
// console.log({ value: await future.next(5000) })

try {
  for await (const value of future) {
    console.log({ value });
    if (value === 6) {
      // console.log(await future.complete("done"));
      console.log(future.cancel(new Error("done")));
    }
  }
} catch (e) { }

// console.log({
//   completed: await future.next(4000),
// })

console.log({
  canceled: await future.next(4000),
})
// console.log({ future: await future })

// /**
//  * Creates a readable stream that emits a sequence of data chunks.
//  * In this example, the stream emits the numbers 1 to 5, then closes.
//  *
//  * @returns {ReadableStream<number>} A readable stream that emits numbers.
//  */
// function createReadableStream(): ReadableStream<number> {
//   let count = 1; // Initialize the count

//   return new ReadableStream<number>({
//     start(controller) {
//       // This method is called when the stream is first accessed
//       // We begin pushing data to the stream
//       function push() {
//         if (count <= 5) {
//           // Enqueue the current count as a chunk to the stream
//           controller.enqueue(count);
//           count += 1; // Increment count
//           // Schedule another push in the next iteration of the event loop
//           setTimeout(push, 1000); // Push a new chunk every second
//         } else {
//           // Close the stream once we've sent all data
//           controller.close();
//         }
//       }

//       // Start pushing the first chunk
//       push();
//     },
//     cancel() {
//       // Handle any cancellation logic if the consumer stops reading the stream
//       console.log("Stream was canceled.");
//     }
//   });
// }

// // Example of using the readable stream
// const stream = createReadableStream();

// // Reading the stream with a reader
// const data = await Array.fromAsync(Future.from(stream));

// console.log(data); // [1, 2, 3, 4, 5]
