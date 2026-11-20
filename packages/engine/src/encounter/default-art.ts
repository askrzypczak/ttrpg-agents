import type { MonsterIndex } from "../monsters/types.js";
import type { ImageSource } from "./image-source.js";
import type { ChangeOrigin } from "./origin.js";
import type { TokenArtRepository } from "./token-art.js";
import type { TokenImageRepository } from "./token-image.js";
import type { TooManyTokensIndex } from "./too-many-tokens.js";

/** What the TooManyTokens default needs besides the monster index. */
export interface DefaultArtDeps {
  art: TokenArtRepository;
  images: TokenImageRepository;
  imageSource: ImageSource;
  tooManyTokens: TooManyTokensIndex;
}

/** What happened to one monster type's default art; `name` is the monster's name. */
export type DefaultArtOutcome =
  | { outcome: "set"; monsterKey: string; name: string }
  | { outcome: "has-art"; monsterKey: string; name: string }
  | { outcome: "not-covered"; monsterKey: string; name: string }
  | { outcome: "failed"; monsterKey: string; name: string; reason: string };

/** One key after loading: its outcome when there is nothing to store, or the image to store and the url that answered. */
export type LoadedDefaultArt =
  | Exclude<DefaultArtOutcome, { outcome: "set" }>
  | {
      outcome: "loaded";
      monsterKey: string;
      name: string;
      url: string;
      bytes: Uint8Array;
    };

/**
 * For each distinct key of a known monster, in order: has-art when its type has stored
 * art, not-covered when it has no default variant, else its default variant loaded from
 * the jsDelivr url, or the raw url when that load fails or its bytes fail
 * validateTokenImage; failed with each try's reason when both do. Writes nothing; an
 * ImageUnavailableError never rejects it, any other rejection does. Unknown keys get no entry.
 */
export async function loadDefaultArt(
  deps: DefaultArtDeps & { monsters: MonsterIndex },
  monsterKeys: readonly string[],
): Promise<LoadedDefaultArt[]> {
  void deps;
  void monsterKeys;
  await Promise.resolve();
  throw new Error("not implemented");
}

/**
 * In one TokenArtRepository transaction: for each loaded type still without art, stores
 * the bytes (storeTokenImage) and assigns { url, mime, width, height, sha256 } with source
 * `default` (assignTokenArt); then runs `write`. Every art-changed event precedes write's
 * events; a throw from `write` rolls the art back and is rethrown. Outcomes in entry order.
 */
export function storeDefaultArt<T>(
  deps: Pick<DefaultArtDeps, "art" | "images">,
  loaded: readonly LoadedDefaultArt[],
  origin: ChangeOrigin,
  write: () => T,
): { result: T; art: DefaultArtOutcome[] } {
  void deps;
  void loaded;
  void origin;
  void write;
  throw new Error("not implemented");
}
