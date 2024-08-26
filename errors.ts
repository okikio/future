export class CancellationError extends Error {
  constructor() {
    super("Future was canceled");
  }
}