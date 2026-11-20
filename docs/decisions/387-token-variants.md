# feature: show TooManyTokens variants as a contact sheet and choose one

Issue: [#387](https://github.com/askrzypczak/ttrpg-agents/issues/387).

## 387.1 Variants are numbered from 1 in the index's variant order, so variant 1 is the default; a page holds 20

- Decided by: epic #375 orchestrator, 2026-11-20, plan gate, not human-approved.
- Context: Per 379.3 (the default is the first file, in code-unit order, of the first folder) and the epic's D7 Q1 default (variant 1 on the sheet is the default), which the maintainer was asked to confirm. The agent picks a variant by the number it sees on the sheet, and the sheet draws no numbers.
- Options:
  - Chosen: number the variants 1-based in `tooManyTokensVariants` order; page p shows variants `(p-1)*20+1` to `min(p*20, total)`, numbered left to right, top to bottom. A page that is not an integer, below 1 or past the last is refused with `InvalidTokenRequestError` before anything loads.
  - Number by folder and file name: the agent would have to pass two strings, and the reply would have to list them.
  - Draw numbers on the sheet: needs text rendering in `imaging` (fonts) for a fact the reply line already states.
- Where: `tooManyTokensSheet`, `setTooManyTokensVariant` (`packages/engine/src/encounter/token-variants.ts`); `CONTACT_SHEET_LAYOUT` (`packages/engine/src/encounter/tokeniser.ts`).
- Revisit if: the maintainer vetoes the D7 Q1 default, or a monster's variants change order when the index is rebuilt.
- Status: active

## 387.2 Sheet images load as the default does; a failed image is a blank, counted cell; a page with no image loaded is an error

- Decided by: epic #375 orchestrator, 2026-11-20, plan gate (Q6), not human-approved.
- Context: Per 383.1 (jsDelivr, else raw.githubusercontent.com, each through `ImageSource.load` and `validateTokenImage`) and the maintainer's D3 (always online; a failed fetch is an error case). R8 keeps `NodeImageSource` as is (https only, 20 MiB, 5 s per load).
- Options:
  - Chosen: the page's variants load concurrently through the shared `loadTooManyTokensImage`; a variant whose two tries fail or are refused is a null cell, drawn blank and counted in `failed`, which the reply line reports. When no image of the page loads, `tooManyTokensSheet` rejects with `ImageUnavailableError` naming the first variant's reason and calls no tokeniser.
  - Fail the whole sheet on the first failed image: one dead file would hide the other 19 variants.
  - Return an all-blank sheet when nothing loads: the agent would show the DM an empty grid instead of the cause.
- Where: `loadTooManyTokensImage` (`packages/engine/src/encounter/default-art.ts`); `tooManyTokensSheet` (`token-variants.ts`); `tokenVariantsText` (`packages/mcp/src/tools.ts`).
- Status: active

## 387.3 The current art's variant is found by url over all variants

- Decided by: epic #375 orchestrator, 2026-11-20, plan gate, not human-approved.
- Context: Per 383.1 and 387.4, default and chosen variant art is stored with the jsDelivr or raw url that answered. Table and own-image art has another url or none.
- Options:
  - Chosen: `current` is the number of the variant whose jsDelivr or raw url equals the stored art's url, searched over all of the monster's variants (not just the page), else null.
  - Match by hash: needs every variant's bytes, which a sheet of one page does not load.
- Where: `tooManyTokensSheet` (`token-variants.ts`).
- Revisit if: the index's commit changes, so stored urls no longer match the index's urls.
- Status: active

## 387.4 `set_token_art` takes `variant` or `image`, never both; a variant is stored with its bytes and url as source `agent`, and the same hash changes nothing

- Decided by: epic #375 orchestrator, 2026-11-20, plan gate (Q3, Q5), not human-approved.
- Context: Per the maintainer's D2 (the DM's latest explicit choice replaces any art with no confirmation; the reply names what it replaced), 382.2 (a hash the type already stores is a no-op) and R14 (art with a url is stored with its bytes and hash).
- Options:
  - Chosen: exactly one of `image` and `variant`; `focus` or `zoom` with `variant` is refused with a one-line reason, writing nothing. The variant is loaded as the default is, stored as fetched (no tokenising), and assigned with source `agent` and the url that answered, in one art transaction that also notes the command; when the type's stored art has the same hash, the stored art and its url are kept, nothing is written and the reply says nothing changed.
  - A separate `set_token_variant` tool: a second tool that sets art, with the same replies and refusals.
  - Ignore `focus` and `zoom` with a variant: the DM would believe a crop was applied.
  - Compare urls before loading: misses the same file served from the other host, and the hash is the rule 382.2 set.
- Where: `setTooManyTokensVariant` (`token-variants.ts`); `setTokenArtTool`, `setTokenVariantText` (`packages/mcp/src/tools.ts`).
- Status: active

## 387.5 The contact sheet is a fixed 640 by 512 px WebP on opaque white with no text; the engine owns its layout

- Decided by: epic #375 orchestrator, 2026-11-20, plan gate (Q4), not human-approved.
- Context: Per the maintainer's D6 (the engine owns the contact-sheet layout; `imaging` draws behind `Tokeniser`). Token art is transparent outside the circle, and clients show alpha differently.
- Options:
  - Chosen: `CONTACT_SHEET_LAYOUT` is 5 columns by 4 rows of 128 px cells on `#ffffff`, passed unchanged for every page, so a short last page leaves cells blank; each image is scaled to fit its cell. The sheet is WebP (quality 90) with no text.
  - Size the sheet to the page's variant count: the model would see a different frame per page.
  - Transparent background: the model's view depends on how the client composites alpha.
- Where: `CONTACT_SHEET_LAYOUT` (`packages/engine/src/encounter/tokeniser.ts`); `contactSheet` (`packages/imaging/src/sharp-tokeniser.ts`).
- Status: active

## 387.6 Each contact-sheet cell is encoded as PNG before compositing, so every format's letterbox bands show the background

- Decided by: work-ticket orchestrator (the #387 builder, under the epic #375 orchestrator), 2026-11-20, review round 1 (overriding a reviewer note), not human-approved.
- Context: Per 387.5. `validateTokenImage` accepts PNG, JPEG and WebP. A resized cell kept its input format, and JPEG has no alpha, so a non-square JPEG's bands came out black instead of the layout background. Every file in today's index is WebP, so the data never hit it.
- Options:
  - Chosen: encode each resized cell as PNG before compositing; one unit test pins a JPEG's bands to the background.
  - Leave it: the port's contract (each image scaled to fit its cell on the opaque background) would be false for one accepted format.
- Where: `composeSheet` (`packages/imaging/src/sharp-tokeniser.ts`).
- Status: active
