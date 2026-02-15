# @okikio/future

> Use Futures like Promises, get superpowers from async generators

**@okikio/future** provides a `Future` class that works as a drop-in Promise replacement, but with powerful capabilities enabled by its async generator foundation: pause/resume execution, cancel operations, yield multiple values, and control flow interactively.

## 📖 Table of Contents

- [Why Future?](#-why-future)
- [Installation](#-installation)
- [Quick Start](#-quick-start)
- [Core Concepts](#-core-concepts)
- [API Reference](#-api-reference)
- [Examples](#-examples)
- [Runtime Support](#-runtime-support)
- [Contributing](#-contributing)
- [License](#-license)

## 🎯 Why Future?

Futures work like Promises - you can `await` them, use `.then()`, and handle errors with `.catch()`. But under the hood, they're built on async generators, giving you capabilities Promises can't provide.

### Use Futures Like Promises

```typescript
// Works exactly like a Promise
const future = Future.from(async function* () {
  const response = await fetch('/api/data');
  return await response.json();
});

const data = await future;  // Just like: await promise
```

### Get Generator Superpowers

The async generator foundation enables features Promises fundamentally cannot support:

| Capability | Promises | Futures | Why Generators Enable This |
|------------|----------|---------|---------------------------|
| **Cancellation** | ❌ No | ✅ Yes | Generator's `return()` method terminates execution |
| **Pause/Resume** | ❌ No | ✅ Yes | Generator execution is inherently pausable |
| **Multiple Values** | ❌ Single value | ✅ Yield many | Generators yield sequences, not single values |
| **Interactive Flow** | ❌ No | ✅ Pull-based | Generator `next(value)` enables two-way communication |
| **Progress Tracking** | ❌ No | ✅ Intermediate yields | Each `yield` provides progress updates |
| **Resource Cleanup** | ❌ Manual | ✅ Automatic | Generator finally blocks + DisposableStack integration |

### How It Works

Futures wrap async generator functions. When you use a Future like a Promise (with `await` or `.toPromise()`), it runs the generator to completion. But you can also iterate through yielded values, pause execution, or interact with the generator directly.

```typescript
// The async generator foundation
const future = Future.from(async function* () {
  yield "loading...";        // Progress update
  const data = await fetch('/api');
  yield "processing...";     // More progress
  return await data.json();  // Final result
});

// Use like Promise - just get final result
const result = await future.toPromise();  // Gets the returned value

// OR iterate through all yields (including progress)
for await (const value of future) {
  console.log(value);  // "loading...", "processing..."
}
```

## 📦 Installation

```bash
# Deno
import * as Future from "jsr:@okikio/future";

# npm/Node.js
npm install @okikio/future

# Bun
bun add @okikio/future

# pnpm
pnpm add @okikio/future
```

## 🚀 Quick Start

### Simple: Use Like a Promise

```typescript
import { Future } from "@okikio/future";

// Works just like Promise.resolve()
const future = Future.from(async function* () {
  return await fetch('/api/data').then(r => r.json());
});

const data = await future;  // That's it!
```

### Advanced: Leverage the Generator

```typescript
// Yield multiple values as work progresses
const future = Future.from(async function* () {
  yield "Starting...";
  const users = await fetch('/api/users').then(r => r.json());
  
  yield "Got users, fetching posts...";
  const posts = await fetch('/api/posts').then(r => r.json());
  
  return { users, posts };  // Final result
});

// Track progress through yields
for await (const status of future) {
  console.log(status);  // "Starting...", "Got users, fetching posts..."
}

// Or just get the final result
const data = await future.toPromise();  // { users, posts }
```

### Control Flow: Pause, Resume, Cancel

```typescript
const future = Future.from(async function* () {
  for (let i = 0; i < 100; i++) {
    yield i;
  }
});

future.pause();                         // Stop execution
setTimeout(() => future.resume(), 1000); // Resume later
setTimeout(() => future.cancel(), 5000); // Or cancel entirely
```

## 🧠 Core Concepts

### Futures = Promises + Generators

A **Future** is built on an async generator function, which gives it superpowers Promises don't have. You can use it like a Promise (just `await` it), or tap into the generator capabilities.

**Promise-style usage:**
```typescript
const future = Future.from(async function* () {
  return 42;
});

const result = await future;  // 42
```

**Generator-style usage:**
```typescript
const future = Future.from(async function* () {
  yield 1;
  yield 2;
  return 3;
});

for await (const value of future) {
  console.log(value);  // 1, 2
}
const final = await future.toPromise();  // 3
```

### The Async Generator Foundation

Futures wrap async generator functions (`async function*`). This foundation enables all the advanced features:

- **Yields** → Multiple values, progress tracking
- **Generator.return()** → Cancellation
- **Pausable execution** → Pause/resume control  
- **Bidirectional communication** → Pull-based workflows
- **Finally blocks** → Resource cleanup

```typescript
// The generator function you provide
Future.from(async function* (abort, disposables) {
  // yield = emit values over time
  yield "step 1";
  yield "step 2";
  
  // abort = cancellation support
  abort.signal.throwIfAborted();
  
  // disposables = automatic cleanup
  disposables.defer(() => cleanup());
  
  // return = final value
  return "done";
});
```

### Push vs Pull Workflows

The generator foundation supports two modes of iteration:

#### Push-Based (Autonomous)

The generator runs independently, pushing values to consumers:

```typescript
const future = Future.from(async function* () {
  yield 1;  // Generator pushes this
  yield 2;  // Generator pushes this
  return 3;
});

// Consumer passively receives pushed values
for await (const value of future) {
  console.log(value);
}
```

#### Pull-Based (Interactive)

The consumer pulls values and can send data back into the generator:

```typescript
const future = Future.from(async function* () {
  let count = 0;
  let input;
  
  while (count < 5) {
    input = yield count;  // Yield AND wait for input
    count = input + 1;    // Use the input consumer sends
  }
  
  return count;
});

const iterator = future[Symbol.asyncIterator]();

// Consumer pulls and sends values back
console.log(await iterator.next());     // { value: 0, done: false }
console.log(await iterator.next(5));    // { value: 6, done: false }  
console.log(await iterator.next(10));   // { value: 11, done: false }
```

This pull-based capability is unique to generators and impossible with Promises.

### Status Lifecycle

Every Future goes through states:

```
   Idle
    ↓
  Running ←→ Paused
    ↓
  Completed
    ↓
  Destroyed
```

Or can be cancelled at any point:

```
  Idle/Running/Paused
         ↓
     Cancelled
         ↓
     Destroyed
```

### Resource Management

Futures use **Explicit Resource Management** (TC39 proposal):

```typescript
// Automatic cleanup with 'using'
{
  await using future = Future.from(async function* (_, stack) {
    const file = await Deno.open("data.txt");
    stack.use(file); // Auto-cleanup
    
    const content = await file.readAll();
    yield content;
  });
  
  await future.toPromise();
} // Automatically disposed and cleaned up here
```

## 📚 API Reference

### Factory Functions

#### `from(operation)`

Converts various types into a Future:

```typescript
// From Promise
Future.from(Promise.resolve(42));

// From async generator
Future.from(async function* () {
  yield 1;
  return 2;
});

// From iterable
Future.from([1, 2, 3]);

// From ReadableStream
Future.from(response.body);
```

#### `of(value)`

Creates a Future from a single value:

```typescript
const future = Future.of(42);
await future.toPromise(); // 42
```

### Concurrency Control

#### `all(futures)`

Run all futures concurrently (like `Promise.all`):

```typescript
const futures = [
  Future.from(fetch('/api/user')),
  Future.from(fetch('/api/posts')),
  Future.from(fetch('/api/comments'))
];

const results = await Future.all(futures).toPromise();
// All results in order
```

#### `allSettled(futures)`

Run all futures, get settled results:

```typescript
const results = await Future.allSettled(futures).toPromise();

results.forEach(result => {
  if (result.status === 'fulfilled') {
    console.log(result.value);
  } else {
    console.error(result.reason);
  }
});
```

#### `race(futures)`

Return first to complete:

```typescript
const fastest = await Future.race([
  Future.from(fetchFromCDN()),
  Future.from(fetchFromBackup())
]).toPromise();
```

#### `some(futures, count)`

Get first N results:

```typescript
const firstThree = await Future.some(futures, 3).toPromise();
```

#### `withConcurrencyLimit(futures, limit)`

Control max concurrent operations:

```typescript
const futures = urls.map(url => Future.from(fetch(url)));

// Only 5 concurrent requests at a time
const results = await Future.withConcurrencyLimit(futures, 5).toPromise();
```

### Sequential Execution

#### `scope(futures)`

Run futures sequentially in order:

```typescript
const results = await Future.scope([
  future1,
  future2,
  future3
]).toPromise();
// Executes one after another
```

### Background Execution

#### `inBackground(future)`

Execute during idle time (uses `requestIdleCallback`):

```typescript
const bgFuture = Future.inBackground(
  Future.from(async function* () {
    // Heavy computation during idle time
    yield processData();
  })
);

const result = await bgFuture.toPromise();
```

### Splitting and Filtering

#### `split(future)`

Split into success and error streams:

```typescript
const [resolved, errors] = Future.split(future);

for await (const value of resolved) {
  console.log('Success:', value);
}

for await (const error of errors) {
  console.error('Error:', error);
}
```

#### `splitBy(future, predicate)`

Split based on a condition:

```typescript
const numbers = Future.from([1, 2, 3, 4, 5, 6]);
const isEven = (n: number) => n % 2 === 0;

const [evens, odds] = Future.splitBy(numbers, isEven);

for await (const n of evens) {
  console.log('Even:', n); // 2, 4, 6
}

for await (const n of odds) {
  console.log('Odd:', n); // 1, 3, 5
}
```

### Manual Control

#### `withResolvers()`

Manually control resolution (like `Promise.withResolvers`):

```typescript
const { future, resolve, reject } = Future.withResolvers<number>();

// Resolve later
setTimeout(() => resolve(42), 1000);

const result = await future.toPromise(); // 42
```

#### `withAbortable(future, abort)`

Link to external abort signal:

```typescript
const controller = new AbortController();

const future = Future.withAbortable(
  Future.from(longRunningTask()),
  controller
);

// Cancel from outside
controller.abort();
```

### Instance Methods

#### `.toPromise()`

Convert to a standard Promise:

```typescript
const result = await future.toPromise();
```

#### `.pause()` / `.resume()`

Control execution flow:

```typescript
future.pause();
// ... later
future.resume();
```

#### `.cancel(reason?)`

Cancel the future:

```typescript
await future.cancel(new Error("User cancelled"));
```

#### `.reset()`

Reset for reuse (after completion):

```typescript
await future.toPromise();
future.reset();
await future.toPromise(); // Run again
```

#### `.clone()`

Create independent copy:

```typescript
const clone = future.clone();
// Execute independently
```

#### `.dispose()`

Manual cleanup:

```typescript
await future.dispose();
```

## 💡 Examples

### Real-World: API Pagination

```typescript
async function* fetchAllPages(url: string, abort: AbortController) {
  let page = 1;
  let hasMore = true;
  
  while (hasMore && !abort.signal.aborted) {
    const response = await fetch(`${url}?page=${page}`, {
      signal: abort.signal
    });
    
    const data = await response.json();
    
    yield data.items;
    
    hasMore = data.hasMore;
    page++;
    
    // Respect rate limits
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

const future = Future.from(fetchAllPages('/api/users'));

// Collect all pages
const allItems = [];
for await (const items of future) {
  allItems.push(...items);
  
  // Can cancel if we have enough
  if (allItems.length >= 100) {
    await future.cancel();
    break;
  }
}
```

### Real-World: Batch Processing

```typescript
async function processBatch<T>(
  items: T[],
  processor: (item: T) => Promise<void>,
  concurrency: number = 3
) {
  const futures = items.map(item =>
    Future.from(async function* () {
      yield `Processing ${item}...`;
      await processor(item);
      return `Completed ${item}`;
    })
  );
  
  return Future.withConcurrencyLimit(futures, concurrency);
}

// Process 1000 items, max 5 at a time
const batchFuture = processBatch(
  Array.from({ length: 1000 }, (_, i) => i),
  async (item) => {
    await fetch(`/api/process/${item}`, { method: 'POST' });
  },
  5
);

// Monitor progress
for await (const status of batchFuture) {
  console.log(status);
}
```

### Real-World: Debounced Search

```typescript
function createDebouncedSearch(delay: number) {
  let currentSearch: Future<any, any> | null = null;
  
  return async function search(query: string) {
    // Cancel previous search
    if (currentSearch) {
      await currentSearch.cancel();
    }
    
    currentSearch = Future.from(async function* () {
      yield `Searching for "${query}"...`;
      
      // Debounce delay
      await new Promise(resolve => setTimeout(resolve, delay));
      
      const results = await fetch(`/api/search?q=${query}`);
      return await results.json();
    });
    
    return currentSearch.toPromise();
  };
}

const search = createDebouncedSearch(300);

// Rapid calls - only last one executes
search('appl');
search('apple');
search('apple watch'); // Only this runs after 300ms
```

### Real-World: Progressive Image Loading

```typescript
async function* loadImageProgressive(url: string, abort: AbortController) {
  // Load thumbnail first
  const thumbUrl = url.replace('.jpg', '-thumb.jpg');
  const thumbResponse = await fetch(thumbUrl, { signal: abort.signal });
  const thumbBlob = await thumbResponse.blob();
  yield URL.createObjectURL(thumbBlob);
  
  // Then load full image
  const fullResponse = await fetch(url, { signal: abort.signal });
  const fullBlob = await fullResponse.blob();
  return URL.createObjectURL(fullBlob);
}

const imageFuture = Future.from(loadImageProgressive('/images/photo.jpg'));

// Show thumbnail immediately
for await (const imageUrl of imageFuture) {
  imageElement.src = imageUrl;
}

// Final result is full image
const finalUrl = await imageFuture.toPromise();
imageElement.src = finalUrl;
```

## 🌐 Runtime Support

**@okikio/future** works across all modern JavaScript runtimes:

| Runtime | Support | Version |
|---------|---------|---------|
| **Deno** | ✅ Full | 2.x+ |
| **Node.js** | ✅ Full | 22.x+ |
| **Bun** | ✅ Full | 1.x+ |
| **Browsers** | ✅ Full | Modern (ES2022+) |
| **Cloudflare Workers** | ✅ Full | - |

### Required Features

- ES2022+ (async generators, for-await-of)
- Explicit Resource Management (TC39 stage 3)
- `Promise.withResolvers` (polyfilled if needed)

## 🏗 Architecture

### Design Principles

1. **Tree-shakeable**: All exports are functions, no classes in public API
2. **Web Standards**: Built on native async iterators and promises
3. **Zero Dependencies**: Only development dependencies
4. **Type-Safe**: Full TypeScript support with strict types
5. **Memory-Safe**: Automatic cleanup via disposal patterns

### Internal Structure

```
Future (class)
  ├── Status management
  ├── Event dispatching
  ├── Generator wrapper
  └── Disposal stack

Factory functions (tree-shakeable)
  ├── from() - Conversion
  ├── all(), race(), etc. - Concurrency
  ├── scope() - Sequential
  ├── split(), splitBy() - Filtering
  └── inBackground() - Scheduling
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md).

### Development Setup

```bash
# Clone the repository
git clone https://github.com/okikio/future.git
cd future

# Install Deno 2.x+
curl -fsSL https://deno.land/install.sh | sh

# Run tests
deno task test

# Run specific tests
deno task dev
```

### Testing

All features must have comprehensive tests:

```bash
# Run all tests
deno test -RW --clean --trace-leaks

# Run with coverage
deno test --coverage=./coverage

# Generate coverage report
deno coverage ./coverage
```

## 📄 License

MIT © [Okiki Ojo](https://github.com/okikio)

---

## 🙏 Acknowledgments

Inspired by:
- [Rust's Future trait](https://doc.rust-lang.org/std/future/trait.Future.html)
- [TC39 Explicit Resource Management](https://github.com/tc39/proposal-explicit-resource-management)
- [Structured Concurrency](https://vorpus.org/blog/notes-on-structured-concurrency-or-go-statement-considered-harmful/)

## 🔗 Related Projects

- [@logtape/logtape](https://github.com/dahlia/logtape) - Logging library
- [@std/async](https://deno.land/std/async) - Deno async utilities

---

<div align="center">

**[Documentation](https://jsr.io/@okikio/future)** • 
**[GitHub](https://github.com/okikio/future)** • 
**[Issues](https://github.com/okikio/future/issues)**

Made with ❤️ by [Okiki Ojo](https://github.com/okikio)

</div>
