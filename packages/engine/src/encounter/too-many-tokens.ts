import { z } from "zod";

/** The committed list of TooManyTokens folders and their WebP files at one commit. */
export type TooManyTokensIndex = {
  /** GitHub `<owner>/<name>` of the pack. */
  repo: string;
  /** The commit every URL is pinned to: 40 lower-case hex digits. */
  commit: string;
  /** Each monster folder: its name, its monster key (null when none is mapped) and its WebP file names. */
  folders: { name: string; key: string | null; files: string[] }[];
};

/** Source of truth for `TooManyTokensIndex` (the committed `index.json`). */
export const tooManyTokensIndexSchema = z.object({
  repo: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  folders: z.array(
    z.object({
      name: z.string().min(1),
      key: z.string().min(1).nullable(),
      files: z.array(z.string().min(1)).min(1),
    }),
  ),
}) satisfies z.ZodType<TooManyTokensIndex>;

/** One image of the pack: a file in a folder. */
export type TooManyTokensVariant = { folder: string; file: string };

/**
 * The images of a monster: the files of every folder whose key is the
 * monster's key, or, when there is none, of the folders named like the
 * monster (case-insensitively). The folders named like the monster come
 * first, then the others; folders and files in code-unit order.
 */
export function tooManyTokensVariants(
  index: TooManyTokensIndex,
  monster: { key: string; name: string },
): TooManyTokensVariant[] {
  void index;
  void monster;
  throw new Error("not implemented");
}

/** The monster's default image: its first variant, or undefined when it has none. */
export function defaultVariant(
  index: TooManyTokensIndex,
  monster: { key: string; name: string },
): TooManyTokensVariant | undefined {
  void index;
  void monster;
  throw new Error("not implemented");
}

/**
 * The jsDelivr and raw.githubusercontent.com URLs of a variant, pinned to the
 * index's commit, each path segment percent-encoded (strict RFC 3986).
 */
export function tooManyTokensUrls(
  index: TooManyTokensIndex,
  variant: TooManyTokensVariant,
): { jsdelivr: string; raw: string } {
  void index;
  void variant;
  throw new Error("not implemented");
}
