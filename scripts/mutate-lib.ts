// Pure helpers for scripts/mutate-changed.ts: picking the changed production
// files to mutate and formatting the PR comment. No I/O, so it is unit-tested
// directly.
import { matchesGlob } from "node:path";

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
  const positive = patterns.filter((p) => !p.startsWith("!"));
  const negative = patterns
    .filter((p) => p.startsWith("!"))
    .map((p) => p.slice(1));
  const seen = new Set<string>();
  for (const line of nameStatus.split("\n")) {
    if (line.trim() === "") continue;
    const [status, ...paths] = line.split("\t");
    if (status === undefined || status.startsWith("D")) continue;
    const file = paths[paths.length - 1];
    if (file === undefined || file === "") continue;
    if (
      positive.some((p) => matchesGlob(file, p)) &&
      !negative.some((p) => matchesGlob(file, p))
    ) {
      seen.add(file);
    }
  }
  return [...seen];
}

/**
 * The PR comment body for Stryker's clear-text report: ANSI colours stripped,
 * fenced under a short heading, truncated (with a notice pointing at the HTML
 * artifact) so the whole body stays within COMMENT_LIMIT.
 */
export function formatMutationComment(clearText: string): string {
  const heading = "## Mutation testing (changed files)\n\n";
  const open = "```\n";
  const close = "\n```\n";
  const notice =
    "\n... truncated; see the `mutation` artifact (index.html) for the full report.";
  // eslint-disable-next-line no-control-regex
  const text = clearText.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").trimEnd();
  const overhead = heading.length + open.length + close.length;
  if (overhead + text.length <= COMMENT_LIMIT) {
    return heading + open + text + close;
  }
  const keep = COMMENT_LIMIT - overhead - notice.length;
  return heading + open + text.slice(0, keep) + notice + close;
}
