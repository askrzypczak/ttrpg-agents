/**
 * Data-file policy: committed data files (JSON, CSV, images, databases, ...)
 * live only under an allowlist of directories.
 */

/** The repo-relative, `/`-separated paths that are data files outside the allowlist and not excepted config files, in input order. */
export function dataFileViolations(paths: readonly string[]): string[] {
  void paths;
  throw new Error("not implemented");
}

/** The failure message for a non-empty list of violations. */
export function dataFileMessage(violations: readonly string[]): string {
  void violations;
  throw new Error("not implemented");
}
