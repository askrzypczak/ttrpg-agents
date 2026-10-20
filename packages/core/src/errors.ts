/** An expected, user-facing failure (bad input, unknown target); safe to show as a tool error. */
export class DomainError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}
