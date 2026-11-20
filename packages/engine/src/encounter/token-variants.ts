import type { Monster } from "../monsters/schema.js";
import type { MonsterIndex } from "../monsters/types.js";
import type { DefaultArtDeps } from "./default-art.js";
import type { EncounterDirectory } from "./directory.js";
import type { ImageSource } from "./image-source.js";
import type { ChangeOrigin } from "./origin.js";
import type { StoredTokenArt, TokenArtRepository } from "./token-art.js";
import type { Tokeniser } from "./tokeniser.js";
import type {
  TooManyTokensIndex,
  TooManyTokensVariant,
} from "./too-many-tokens.js";

export interface TooManyTokensSheetDeps {
  monsters: MonsterIndex;
  art: Pick<TokenArtRepository, "getTokenArt">;
  imageSource: ImageSource;
  tokeniser: Pick<Tokeniser, "contactSheet">;
  tooManyTokens: TooManyTokensIndex;
}

export interface TooManyTokensSheet {
  monster: Monster;
  /** The sheet (WebP, CONTACT_SHEET_LAYOUT). */
  bytes: Uint8Array;
  /** Variant numbers (1-based) of the first and last cell. */
  first: number;
  last: number;
  /** How many variants the monster has. */
  total: number;
  /** How many of the page's variants could not be loaded; their cells are blank. */
  failed: number;
  /** The number of the variant whose jsDelivr or raw url is the type's art url, else null. */
  current: number | null;
}

/**
 * One page of a monster's TooManyTokens variants as a contact sheet
 * (CONTACT_SHEET_LAYOUT), with the page's variant numbers, the total, the
 * failed loads and the current art's variant number. Writes nothing.
 */
export function tooManyTokensSheet(
  deps: TooManyTokensSheetDeps,
  monsterKey: string,
  page: number,
): Promise<TooManyTokensSheet> {
  void deps;
  void monsterKey;
  void page;
  return Promise.reject(new Error("not implemented"));
}

export interface SetTooManyTokensVariantDeps extends DefaultArtDeps {
  monsters: MonsterIndex;
  directory: Pick<
    EncounterDirectory,
    "getOpenScene" | "getCurrentEncounter" | "repositoryFor"
  >;
}

export type SetTooManyTokensVariantResult =
  | {
      outcome: "set";
      monster: Monster;
      variant: number;
      image: TooManyTokensVariant;
      sha256: string;
      /** null when the type had none */
      replaced: StoredTokenArt | null;
    }
  | {
      outcome: "unchanged";
      monster: Monster;
      variant: number;
      image: TooManyTokensVariant;
      sha256: string;
      kept: StoredTokenArt;
    };

/**
 * Makes a monster's TooManyTokens variant `variant` (1-based) its type's art
 * with source `agent`, replacing any art, and notes the command on the
 * current encounter; unchanged when the stored art already has its hash.
 */
export function setTooManyTokensVariant(
  deps: SetTooManyTokensVariantDeps,
  monsterKey: string,
  variant: number,
  origin: ChangeOrigin,
): Promise<SetTooManyTokensVariantResult> {
  void deps;
  void monsterKey;
  void variant;
  void origin;
  return Promise.reject(new Error("not implemented"));
}
