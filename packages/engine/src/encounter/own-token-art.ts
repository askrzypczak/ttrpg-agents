import {
  noteCommandOnCurrentEncounter,
  type EncounterDirectory,
} from "./directory.js";
import { UnknownMonsterError } from "./errors.js";
import type { ChangeOrigin } from "./origin.js";
import {
  assignTokenArt,
  type StoredTokenArt,
  type TokenArtRepository,
} from "./token-art.js";
import { storeTokenImage, type TokenImageRepository } from "./token-image.js";
import {
  makeToken,
  type FocalPoint,
  type MadeToken,
  type MakeTokenDeps,
} from "./tokeniser.js";
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
  const monster = deps.monsters.get(monsterKey);
  if (monster === undefined)
    throw new UnknownMonsterError(
      `Unknown monster "${monsterKey}". Use search_monsters to find keys.`,
    );
  const token = await makeToken(deps, image, options);
  return deps.art.transaction((): SetOwnTokenArtResult => {
    const stored = storeTokenImage(deps.images, token.bytes);
    if (!stored.ok)
      throw new Error(
        `The token image was refused by the store: ${stored.message}`,
      );
    const { sha256 } = stored;
    const kept = deps.art.getTokenArt(monsterKey);
    if (kept?.art.sha256 === sha256)
      return {
        outcome: "unchanged",
        monster,
        token,
        sha256,
        kept,
        published: kept.art.url !== undefined,
      };
    const assigned = assignTokenArt(
      deps.art,
      monsterKey,
      { sha256 },
      "agent",
      origin,
    );
    if (assigned.outcome === "kept")
      throw new Error(`The art of ${monsterKey} was kept, not set.`);
    noteCommandOnCurrentEncounter(deps.directory, origin);
    return {
      outcome: "set",
      monster,
      token,
      sha256,
      replaced: assigned.replaced,
      published: false,
    };
  });
}
