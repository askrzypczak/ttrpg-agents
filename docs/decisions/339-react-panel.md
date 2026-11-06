# feature: use React for the Owlbear extension panel

Issue: [#339](https://github.com/askrzypczak/ttrpg-agents/issues/339).

## 339.1 The extension panel is rendered with React

- Decided by: maintainer, 2026-11-06, ticket body.
- Context: the panel was hand-built DOM: `index.html` held a static stack of elements and `main.ts` rewrote them by id, rebuilding lists with `replaceChildren` behind JSON-compare guards (`drawReuploads`, `drawTypeArt`) so the periodic render never replaced a button under the pointer. #338 is about to add many controls, and each would add more of this.
- Options:
  - Chosen: React (`react`, `react-dom`), the maintainer's preferred TypeScript frontend framework. Reconciliation keeps keyed elements, so the hand-written guards go.
  - Keep hand-written DOM: no dependency, but every new control repeats the lookup, redraw and guard code.
- Where: `packages/owlbear/src/panel.tsx`, `packages/owlbear/src/main.ts`, `packages/owlbear/index.html`, `packages/owlbear/package.json`.
- Status: active

## 339.2 Port the current panel first, with no visible or behavioural change; the redesign stays with #338's follow-ups

- Decided by: maintainer, 2026-11-06, ticket body.
- Context: #338 is a design spike for a reshaped panel; its follow-ups change the panel.
- Options:
  - Chosen: a like-for-like port that keeps every element id, class, attribute and text, so the unchanged e2e suite proves behaviour did not change; #338's follow-ups that change the panel are `Blocked by` this ticket.
  - Port and redesign together: one change instead of two, but no unchanged e2e suite to prove the port, and the redesign written against hand-built DOM first.
- Where: `packages/owlbear/src/panel.tsx`; `packages/owlbear/e2e/` (unchanged).
- Status: active

## 339.3 Component tests run under jsdom

- Decided by: maintainer, 2026-11-06, plan gate.
- Context: a test must show that a re-render keeps the same button elements and the file input, which needs a DOM; vitest ran in plain Node with no DOM library installed.
- Options:
  - Chosen: `jsdom` (dev dependency of `owlbear`), selected per file with `// @vitest-environment jsdom`; tests render with `createRoot` and `act` from React, without Testing Library. The mainstream, spec-faithful choice; its slower start does not matter at a handful of tests.
  - `happy-dom`: lighter and faster, but less complete, so a later component test could hit a gap.
  - A Playwright e2e test only: no dependency, but not part of `npm run check`, and holding the file chooser open while the list changes is awkward to drive.
- Where: `packages/owlbear/src/panel.test.tsx`; `packages/owlbear/package.json`.
- Status: active

## 339.4 `@vitejs/plugin-react` is kept in the extension build

- Decided by: maintainer, 2026-11-06, plan gate.
- Context: the plan audit proposed dropping the plugin: Vite 8 compiles JSX itself from the tsconfig's `jsx`, and the plugin's main extra, Fast Refresh, serves a dev server this package does not run (`dev` is `vite build --watch`).
- Options:
  - Chosen: keep it in `packages/owlbear/vite.config.ts`, the standard React and Vite setup, ready for Fast Refresh or the React Compiler in #338's follow-ups.
  - Drop it: one fewer dev dependency; adding it later is one line.
- Where: `packages/owlbear/vite.config.ts`; `packages/owlbear/package.json`.
- Status: active

## 339.5 `main.ts` keeps its name and renders `Panel` with `createElement`; scene and overlay texts move into the component, and `panelView` is unchanged

- Decided by: work-ticket orchestrator, 2026-11-06, plan gate (approved with the plan).
- Context: `main.ts` also wrote the scene line ("Scene ready.", "Waiting for scene...") and showed the overlay toggle, outside `panelView`; the ticket keeps `panelView` and its tests as they are.
- Options:
  - Chosen: `Panel` takes the `PanelView`, plus `sceneReady` and `showOverlayToggle` props; their strings move unchanged into `panel.tsx`. A missing view renders "Starting...", as the static page did before Owlbear was ready; `main.ts` renders it at load with no-op actions until the sync and socket exist (the implementer's choice; rendering only after `onReady` would leave the page blank until then). `main.ts` keeps its name (the README and earlier entries name it) and calls `createElement`, so it has no JSX. `e2e/vite.config.ts` is unchanged: it builds only the harness and driver pages, which import no `.tsx`, and the e2e suite loads the production `dist`.
  - Move the scene and overlay state into `PanelInput`/`PanelView`: one source for every panel string, but `panel-state.ts` and its tests would change in a port meant to keep them.
  - Rename `main.ts` to `main.tsx` to use JSX there: idiomatic, but renames a file many docs name, for one `createElement` call.
- Where: `Panel`, `PanelProps`, `PanelActions` (`packages/owlbear/src/panel.tsx`); `packages/owlbear/src/main.ts`.
- Status: active
