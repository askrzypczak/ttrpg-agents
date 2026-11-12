# feature: remove the extension token; the bridge admits the extension by its Host and Origin checks

Issue: [#446](https://github.com/askrzypczak/ttrpg-agents/issues/446).

## 446.1 The bridge admits the extension by its Host and Origin checks; the extension token is removed

- Decided by: maintainer, 2026-11-12, #368 plan gate and review.
- Context: The extension token reached every player's client through the install URL (`?token=` in the manifest's popover URL), and a process run by the same OS user could read its file anyway. Other OS users on the GM's machine are out of scope (one machine, one GM tab). The `Origin` check on the upload stays because it guards against web pages.
- Options:
  - Chosen: no extension token. The bridge admits the extension by the Host check on every request and the own-origin `Origin` check on the WebSocket upgrade and on `POST /token-images`. The agent token and `POST /agent/query` do not change.
  - Keep the token: it protects nothing the Host and Origin checks do not, and it leaks to players through the install URL.
- Where: `startBridgeServer`, `handleMessage`, `serveStatic` (`packages/bridge/src/server.ts`); `packages/bridge/src/cli.ts`; `packages/bridge/src/token-file.ts`; the `hello` payload (`packages/protocol/src/protocol.ts`); `packages/owlbear/src/main.ts`; `docs/architecture.md` (Token and auth).
- Supersedes: 219.3 (in part: the extension token as bearer on `POST /token-images`), 220.6 (in part: the extension token as bearer on `GET /token-images/<sha256>`).
- Status: active

## 446.2 `POST /token-images` accepts only the bridge's own origin and refuses others with 403 `unauthorized` before the body is read; `GET /token-images/<sha256>` keeps only the Host check

- Decided by: the `Origin` check on the upload and the bare read route, maintainer, 2026-11-12, #368 review and ticket #446; the status and code (403 `unauthorized`), epic #366 orchestrator, 2026-11-12, plan gate, not human-approved.
- Context: Browsers send `Origin` on every POST, same-origin included, so a page on another origin cannot pass for the panel. The read route answers only bytes a page on another origin cannot read (no CORS headers). No code reads the refusal codes.
- Options:
  - Chosen: a missing, `null` or other `Origin` gets 403 with the existing code `unauthorized`; the upload refusal enum does not change.
  - A new code `forbidden_origin`: one more enum value that nothing reads.
  - 401 `unauthorized`: 401 means missing credentials, and the route takes none now.
- Where: the upload handler and the own-origin list in `startBridgeServer` (`packages/bridge/src/server.ts`); `tokenImageUploadResponseSchema`, `tokenImageReadErrorSchema` (`packages/protocol/src/protocol.ts`); `uploadTokenImage`, `downloadTokenImage` (`packages/owlbear/src/token-art.ts`).
- Status: active

## 446.3 `PROTOCOL_VERSION` goes to 2 for the removed `hello` field, and test envelopes use the constant

- Decided by: the bump, maintainer (ticket #446); the constant in tests, spec audit folded at the plan gate, epic #366 orchestrator, 2026-11-12, not human-approved.
- Context: A new tab against an old bridge would send a `hello` without `token`, get `unauthenticated` and reconnect forever. With the bump, both sides refuse each other with "Bridge and extension versions differ".
- Options:
  - Chosen: version 2. Production envelopes and test envelopes built in TypeScript use `PROTOCOL_VERSION`, so the next bump is one edit; raw JSON strings and the foreign-version tests keep literals.
  - No bump (precedent 328.x): no sweep, but the reconnect loop above.
- Where: `PROTOCOL_VERSION` (`packages/protocol/src/protocol.ts`); envelopes in `packages/bridge/src` and `packages/owlbear/src`.
- Status: active

## 446.4 Old installs keep working, and the docs give no reinstall steps

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved.
- Context: An extension installed with `...manifest.json?token=...` keeps working, because the bridge ignores the query and the extension reads no fragment. Whether Owlbear replaces or adds an extension added again from a different URL is unverified (no browser in the agent container); two installs in one room would make two panels fight over the bridge.
- Options:
  - Chosen: the docs say only that an old install keeps working, that its token grants nothing now and that the old `bridge-token` file can be deleted.
  - Remove-and-re-add steps: unverified Owlbear behaviour.
  - A Mac check by the maintainer first: blocks the ticket on a manual step.
- Where: root `README.md` (the token paragraph); `packages/bridge/README.md` (install paragraph).
- Revisit if: a Mac check shows how Owlbear treats a custom extension added again from a different URL.
- Status: active
