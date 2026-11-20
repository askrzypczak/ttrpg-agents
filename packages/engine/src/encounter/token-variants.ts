import type { Monster } from "../monsters/schema.js";
import type { MonsterIndex } from "../monsters/types.js";
import { loadTooManyTokensImage, type DefaultArtDeps } from "./default-art.js";
import {
  noteCommandOnCurrentEncounter,
  type EncounterDirectory,
} from "./directory.js";
import {
  ImageUnavailableError,
  InvalidTokenRequestError,
  UnknownMonsterError,
} from "./errors.js";
import type { ImageSource } from "./image-source.js";
import type { ChangeOrigin } from "./origin.js";
import {
  assignTokenArt,
  type StoredTokenArt,
  type TokenArtRepository,
} from "./token-art.js";
import { storeTokenImage } from "./token-image.js";
import { CONTACT_SHEET_LAYOUT, type Tokeniser } from "./tokeniser.js";
import {
  tooManyTokensUrls,
  tooManyTokensVariants,
  type TooManyTokensIndex,
  type TooManyTokensVariant,
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

/** Variants a page of the contact sheet holds: one per cell. */
const PAGE_SIZE = CONTACT_SHEET_LAYOUT.columns * CONTACT_SHEET_LAYOUT.rows;

/**
 * One page of a monster's TooManyTokens variants as a contact sheet
 * (CONTACT_SHEET_LAYOUT), with the page's variant numbers, the total, the
 * failed loads and the current art's variant number. Writes nothing.
 */
export async function tooManyTokensSheet(
  deps: TooManyTokensSheetDeps,
  monsterKey: string,
  page: number,
): Promise<TooManyTokensSheet> {
  const { monster, variants } = monsterVariants(
    deps.monsters,
    deps.tooManyTokens,
    monsterKey,
  );
  const total = variants.length;
  const pages = Math.ceil(total / PAGE_SIZE);
  if (!Number.isInteger(page) || page < 1 || page > pages)
    throw new InvalidTokenRequestError(
      `Page ${String(page)} is out of range: ${monster.name} has ${String(total)} variants, on pages 1 to ${String(pages)}.`,
    );
  const first = (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);
  const loads = await Promise.all(
    variants
      .slice(first - 1, last)
      .map((variant) =>
        loadTooManyTokensImage(deps.imageSource, deps.tooManyTokens, variant),
      ),
  );
  const failures = loads.filter(
    (load): load is { reason: string } => "reason" in load,
  );
  const [cause] = failures;
  if (cause !== undefined && failures.length === loads.length)
    throw new ImageUnavailableError(
      `No image of ${monster.name}'s variants ${String(first)}-${String(last)} could be loaded: ${cause.reason}`,
    );
  const cells = loads.map((load) => ("bytes" in load ? load.bytes : null));
  const bytes = await deps.tokeniser.contactSheet(cells, CONTACT_SHEET_LAYOUT);
  const artUrl = deps.art.getTokenArt(monsterKey)?.art.url;
  return {
    monster,
    bytes,
    first,
    last,
    total,
    failed: failures.length,
    current:
      artUrl === undefined
        ? null
        : numberOfUrl(deps.tooManyTokens, variants, artUrl),
  };
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
export async function setTooManyTokensVariant(
  deps: SetTooManyTokensVariantDeps,
  monsterKey: string,
  variant: number,
  origin: ChangeOrigin,
): Promise<SetTooManyTokensVariantResult> {
  const { monster, variants } = monsterVariants(
    deps.monsters,
    deps.tooManyTokens,
    monsterKey,
  );
  const image = Number.isInteger(variant) ? variants[variant - 1] : undefined;
  if (image === undefined)
    throw new InvalidTokenRequestError(
      `Variant ${String(variant)} is out of range: ${monster.name} has variants 1 to ${String(variants.length)}.`,
    );
  const loaded = await loadTooManyTokensImage(
    deps.imageSource,
    deps.tooManyTokens,
    image,
  );
  if ("reason" in loaded)
    throw new ImageUnavailableError(
      `${monster.name}'s variant ${String(variant)} could not be loaded: ${loaded.reason}`,
    );
  const { url, bytes } = loaded;
  return deps.art.transaction((): SetTooManyTokensVariantResult => {
    const stored = storeTokenImage(deps.images, bytes);
    if (!stored.ok)
      throw new Error(
        `The variant's image was refused by the store: ${stored.message}`,
      );
    const { sha256 } = stored;
    const kept = deps.art.getTokenArt(monsterKey);
    if (kept?.art.sha256 === sha256)
      return { outcome: "unchanged", monster, variant, image, sha256, kept };
    const assigned = assignTokenArt(
      deps.art,
      monsterKey,
      { url, ...stored.image, sha256 },
      "agent",
      origin,
    );
    if (assigned.outcome === "kept")
      throw new Error(`The art of ${monsterKey} was kept, not set.`);
    noteCommandOnCurrentEncounter(deps.directory, origin);
    return {
      outcome: "set",
      monster,
      variant,
      image,
      sha256,
      replaced: assigned.replaced,
    };
  });
}

/** The monster of `monsterKey` and its TooManyTokens variants in order; an unknown key and a monster with none are refused. */
function monsterVariants(
  monsters: MonsterIndex,
  index: TooManyTokensIndex,
  monsterKey: string,
): { monster: Monster; variants: TooManyTokensVariant[] } {
  const monster = monsters.get(monsterKey);
  if (monster === undefined)
    throw new UnknownMonsterError(
      `Unknown monster "${monsterKey}". Use search_monsters to find keys.`,
    );
  const variants = tooManyTokensVariants(index, monster);
  if (variants.length === 0)
    throw new InvalidTokenRequestError(
      `${monster.name} (${monster.key}) has no TooManyTokens variants.`,
    );
  return { monster, variants };
}

/** The 1-based number of the variant whose jsDelivr or raw url is `url`, or null when none is. */
function numberOfUrl(
  index: TooManyTokensIndex,
  variants: readonly TooManyTokensVariant[],
  url: string,
): number | null {
  const at = variants.findIndex((variant) => {
    const urls = tooManyTokensUrls(index, variant);
    return url === urls.jsdelivr || url === urls.raw;
  });
  return at === -1 ? null : at + 1;
}
