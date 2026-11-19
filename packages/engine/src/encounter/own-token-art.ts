import type { EncounterDirectory } from "./directory.js";
import type { ChangeOrigin } from "./origin.js";
import type { StoredTokenArt, TokenArtRepository } from "./token-art.js";
import type { TokenImageRepository } from "./token-image.js";
import type { FocalPoint, MadeToken, MakeTokenDeps } from "./tokeniser.js";
import type { Monster } from "../monsters/schema.js";
import type { MonsterIndex } from "../monsters/types.js";

export interface SetOwnTokenArtDeps extends MakeTokenDeps {
  monsters: MonsterIndex;
  art: TokenArtRepository;
  images: TokenImageRepository;
  directory: Pick<
    EncounterDirectory,
    "getOpenScene" | "getCurrentEncounter" | "repositoryFor"
  >;
}

export type SetOwnTokenArtResult =
  | {
      outcome: "set";
      monster: Monster;
      /** The token as made: bytes, source size and type, focus, zoom, crop. */
      token: MadeToken;
      /** SHA-256 of the stored token bytes; the type's art is now `{ sha256 }`. */
      sha256: string;
      /** The art it replaced with that art's source, or null when the type had none. */
      replaced: StoredTokenArt | null;
      /** Always false: the art has no url and waits on the GM's re-upload and pick. */
      published: false;
    }
  | {
      outcome: "unchanged";
      monster: Monster;
      token: MadeToken;
      sha256: string;
      /** The stored art, which already has this hash, kept as it is. */
      kept: StoredTokenArt;
      /** True when the kept art has a url. */
      published: boolean;
    };

/**
 * Makes a token from `image` and makes it the monster type's art with source
 * `agent`, replacing any art; notes the command on the current encounter.
 * Throws UnknownMonsterError before loading anything, and makeToken's errors
 * before writing anything.
 */
export async function setOwnTokenArt(
  deps: SetOwnTokenArtDeps,
  monsterKey: string,
  image: string,
  options: { focus?: FocalPoint; zoom?: number },
  origin: ChangeOrigin,
): Promise<SetOwnTokenArtResult> {
  await Promise.resolve();
  void [deps, monsterKey, image, options, origin];
  throw new Error("not implemented");
}
