export class ImpulseError extends Error {
  constructor(public code: string, message: string, public exitCode = 2, public retryable = false) {
    super(message);
  }
}
export function requireThat(condition: unknown, code: string, message: string, exitCode = 2): asserts condition {
  if (!condition) throw new ImpulseError(code, message, exitCode);
}
export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
