import { z } from "zod";

/** The image a monster type's tokens are drawn with: a reference, never the bytes. */
export type TokenArt = {
  image: { url: string; mime: string; width: number; height: number };
  grid: { dpi: number; offset: { x: number; y: number } };
};

/** Source of truth for `TokenArt`; the protocol reuses it as the wire shape. */
export const tokenArtSchema = z.object({
  image: z.object({
    url: z
      .string()
      .max(2048)
      .regex(/^https:\/\/[^\s/]+\S*$/, "must be an https url"),
    mime: z
      .string()
      .max(100)
      .regex(/^image\//),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  grid: z.object({
    dpi: z.number().positive(),
    offset: z.object({ x: z.number(), y: z.number() }),
  }),
}) satisfies z.ZodType<TokenArt>;

/** Monster key -> the art its tokens are created with. */
export interface TokenArtRepository {
  /** All stored art, keyed by monster key. */
  listTokenArt(): Record<string, TokenArt>;
  /** Stores the art of a monster key, replacing any it had. */
  setTokenArt(monsterKey: string, art: TokenArt): void;
}
