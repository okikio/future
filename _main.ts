import { Worker } from "node:worker_threads";

const worker = new Worker(new URL("./_worker.mjs", import.meta.url), { type: "module" });

const transform = new TransformStream();
const readable = new ReadableStream();
// worker.postMessage({ readable: transform.readable }, [transform.readable])

const obj = structuredClone({ readable, transform }, {
  transfer: [readable, transform]
})

console.log({ main: transform, obj })

// worker.onmessage = (evt) => {
//   console.log({ main: evt, transform })
// }