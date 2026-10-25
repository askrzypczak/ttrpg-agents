# Decision log

Why the standing rules are what they are. `CLAUDE.md` and `docs/architecture.md` hold the current rules; this folder holds their history: each decision, the options weighed, who decided and when to reopen it.

One file per ticket that made a decision. The format (file naming, entry fields, what counts as a decision, superseding) is the ticket-workflow plugin's: [`decision-log.md`](https://github.com/askrzypczak/claude-workflow/blob/main/plugins/ticket-workflow/skills/work-ticket/decision-log.md) in askrzypczak/claude-workflow. The workflow adds a ticket's file in that ticket's PR. Issue and PR numbers in the files refer to this repo.

## Searching

- By code: `grep -rn 'packages/owlbear/src/sync-plan.ts' docs/decisions/` finds the entries whose `Where` names that file; a symbol such as `planSync` works the same way.
- By who decided: `grep -rn 'Decided by: maintainer' docs/decisions/`, or `orchestrator`, `implementer`, `reviewer`; `grep -rn 'not human-approved' docs/decisions/` lists the entries no human approved.
- By status: `grep -rn 'Status: active' docs/decisions/`; `grep -rn 'superseded by' docs/decisions/` lists the replaced ones.
- By reopening condition: `grep -rn 'Revisit if' docs/decisions/` lists the conditions to check when a ticket touches that area.
