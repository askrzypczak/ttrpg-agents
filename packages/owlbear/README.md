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
Playwright e2e work (#42) covers it. Image items need `image` and `grid` specs
because the real adapter builds them with the SDK's `buildImage`; `layer`
defaults to `CHARACTER` and `scale` to `{ x: 1, y: 1 }`.

Use `scene` for assertions and to drive changes (`scene.setReady(true)`).
When adding an SDK call, extend `ObrAdapter`, `createObrAdapter()` and the
fake together. The Playwright e2e fake host (#42) reuses `SceneModel`.
