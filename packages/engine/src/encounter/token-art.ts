import { z } from "zod";

/** The image a monster type's tokens are drawn with: a reference, never the bytes. */
export type TokenArt = {
  image: { url: string; mime: string; width: number; height: number };
  grid: { dpi: number; offset: { x: number; y: number } };
};

/** Source of truth for `TokenArt`; the protocol reuses it as the wire shape. */
// Not implemented: accepts anything and yields nothing usable.
export const tokenArtSchema = z
  .unknown()
  .transform(() => undefined as unknown as TokenArt);

/** Monster key -> the art its tokens are created with. */
export interface TokenArtRepository {
  /** All stored art, keyed by monster key. */
  listTokenArt(): Record<string, TokenArt>;
  /** Stores the art of a monster key, replacing any it had. */
  setTokenArt(monsterKey: string, art: TokenArt): void;
}
