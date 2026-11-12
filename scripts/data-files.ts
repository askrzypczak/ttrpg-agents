/**
 * Data-file policy: committed data files (JSON, CSV, images, databases, ...)
 * live only under an allowlist of directories.
 */

/** Extensions, lower case without the dot, that mark a file as data. */
const DATA_EXTENSIONS = new Set([
  "json",
  "jsonl",
  "csv",
  "tsv",
  "txt",
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "svg",
  "db",
  "sqlite",
]);

/** Database files, refused in every directory. */
const DATABASE_EXTENSIONS = new Set(["db", "sqlite"]);

/** Directory prefixes, each ending in a slash, where data files may be committed. */
const ALLOWED_DATA_DIRS = [
  "packages/srd/data/",
  "packages/srd/src/fixtures/",
  "packages/owlbear/public/",
  "fixtures/test-book/",
];

/** Config files that carry a data extension but are not data. */
const EXCEPTED_PATHS = new Set([
  "package-lock.json",
  ".prettierrc.json",
  ".mcp.json",
  ".claude/settings.json",
]);

function extensionOf(path: string): string | undefined {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot === -1 ? undefined : name.slice(dot + 1).toLowerCase();
}

/** package.json and tsconfig files at the root, or directly in a package folder. */
function isPackageConfig(path: string): boolean {
  const parts = path.split("/");
  const name = parts[parts.length - 1] ?? "";
  const isConfigName =
    name === "package.json" ||
    (name.startsWith("tsconfig") && name.endsWith(".json"));
  if (!isConfigName) return false;
  return parts.length === 1 || (parts.length === 3 && parts[0] === "packages");
}

function isExcepted(path: string): boolean {
  return EXCEPTED_PATHS.has(path) || isPackageConfig(path);
}

function isViolation(path: string): boolean {
  const extension = extensionOf(path);
  if (extension === undefined || !DATA_EXTENSIONS.has(extension)) return false;
  if (DATABASE_EXTENSIONS.has(extension)) return true;
  if (isExcepted(path)) return false;
  return !ALLOWED_DATA_DIRS.some((dir) => path.startsWith(dir));
}

/** The repo-relative, slash-separated paths that are data files outside the allowlist and not excepted config files, in input order. */
export function dataFileViolations(paths: readonly string[]): string[] {
  return paths.filter((path) => isViolation(path));
}

/** The failure message for a non-empty list of violations. */
export function dataFileMessage(violations: readonly string[]): string {
  return (
    "Data files outside the allowed directories: " +
    violations.join(", ") +
    ". Data files live only under " +
    ALLOWED_DATA_DIRS.join(", ") +
    ". Move the file there, or add its directory to ALLOWED_DATA_DIRS in scripts/data-files.ts; adding a directory needs an explicit line in the approved plan (CLAUDE.md, Conventions)."
  );
}
