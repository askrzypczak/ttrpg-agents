// Pure helpers for scripts/mutate-changed.ts: picking the changed production
// files to mutate and formatting the PR comment. No I/O, so it is unit-tested
// directly.

/** GitHub's comment body limit is 65,536 characters; keep some headroom. */
export const COMMENT_LIMIT: number = 60_000;

/**
 * The files from raw `git diff --name-status` output that Stryker should
 * mutate. `patterns` are the stryker.config.json `mutate` globs; a leading `!`
 * marks an exclusion. Deleted files are dropped, renamed/copied files map to
 * their new path; input order is kept, without duplicates.
 */
export function selectMutateFiles(
  nameStatus: string,
  patterns: readonly string[],
): string[] {
  void nameStatus;
  void patterns;
  throw new Error("not implemented");
}

/**
 * The PR comment body for Stryker's clear-text report: ANSI colours stripped,
 * fenced under a short heading, truncated (with a notice pointing at the HTML
 * artifact) so the whole body stays within COMMENT_LIMIT.
 */
export function formatMutationComment(clearText: string): string {
  void clearText;
  throw new Error("not implemented");
}
