# Reviewing PRs

Tests are 75-85% of the added lines in recent PRs, and feature PRs are vertical slices that touch four to six packages. Both are intended: a slice is the unit we ship, and the tests keep it honest. What was missing is a reading order and a test budget, so a reviewer had to find the decision in the diff and count the tests by hand. This page sets both.

## 1. Layer order

Read, commit and review in this order:

1. `engine`: domain core (rules, use cases, ports)
2. `store-sqlite`: encounter store, a driven adapter
3. `srd`: monster data, a driven adapter
4. `protocol`: bridge wire contract
5. `bridge`: HTTP and WebSocket server, and the client `mcp` uses for queries
6. `mcp`: driving adapter (tools and formatting)
7. `owlbear`: browser extension, a client of the bridge
8. docs and skills

Each layer imports only layers above it. The exception is test-only imports, such as the `store-sqlite` tests using `srd`. Reading top-down, every type is met before the code that uses it, so a reviewer meets the engine's rules before any adapter that translates them, and the adapter code can be read as translation.

## 2. Review map

Every PR body has a `## Review map` section, placed after the summary. It has three parts:

- **Reading list.** The files to read, in layer order. Mark each entry _decision_ if it holds a choice the reviewer should judge, or _mechanical_ if it is a rename, wiring or copy that the tests already cover.
- **Criteria table.** Each acceptance criterion with the symbol that implements it and the test that proves it.
- **Decision tests.** Three to five tests worth reading because they encode a decision. Not every test belongs here.

The map answers the first questions a reviewer has: where the decisions are, which symbol meets each criterion, and which tests to trust. The author knows these answers, so the reviewer should not have to rebuild them from the diff.

Copy this template into the PR body:

```markdown
## Review map

### Reading list

1. `packages/engine/src/<area>/<file>.ts` (_decision_): what to judge here
2. `packages/<adapter>/src/<file>.ts` (_mechanical_): what it does

### Criteria

| Criterion             | Implementing symbol                    | Proving test                |
| --------------------- | -------------------------------------- | --------------------------- |
| Text of the criterion | `symbolName` in `packages/.../file.ts` | `file.test.ts`: "test name" |

### Decision tests

- `packages/.../file.test.ts`: "test name" encodes why X and not Y.
```

## 3. Commits

- The contract commit comes first: the failing tests, written before any implementation, as the work-ticket workflow does.
- One commit per layer, in the layer order from section 1.
- A mechanical sweep (a rename, or a signature change across packages) goes in its own commit, so it does not hide inside a layer's diff.
- Do not squash before review.

GitHub's per-commit review then shows one layer at a time, and the sweep commit can be skimmed.

## 4. Test economy

- **The engine owns the rule.** A rule (for example, HP never drops below zero) is tested in the engine's test for that rule.
- **Adapter tests prove translation only.** An adapter test covers one happy path and one error mapping. It does not re-test engine rules.
- **Fixtures come from a per-package builder**, not from literals copied into each test. The engine's `@ttrpg-agents/engine/testing` subpath with `makeTestInstance` is the model. A package that lacks a builder gets one in the PR that would otherwise repeat a fixture.
- **Variants of one behaviour use `it.each`**, not copies of the test.
- **A new test file is for a new module.** Otherwise the test goes in the module's existing test file.

Repeating a rule across layers buys little: the engine's test already fails when the rule breaks. Example: HP clamping was tested in eight files across five packages.

## 5. Split threshold

A plan whose Interfaces touch five or more packages proposes a prerequisite ticket and a feature ticket at the plan gate. Epic G (#206) did this with #208 before #128 before #209.

## Promotion path

If PRs keep arriving without a review map, the review map slot moves into the `work-ticket` PR template in the claude-workflow repository, as a separate ticket there. The hard rules are summarised in [`CLAUDE.md`](../CLAUDE.md), under "PRs and reviews".
