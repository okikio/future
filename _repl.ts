import * as Future from "./mod.ts";

// async function* wrapper<T, TReturn, TNext>(generator: AsyncGenerator<T, TReturn, TNext>): AsyncGenerator<T, T | TReturn, TNext> | undefined {
//   let err: unknown;
//   let result: IteratorResult<T, T | TReturn> | undefined;
//   try {
//     if (!generator || typeof generator?.next !== "function") {
//       throw new Error("generator not defined");
//     }

//     // Continue yielding values until the generator completes
//     do {
//       const iteratorResult = result ?
//         // Yield the value to the consumer and wait for the next input
//         generator?.next?.(yield result?.value! as T) :
//         // Prime the generator by starting the iteration process
//         generator?.next?.();

//       await Promise.race([iteratorResult]);
//       result = await iteratorResult;
//     } while (!result?.done);

//     // Return the final value once iteration completes
//     return result?.value as TReturn;
//   } catch (error) {
//     // If an error occurs, propagate it to the generator
//     if (generator?.throw) {
//       try {
//         result = await generator.throw(error);
//       } catch (genError) {
//         err = genError;
//       }
//     } else {
//       err = error;
//     }

//     // Rethrow the error if it wasn't caught by the generator
//     if (err) throw err;
//   }
// }

// async function* gen() {
//   throw new Error("Random message");
//   yield new Promise((resolve) => setTimeout(resolve, 2000)); // Simulate a long-running task
//   return 42;
// }

// try {
//   const iterator = wrapper(gen());
//   await iterator?.next();
//   throw new Error("Expected the Future to be canceled due to deadline");
// } catch (error) {
//   console.log("Wrapper");
// }

// try {
//   const iterator = Future.from(gen);
//   await iterator?.next();
// } catch (e) {
//   console.log("Future");
// }

const transformStream = new TransformStream();
const sharedWriter = transformStream.writable.getWriter();
let readableStream = transformStream.readable;

const anotherWriter = transformStream.writable.getWriter();

sharedWriter.write("Hello");

(async () => {
  for await (const chunk of readableStream) {
    console.log(chunk);
  }
})();

anotherWriter.write("World");
