// Pure helpers for scripts/mutate-changed.ts: picking the changed production
// files to mutate and formatting the PR comment. No I/O, so it is unit-tested
// directly.
import { matchesGlob } from "node:path";

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

/** The slice of Stryker's JSON report (mutation-testing-elements) we read. */
export interface MutationReport {
  files: Record<
    string,
    {
      mutants: {
        mutatorName: string;
        status: string;
        location: { start: { line: number } };
      }[];
    }
  >;
}

/** Most survivor locations listed in the comment; the rest are counted. */
export const MAX_LISTED: number = 30;
const UNCAUGHT = new Set(["Survived", "NoCoverage"]);
const DETECTED = new Set(["Killed", "Timeout"]);

/** Detected / (detected + uncaught), as Stryker scores; "n/a" if none. */
function scoreOf(counts: ReadonlyMap<string, number>): string {
  let detected = 0;
  let valid = 0;
  for (const [status, n] of counts) {
    if (DETECTED.has(status)) detected += n;
    if (DETECTED.has(status) || UNCAUGHT.has(status)) valid += n;
  }
  return valid === 0 ? "n/a" : `${((detected / valid) * 100).toFixed(1)}%`;
}

/**
 * The PR comment body for a Stryker JSON report: score, mutant counts overall
 * and per file, and one line per uncaught location (file:line, the mutators on
 * it). No source code, so the size stays small; the `mutation` artifact
 * (index.html) has the diffs.
 */
export function formatMutationSummary(report: MutationReport): string {
  const totals = new Map<string, number>();
  const rows: string[] = [];
  const locations: { file: string; line: number; text: string }[] = [];
  const files = Object.entries(report.files).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  for (const [file, { mutants }] of files) {
    const counts = new Map<string, number>();
    const byLine = new Map<number, Map<string, number>>();
    for (const m of mutants) {
      counts.set(m.status, (counts.get(m.status) ?? 0) + 1);
      totals.set(m.status, (totals.get(m.status) ?? 0) + 1);
      if (!UNCAUGHT.has(m.status)) continue;
      const line = m.location.start.line;
      const key = `${m.mutatorName} (${m.status})`;
      const here = byLine.get(line) ?? new Map<string, number>();
      here.set(key, (here.get(key) ?? 0) + 1);
      byLine.set(line, here);
    }
    const uncaught =
      (counts.get("Survived") ?? 0) + (counts.get("NoCoverage") ?? 0);
    rows.push(
      `| ${file} | ${mutants.length} | ${uncaught} | ${scoreOf(counts)} |`,
    );
    for (const [line, here] of byLine) {
      const text = [...here]
        .map(([key, n]) => (n > 1 ? `${key} x${n}` : key))
        .join(", ");
      locations.push({ file, line, text });
    }
  }
  const n = (status: string): number => totals.get(status) ?? 0;
  const total = [...totals.values()].reduce((a, b) => a + b, 0);
  const ignored = n("Ignored") > 0 ? `, ${n("Ignored")} ignored` : "";
  let out =
    "## Mutation testing (changed files)\n\n" +
    `**Score ${scoreOf(totals)}** over ${total} mutants: ${n("Killed")} killed, ` +
    `${n("Timeout")} timeout, ${n("Survived")} survived, ${n("NoCoverage")} no coverage${ignored}.\n\n` +
    "| File | Mutants | Survived + no coverage | Score |\n" +
    "| --- | ---: | ---: | ---: |\n" +
    rows.join("\n") +
    "\n";
  if (locations.length > 0) {
    locations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    out += "\n```\n";
    for (const l of locations.slice(0, MAX_LISTED)) {
      out += `${l.file}:${l.line} ${l.text}\n`;
    }
    if (locations.length > MAX_LISTED) {
      out += `... and ${locations.length - MAX_LISTED} more locations\n`;
    }
    out += "```\n";
  }
  return out + "\nDiffs: see the `mutation` artifact (index.html).\n";
}
