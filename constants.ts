/**
 * The timeout to use when `generator.return` is called to ensure cleanup logic is executed.
 * The reason for this timeout is to prevent the generator from hanging indefinitely,
 * if the cleanup logic fails to complete or gets stuck.
 */
export const GENERATOR_RETURN_TIMEOUT = 1_000;