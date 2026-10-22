/**
 * Validates a new display name for an instance and returns it trimmed.
 * Throws InvalidNameError if it is empty or whitespace-only, or if the trimmed
 * name exactly equals one of `otherNames` (the other instances' names; the
 * instance's own current name is allowed).
 */
export function validateInstanceName(
  name: string,
  otherNames: readonly string[],
): string {
  void name;
  void otherNames;
  throw new Error("not implemented");
}
