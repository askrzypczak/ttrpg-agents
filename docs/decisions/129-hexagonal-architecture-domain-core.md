# Epic F: hexagonal architecture with a domain core (engine)

Issue: [#129](https://github.com/askrzypczak/ttrpg-agents/issues/129). Recorded retroactively on 2026-10-25 (#236).

## 129.1 The game lives in a domain core (`@ttrpg-agents/engine`) with ports, and dependencies point inward

- Decided by: maintainer, 2026-10-20, recorded retroactively from #129 (the rule was written into `CLAUDE.md` by #130, PR #139).
- Context: The repo had a domain core in practice but not in structure: one `core` package mixed game logic with adapters (SQLite, the file loader, the Open5e mapper, bridge wire code), the `MonsterIndex` port was declared inside the file-system adapter, and wire types were copied by hand. The rule was written nowhere an agent reads before planning (#130).
- Options:
  - Chosen: ports and adapters around a domain core. `engine` holds the rules, simulation, use cases and the ports they need, with no I/O and no Node built-ins; driven adapters (`store-sqlite`, `srd`) implement its ports; driving adapters (`mcp`, `bridge`) call it, and only composition roots wire adapters together; wire contracts live in `protocol`; `owlbear` imports only `engine` and `protocol`. The boundaries are enforced by build config, lint and a test, not only documented.
  - Keep one `core` package with a browser-safe lint rule on one subpath (the status quo): lost because that boundary "is not a property of a package", and adapter code and leaks had built up in `core` (#129).
  - Split the engine now into a system-agnostic core and a D&D 5e ruleset: deferred, not rejected; naming the package `engine` "leaves room for that later" (#129).
  - A layered (n-tier) design with the store at the bottom and the domain depending on it (reconstructed; no ticket names it): the domain would import SQLite and could not run in the browser extension.
- Where: `CLAUDE.md` (Architecture); `docs/architecture.md` (Hexagon (packages and ports)); the engine's ports `EncounterRepository` (`packages/engine/src/encounter/repository.ts`), `EncounterLog` (`packages/engine/src/encounter/log.ts`), `MonsterIndex` (`packages/engine/src/monsters/types.ts`), `TablePort` (`packages/engine/src/table/port.ts`) and `Rng` (`packages/engine/src/dice/rng.ts`); `"types": []` in `packages/engine/tsconfig.build.json`; the per-package `no-restricted-imports` blocks built with `workspaceBan` in `eslint.config.js`; `ALLOWED` in `scripts/architecture.test.ts` (added later by #166); the composition roots `packages/mcp/src/stdio.ts` and `packages/bridge/src/cli.ts`.
- Revisit if: a second rule system is supported (the deferred split of the engine into a system-agnostic core and a D&D 5e ruleset).
- Status: active
