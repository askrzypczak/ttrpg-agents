# feature: the SRD's XP tables as committed srd data

Issue: [#407](https://github.com/askrzypczak/ttrpg-agents/issues/407). Applies 396.1 (CR 0 counts 10 XP) from `396-encounter-difficulty.md` without re-logging it.

## 407.1 The tables are transcribed from public CC-BY Markdown copies of the SRD 5.2 text, not from the PDF

- Decided by: epic #396 orchestrator, 2026-11-21, plan gate, not human-approved.
- Context: The official PDF is not reachable from the build container. The tables must be committed data before #410 can load them.
- Options:
  - Chosen: transcribe from public CC-BY Markdown copies of the SRD 5.2 text (`springbov/dndsrd5.2_markdown`, `open5e/open5e-api` raw sources). The budget table is checked against two copies, the XP table against one plus the schema's non-decreasing rule, and both against the three worked examples. `ATTRIBUTION.md` does not claim the PDF was read.
  - Wait for the maintainer to transcribe from the PDF on the Mac: blocks #410.
  - Take XP from Open5e per-creature data: wrong at CR 0, rejected by the ticket.
- Where: `packages/srd/data/srd-5.2/difficulty.json`, `packages/srd/data/srd-5.2/ATTRIBUTION.md`.
- Revisit if: the maintainer finds a row that differs from the PDF.
- Status: active
