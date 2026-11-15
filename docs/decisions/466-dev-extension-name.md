# feature: the dev bridge's extension shows in Owlbear as ttrpg-agents (dev)

Issue: [#466](https://github.com/askrzypczak/ttrpg-agents/issues/466).

## 466.1 The bridge renames the served manifest per request, from an extension name the composition root picks by profile

- Decided by: work-ticket orchestrator, 2026-11-14, plan gate (plan approved by the maintainer).
- Context: Every bridge serves the same built `manifest.json`, named `ttrpg-agents`, so Owlbear shows the dev and the real extension alike. The extension files are the checkout's build in both profiles (370.4).
- Options:
  - Chosen: `startBridgeServer` takes an optional `extensionName` and sets it as `name` and `action.title` when it serves `manifest.json` from the root of the static folder; the file is read and rewritten per request, like every static file. `cli.ts` picks `ttrpg-agents (dev)` for the `dev` profile and `ttrpg-agents` otherwise.
  - Export the name from `@ttrpg-agents/config`: one more export for one caller.
  - A built manifest per profile: a second `dist/` or a build flag, and `extensionDir` is per checkout, not per profile.
  - Rewrite once at startup: a rebuilt extension would need a bridge restart.
- Where: `BridgeServerOptions.extensionName`, `serveStatic` (`packages/bridge/src/server.ts`); `packages/bridge/src/cli.ts`.
- Status: active

## 466.2 A manifest that is not a JSON object is served as built

- Decided by: work-ticket orchestrator, 2026-11-14, plan gate (plan approved by the maintainer).
- Context: `JSON.parse` forces a choice when the built file is broken. The rewrite runs on the static path, which today never fails on a readable file.
- Options:
  - Chosen: serve the file unchanged; Owlbear sees the same broken manifest it would without the rename.
  - Answer 500: a new error path for a broken build that Owlbear rejects either way.
- Where: `serveStatic` (`packages/bridge/src/server.ts`).
- Status: active

## 466.3 The bridge README gives remove-and-re-add steps for a dev extension added before the rename

- Decided by: maintainer, 2026-11-14, plan gate (the default offered for the audit's conflict with 446.4).
- Context: 446.4 gives no reinstall steps for old `?token=` installs, because whether Owlbear replaces or duplicates an extension added again from a different URL was unverified. Here the URL is the same and the old extension is removed first; an agent did exactly that on 2026-11-14 and Owlbear showed the new name after a reload.
- Options:
  - Chosen: the README says to remove the dev extension and add the same URL again; 446.4 stays active for old token installs.
  - Mark 446.4 superseded in part: its case (a different URL, no removal) is still unverified.
  - No reinstall steps until a Mac check: a GM who added the dev extension earlier finds no fix in the docs.
- Where: `packages/bridge/README.md` (Test a branch).
- Revisit if: a dev extension removed and added again from the same URL still shows the old name, or shows twice.
- Status: active
