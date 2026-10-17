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

## Encounter sync

`src/encounter-sync.ts` mirrors encounter instances as hidden (`visible: false`) circle SHAPE tokens named after the instance, in a row near the viewport centre. Tokens are linked by metadata key `com.ttrpg-agents/instance` (`{ instanceId }`); only items carrying it are ever touched. `applyEvent` and `applySnapshot` are idempotent (replays never duplicate), and `createEncounterSync(obr)` queues bridge messages so they apply one at a time. `hp-changed` is a no-op on tokens in v1. SHAPE items need a `shape` spec; the adapter exposes `getViewportCenter()`.

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
Playwright e2e work (#42) covers it. Image items need `image` and `grid` specs
because the real adapter builds them with the SDK's `buildImage`; `layer`
defaults to `CHARACTER` and `scale` to `{ x: 1, y: 1 }`.

Use `scene` for assertions and to drive changes (`scene.setReady(true)`).
When adding an SDK call, extend `ObrAdapter`, `createObrAdapter()` and the
fake together. The Playwright e2e fake host (#42) reuses `SceneModel`.
