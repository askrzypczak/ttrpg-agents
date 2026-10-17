# @ttrpg-agents/owlbear

Owlbear Rodeo extension (GM-only panel that talks to the local bridge).

## Layering

- `src/obr-adapter.ts` is the ONLY module that imports `@owlbear-rodeo/sdk`
  (ESLint `no-restricted-imports` enforces it). It exposes the narrow
  `ObrAdapter` interface and `createObrAdapter()`.
- `src/scene-model.ts` is a pure in-memory scene (items, scene metadata, role,
  ready flag, change listeners). No SDK or vitest imports.
- `src/fake-adapter.ts` implements `ObrAdapter` over a `SceneModel`.
- Logic modules (`hidden-token.ts`, `initiative.ts`, ...) take an `ObrAdapter`,
  never the SDK. `main.ts` wires `createObrAdapter()` into them.

## Testing

Tests live next to the code as `src/*.test.ts` and run under the root vitest
(`npm test` / `npm run check`); no browser is needed.

```ts
const { obr, scene } = createFakeObr(new SceneModel("gm"));
await addHiddenToken(obr, {
  id: "t1",
  name: "Goblin",
  position: { x: 0, y: 0 },
});
expect(scene.getItems()[0]?.visible).toBe(false);
```

`createObrAdapter()` itself is not unit-tested (it needs the real SDK); the
Playwright e2e suite (below) covers it. Image items need `image` and `grid` specs
because the real adapter builds them with the SDK's `buildImage`; `layer`
defaults to `CHARACTER` and `scale` to `{ x: 1, y: 1 }`.

Use `scene` for assertions and to drive changes (`scene.setReady(true)`).
When adding an SDK call, extend `ObrAdapter`, `createObrAdapter()` and the
fake together. The e2e fake host reuses `SceneModel`.

## E2E (Playwright, no Owlbear account)

`npm run test:e2e` (root) builds everything, then runs `e2e/*.e2e.ts` on
Chromium. First time: `npx playwright install chromium`. It is NOT part of
`npm run check` (needs a browser); CI runs it as the separate `e2e` job.

- The real bridge (`packages/mcp`, port 5199) serves the real built extension
  (`dist`). A tiny server (`e2e/serve.ts`, 127.0.0.1:5200) serves the harness
  (`dist-e2e`, never the production `dist`) on a different origin, which
  iframes the extension with a proper `?obrref=`.
- `e2e/fake-host.ts` plays Owlbear over `postMessage` (OBR_READY, then
  `<id>_RESPONSE<nonce>`), backed by `SceneModel`. It answers only the calls
  the extension makes. Any other id gets an `_ERROR` reply and is recorded in
  `window.__host.errors`; an auto fixture fails every test that leaves errors
  behind, so the fake cannot drift silently. When you add an SDK call, add it
  to `ObrAdapter`, the unit fake, and `fake-host.ts` together.
- `main.ts` does not yet call `addItems`/`setMetadata`, so `e2e/driver.html`
  is a test-only page that runs the real `createObrAdapter()` through
  `addHiddenToken` / `writeInitiativeMetadata`.
- Test-only workarounds (`fixtures.ts`, `playwright.config.ts`): the bridge's
  `frame-ancestors` CSP is rewritten to allow the harness origin, and
  Chromium's Local Network Access checks are disabled (a route-fulfilled
  document loses its loopback address space). Ports 5199/5200 must be free.
