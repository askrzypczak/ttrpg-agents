import { z } from "zod";
import type { ChangeOrigin } from "./origin.js";

/** Art that names an image Owlbear can draw: a reference, never the bytes. */
export type PublishedTokenArt = {
  url: string;
  mime: string;
  width: number;
  height: number;
  /** SHA-256 of a stored copy of the image, when there is one. */
  sha256?: string;
};

/**
 * The image a monster type's tokens are drawn with: a published reference
 * (`PublishedTokenArt`), or only the hash of stored bytes that were never
 * published, with no url, mime, width or height. The reference is all or
 * nothing: mime, width and height describe the published asset.
 */
export type TokenArt =
  | PublishedTokenArt
  | {
      /** SHA-256 of the stored image, which has no published reference yet. */
      sha256: string;
      url?: undefined;
      mime?: undefined;
      width?: undefined;
      height?: undefined;
    };

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

/** Source of truth for `PublishedTokenArt`; `token-art-set` carries it. */
export const publishedTokenArtSchema = z.object({
  url: z
    .string()
    .max(2048)
    .regex(/^https:\/\/[^\s/]\S*$/, "must be an https url"),
  mime: z
    .string()
    .max(100)
    .regex(/^image\//),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sha256: sha256Schema.optional(),
}) satisfies z.ZodType<PublishedTokenArt>;

/**
 * Source of truth for `TokenArt`; the protocol reuses it as the wire shape.
 * Art with only part of the reference, or neither a url nor a hash, fails.
 */
export const tokenArtSchema = z.union([
  publishedTokenArtSchema,
  z.object({
    sha256: sha256Schema,
    url: z.undefined().optional(),
    mime: z.undefined().optional(),
    width: z.undefined().optional(),
    height: z.undefined().optional(),
  }),
]) satisfies z.ZodType<TokenArt>;

/** Who set a monster type's stored art: a GM pick in Owlbear (`table`), the DM through the agent or the library import (`agent`), or the TooManyTokens default (`default`). */
export type TokenArtSource = "table" | "agent" | "default";

/** A monster type's stored art and its source. */
export interface StoredTokenArt {
  art: TokenArt;
  source: TokenArtSource;
}

/** Monster key -> the art its tokens are created with. */
export interface TokenArtRepository {
  /** All stored art, keyed by monster key. */
  listTokenArt(): Record<string, TokenArt>;
  /** The art of a monster key with its source, or undefined when it has none. */
  getTokenArt(monsterKey: string): StoredTokenArt | undefined;
  /** In one write transaction: stores the art and its source, replacing any, and logs one `art-changed` event with no encounter under `origin`. */
  setTokenArt(
    monsterKey: string,
    art: TokenArt,
    source: TokenArtSource,
    origin: ChangeOrigin,
  ): void;
  /** Runs `fn` in one write transaction; repository calls inside it join it; a throw rolls them back and is rethrown. */
  transaction<T>(fn: () => T): T;
}

export type AssignTokenArtResult =
  | { outcome: "set"; replaced: StoredTokenArt | null }
  | { outcome: "kept"; reason: "has_art" };

/** Assigns art to a monster type by the precedence rule, in one repository transaction. */
export function assignTokenArt(
  repo: TokenArtRepository,
  monsterKey: string,
  art: TokenArt,
  source: TokenArtSource,
  origin: ChangeOrigin,
): AssignTokenArtResult {
  void repo;
  void monsterKey;
  void art;
  void source;
  void origin;
  throw new Error("not implemented");
}
