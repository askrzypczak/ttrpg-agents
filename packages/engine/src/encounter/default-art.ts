import type { MonsterIndex } from "../monsters/types.js";
import { ImageUnavailableError } from "./errors.js";
import type { ImageSource } from "./image-source.js";
import type { ChangeOrigin } from "./origin.js";
import { assignTokenArt, type TokenArtRepository } from "./token-art.js";
import {
  storeTokenImage,
  validateTokenImage,
  type TokenImageRepository,
} from "./token-image.js";
import {
  defaultVariant,
  tooManyTokensUrls,
  type TooManyTokensIndex,
  type TooManyTokensVariant,
} from "./too-many-tokens.js";

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
  const pending: Promise<LoadedDefaultArt>[] = [];
  for (const monsterKey of new Set(monsterKeys)) {
    const monster = deps.monsters.get(monsterKey);
    if (monster === undefined) continue;
    const { name } = monster;
    if (deps.art.getTokenArt(monsterKey) !== undefined) {
      pending.push(Promise.resolve({ outcome: "has-art", monsterKey, name }));
      continue;
    }
    const variant = defaultVariant(deps.tooManyTokens, monster);
    if (variant === undefined) {
      pending.push(
        Promise.resolve({ outcome: "not-covered", monsterKey, name }),
      );
      continue;
    }
    const urls = tooManyTokensUrls(deps.tooManyTokens, variant);
    pending.push(
      loadFirst(deps.imageSource, [urls.jsdelivr, urls.raw]).then(
        (answer): LoadedDefaultArt =>
          "bytes" in answer
            ? { outcome: "loaded", monsterKey, name, ...answer }
            : { outcome: "failed", monsterKey, name, reason: answer.reason },
      ),
    );
  }
  return Promise.all(pending);
}

/** The variant's bytes from its jsDelivr url, else its raw url: the first whose bytes pass validateTokenImage, or every try's reason. Rethrows any rejection other than ImageUnavailableError. */
export function loadTooManyTokensImage(
  source: ImageSource,
  index: TooManyTokensIndex,
  variant: TooManyTokensVariant,
): Promise<{ url: string; bytes: Uint8Array } | { reason: string }> {
  void source;
  void index;
  void variant;
  return Promise.reject(new Error("not implemented"));
}

/** Tries each url in turn: the first whose bytes pass validateTokenImage, or every try's reason. */
async function loadFirst(
  source: ImageSource,
  urls: readonly string[],
): Promise<{ url: string; bytes: Uint8Array } | { reason: string }> {
  const reasons: string[] = [];
  for (const url of urls) {
    let bytes: Uint8Array;
    try {
      bytes = await source.load({ url });
    } catch (error) {
      if (!(error instanceof ImageUnavailableError)) throw error;
      reasons.push(error.message);
      continue;
    }
    const validation = validateTokenImage(bytes);
    if (validation.ok) return { url, bytes };
    reasons.push(`The image at ${url} was refused: ${validation.message}`);
  }
  return { reason: reasons.join(" ") };
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
  return deps.art.transaction(() => {
    const art = loaded.map((entry) => storeOne(deps, entry, origin));
    return { result: write(), art };
  });
}

/** One entry's outcome: a loaded type still without art gets its bytes stored, then the art assigned. */
function storeOne(
  deps: Pick<DefaultArtDeps, "art" | "images">,
  entry: LoadedDefaultArt,
  origin: ChangeOrigin,
): DefaultArtOutcome {
  if (entry.outcome !== "loaded") return entry;
  const { monsterKey, name } = entry;
  if (deps.art.getTokenArt(monsterKey) !== undefined)
    return { outcome: "has-art", monsterKey, name };
  const stored = storeTokenImage(deps.images, entry.bytes);
  if (!stored.ok)
    throw new Error(
      `The default art of ${monsterKey} was refused by the store: ${stored.message}`,
    );
  const assigned = assignTokenArt(
    deps.art,
    monsterKey,
    { url: entry.url, ...stored.image, sha256: stored.sha256 },
    "default",
    origin,
  );
  return assigned.outcome === "set"
    ? { outcome: "set", monsterKey, name }
    : { outcome: "has-art", monsterKey, name };
}
