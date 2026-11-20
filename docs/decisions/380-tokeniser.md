# feature: tokenise an image locally, with an engine port, an `imaging` adapter package and a `preview_token` tool

Issue: [#380](https://github.com/askrzypczak/ttrpg-agents/issues/380).

## 380.1 Tokenising runs locally in a new driven adapter package `imaging` (sharp) behind the engine ports `Tokeniser`, `ImageSource` and `TokeniserProbe`; the engine owns the crop maths, limits and style

- Decided by: maintainer, 2026-11-11 (357.7, epic #375 body); the package shape and the third port by the epic #375 orchestrator, 2026-11-18, plan gate, not human-approved.
- Context: Token art needs a circle crop, a frame and transparency outside. The hexagon keeps I/O and native libraries out of the engine, and every number the agent reports comes from the engine.
- Options:
  - Chosen: a new package `imaging` with `createSharpTokeniser` (one object that is the `Tokeniser` and the `TokeniserProbe`) and `createNodeImageSource`; the engine holds `tokenCrop`, `makeToken`, `TOKEN_STYLE`, `TOKEN_ZOOM_MAX` and the source limits.
  - `sharp` inside `mcp`: no new package, but a native library and outbound fetches in a driving adapter, against the hexagon.
  - A pure-JS image library: no native binary, but no attention search and a weak WebP encoder.
  - A `check()` method on `Tokeniser` instead of a separate probe: `SetupPorts` would hold a full `Tokeniser`; the separate probe follows `DatabaseProbe` and `BridgeProbe`.
- Where: `packages/imaging/src/sharp-tokeniser.ts` (`createSharpTokeniser`), `packages/imaging/src/node-image-source.ts` (`createNodeImageSource`), `packages/engine/src/encounter/tokeniser.ts` (`Tokeniser`, `tokenCrop`, `makeToken`), `packages/engine/src/encounter/image-source.ts` (`ImageSource`), `packages/engine/src/setup/port.ts` (`TokeniserProbe`).
- Status: active

## 380.2 Both mcp composition roots (`stdio.ts`, `status-cli.ts`) may import `@ttrpg-agents/imaging`; no other mcp file may

- Decided by: epic #375 orchestrator, 2026-11-18, plan gate, not human-approved.
- Context: The ticket named `stdio.ts` only; it was written before #371 made `status-cli.ts` a composition root. `npm run status` must print the same text as `setup_status`, tokeniser row included.
- Options:
  - Chosen: both roots wire `createSharpTokeniser()`; lint bans the package in every other mcp file.
  - `stdio.ts` only, with an optional probe: the status command loses the tokeniser row and no longer matches `setup_status`.
  - A non-root mcp file importing the adapter: against "Only composition roots wire adapters together".
- Where: `eslint.config.js` (mcp blocks), `packages/mcp/src/stdio.ts`, `packages/mcp/src/status-cli.ts`, `scripts/architecture.test.ts`.
- Revisit if: a third composition root appears.
- Status: active

## 380.3 `NodeImageSource` loads any https URL and any absolute path: https only, redirects only to https, 20 MiB cap, 5 s timeout; no host allowlist and no private or loopback address refusal

- Decided by: epic #375 orchestrator, 2026-11-18, plan gate, not human-approved; the maintainer is told so he can veto.
- Context: The DM's agent names the image. The bytes must parse as an image of at most 20 MiB and go only back to the agent, which can already read local files.
- Options:
  - Chosen: https only (redirects followed only to https, at most 5; only 301, 302, 303, 307 and 308 count as redirects, any other 3xx is refused), a 20 MiB cap (declared length and streamed body), one 5 s timeout over the whole load; absolute paths only for files.
  - Refuse private and loopback addresses: a DNS step in boundary code, against a risk the agent's own file access already exceeds.
  - A host allowlist: the DM's image hosts are not known in advance.
- Where: `packages/imaging/src/node-image-source.ts` (`createNodeImageSource`), `packages/engine/src/encounter/image-source.ts` (`parseImageLocation`, `IMAGE_LOAD_TIMEOUT_MS`), `packages/engine/src/encounter/token-image.ts` (`TOKEN_SOURCE_MAX_BYTES`).
- Revisit if: the MCP server ever fetches a URL that does not come from the DM's agent.
- Status: active

## 380.4 Token style: a 512 px square WebP with one thin dark-bronze ring, 0.03 of the side wide, colour `#6e4b2a`

- Decided by: epic #375 orchestrator, 2026-11-18, plan gate, not human-approved (the epic body's suggested default for open question 2; the exact width and colour are the planner's); the maintainer was asked to confirm or veto.
- Context: Own-image tokens should sit next to TooManyTokens art, which has a thin dark frame.
- Options:
  - Chosen: one fixed ring, `TOKEN_STYLE = { side: 512, ringWidth: 0.03, ringColour: "#6e4b2a" }`.
  - No frame: own-image tokens look unlike the TooManyTokens defaults.
  - A frame the DM picks: a style option and a choice per token, more than the epic asks for.
- Where: `packages/engine/src/encounter/tokeniser.ts` (`TOKEN_STYLE`), `packages/imaging/src/sharp-tokeniser.ts` (`renderToken`).
- Revisit if: the maintainer picks another frame option.
- Status: active

## 380.5 With no `focus`, `makeToken` centres the crop on the tokeniser's attention point (variant A), chosen by the attention trial

- Decided by: epic #375 orchestrator, 2026-11-18, plan gate, not human-approved (both outcomes pre-approved at the gate; the builder ran the trial on 2026-11-19 and picked A by its rule).
- Context: The ticket asks for a trial: keep sharp's attention point as the default focus unless it misses the face more often than the image centre. Over 13 openly licensed images (6 Battle for Wesnoth busts, 7 Ancient Beast full-body illustrations) at zoom 1 and 2, attention held the face in 17 of 26 crops and the centre in 13; attention missed where the centre held 3 times, the centre missed where attention held 7 times. The table is in the PR body.
- Options:
  - Chosen: variant A, `Tokeniser.focalPoint` (sharp's attention strategy) is the default focus.
  - Variant B, the centre (0.5, 0.5): no `focalPoint` on the port, but it missed faces more often, mainly on full-body art where the head is in the top third.
- Where: `packages/engine/src/encounter/tokeniser.ts` (`makeToken`, `Tokeniser.focalPoint`), `packages/imaging/src/sharp-tokeniser.ts` (`focalPoint`).
- Revisit if: DMs often pass `focus` to fix the default crop.
- Status: active

## 380.6 The setup report's tokeniser row comes last and carries the `reinstall-dependencies` fix; there is no config key

- Decided by: epic #375 orchestrator, 2026-11-18, plan gate, not human-approved.
- Context: The ticket asks for a tokeniser row in the setup report. Every other problem row carries a fix, and the pipeline is always online with no off switch (D3, maintainer 2026-11-11). Extends 371.1: the tokeniser row follows the GM tab row, or the bridge row when no GM tab row is shown.
- Options:
  - Chosen: `ok` when sharp loads, otherwise `problem` with the reason and `{ code: "reinstall-dependencies" }` (`npm ci`).
  - A problem row with no fix: unlike every other problem row.
  - A config key to turn tokenising off: against the always-online decision.
- Where: `packages/engine/src/setup/status.ts` (`getSetupStatus`), `packages/engine/src/setup/port.ts` (`TokeniserFacts`, `TokeniserProbe`), `packages/mcp/src/setup-status.ts` (`formatSetupStatus`).
- Status: active

## 380.7 EXIF orientation is ignored: crops are in the stored pixel grid

- Decided by: epic #375 orchestrator, 2026-11-18, plan gate, not human-approved.
- Context: `image-size` measures the stored grid and `sharp` without `.rotate()` crops it, so the crop maths and the render agree. Illustrations rarely carry an orientation tag.
- Options:
  - Chosen: no rotation; a rotated phone photo comes out sideways.
  - Apply the EXIF orientation: the engine would have to read the tag to keep `tokenCrop` in the same grid as the render.
- Where: `packages/engine/src/encounter/tokeniser.ts` (`tokenCrop`), `packages/imaging/src/sharp-tokeniser.ts` (`renderToken`).
- Revisit if: a DM's photo comes out sideways.
- Status: active

## 380.8 When sharp reports no attention point, `focalPoint` answers the centre; a reported point is clamped to 0..1

- Decided by: implementer, 2026-11-19, implementation, not human-approved.
- Context: sharp's `OutputInfo` types `attentionX` and `attentionY` as optional. `makeToken` uses the focal point as the default focus, and `tokenCrop` refuses a focus outside 0..1.
- Options:
  - Chosen: a missing or non-finite coordinate becomes 0.5, and a reported one is clamped to 0..1, so a default crop always succeeds.
  - Reject with `TokeniserError`: `preview_token` with no `focus` would fail on an image where sharp found no point, though the centre is a usable default.
- Where: `packages/imaging/src/sharp-tokeniser.ts` (`attentionPoint`, `fraction`).
- Status: active

## 380.9 A file load has no timeout and reads at most one byte past the cap, so a file that grows after the size check is refused

- Decided by: implementer, 2026-11-19, implementation, not human-approved.
- Context: The plan sets the 5 s timeout for URL loads and checks a file's size with `stat` before reading it. The file can change between the check and the read.
- Options:
  - Chosen: `stat` (not a regular file or over 20 MiB refused), then a read stream that ends one byte past the cap, refused when it yields more than the cap; no timeout on local reads.
  - A plain `readFile` after `stat`: a file that grew in between is read whole, past the cap.
  - The 5 s timeout on file reads too: a slow local disk is not the failure the timeout guards against.
- Where: `packages/imaging/src/node-image-source.ts` (`loadFile`).
- Revisit if: DMs load images from slow network mounts.
- Status: active

## 380.10 The body-timeout path of `NodeImageSource` gets its own test, added in review

- Decided by: work-ticket orchestrator (#380 builder), 2026-11-19, review round 1, not human-approved; on the reviewer's suggestion, overriding the default that defers additive suggestions.
- Context: The reviewer found that removing the abort listener in `readCapped` left every test green, while a body that stalls after the headers would then hang the load forever. The plan says one timeout covers the whole load, body included.
- Options:
  - Chosen: one more row in the "load refuses %s" table, a body that sends 10 bytes and never closes under a 50 ms `timeoutMs`; it hangs to the test timeout with the listener removed.
  - Defer the test to a follow-up: the security-boundary path the timeout exists for would stay unguarded in this PR.
- Where: `packages/imaging/src/node-image-source.test.ts` ("load refuses %s with an ImageUnavailableError"), `packages/imaging/src/node-image-source.ts` (`readCapped`).
- Status: active
