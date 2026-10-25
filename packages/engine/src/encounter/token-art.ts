import { z } from "zod";

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
 * The image a monster type's tokens are drawn with.
 *
 * Not implemented yet: still only the published shape; the hash-only member
 * (`{ sha256 }` with no url, mime, width or height) is still to come.
 */
export type TokenArt = PublishedTokenArt;

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
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
}) satisfies z.ZodType<PublishedTokenArt>;

/** Source of truth for `TokenArt`; the protocol reuses it as the wire shape. */
// Not implemented yet: accepts only the published shape.
export const tokenArtSchema =
  publishedTokenArtSchema satisfies z.ZodType<TokenArt>;

/** Monster key -> the art its tokens are created with. */
export interface TokenArtRepository {
  /** All stored art, keyed by monster key. */
  listTokenArt(): Record<string, TokenArt>;
  /** Stores the art of a monster key, replacing any it had. */
  setTokenArt(monsterKey: string, art: TokenArt): void;
}
