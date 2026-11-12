# Epic W: player state from D&D Beyond (cancelled)

Issue: [#432](https://github.com/askrzypczak/ttrpg-agents/issues/432). No ticket for this PR. The maintainer cancelled the epic in chat on 2026-11-12, after reading the findings of spike #434, and asked for the decision to be logged by a PR of its own.

## 432.1 Epic W is cancelled: nothing reads a player's state from D&D Beyond

- Decided by: maintainer, 2026-11-12, in chat, on the findings of spike #434.
- Context: The spike's [findings](https://github.com/askrzypczak/ttrpg-agents/issues/434#issuecomment-6813964305) answered the question 357.23 deferred:
  - An anonymous read of a Public character works, and its fields reproduce the sheet's HP. No field holds AC.
  - D&D Beyond has no API. Its terms (§5.2 V) ban scripts and extraction tools that collect information about its services in unauthorized ways, and staff refuse exceptions for side projects.
  - The endpoint is internal and may change with D&D Beyond's 2026 engine migration.
  - A Public sheet shows anyone with the link the usernames of the player, the DM and the other campaign members.
- Options:
  - Chosen: cancel the epic. #432 and its building tickets (#435, #436, #438, #445, #439) are closed as not planned. A player's character stays a named token (357.4).
  - Build as the spike specified (an anonymous read from the bridge every 60 s, with AC stated by the DM): rejected. It goes against the terms as the spike read them, the public repo would make the tool available, and it would break if the endpoint changes.
  - Ask D&D Beyond for permission first (§5.2 III invites requests): not pursued, since staff have refused exceptions for side projects.
- Where: #432, #434; roadmap #392 (Parked).
- Revisit if: D&D Beyond grants permission, or publishes an API or open client protocols for character data.
- Status: active
- Supersedes: 357.4 (the player-state epic only), 357.23
