import type { DatabaseSync } from "node:sqlite";

export type TokenArtImportSummary = {
  stored: { file: string; monsterKey: string }[];
  skipped: { file: string; monsterKey: string; reason: string }[];
  rejected: { file: string; reason: string }[];
};

/** Imports each `<key>.<png|jpg|jpeg|webp>` file at the top of `dir` through `importTokenArt`; files in name order. */
export function importTokenArtLibrary(
  db: DatabaseSync,
  dir: string,
  options: { replace: boolean },
): TokenArtImportSummary {
  void db;
  void dir;
  void options;
  throw new Error("not implemented");
}

/** One line per file under its outcome, then the counts. */
export function formatTokenArtImportSummary(
  summary: TokenArtImportSummary,
): string {
  void summary;
  throw new Error("not implemented");
}
