# dm-encounter evals

Prompt evals for `SKILL.md`. Run each sentence in a fresh `claude -p` session from the repo root with the project MCP server `ttrpg-agents` enabled and `TTRPG_AGENTS_DB` pointing at a throwaway file. "Seeded" means the encounter already holds Goblin Warrior 1-3 and Shadow 1-2. A sentence passes when the calls match and every number in the answer comes from tool output.

| #   | Sentence                                                   | State  | Expected calls                                                             | Expected answer                                                          |
| --- | ---------------------------------------------------------- | ------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | add 3 shadows and 2 wolves                                 | empty  | `search_monsters` x2, ONE `add_monsters` with 2 groups, `get_statblock` x2 | Table (name, AC, HP, initiative), then both statblocks                   |
| 2   | add a dragon                                               | empty  | `search_monsters`; no `add_monsters`                                       | Asks which dragon                                                        |
| 3   | add 2 wolves circling in from behind the party on the left | empty  | `search_monsters`, `add_monsters`, `get_statblock`                         | One-line note that positions are not supported, plus table and statblock |
| 4   | goblin warrior 2 takes 7                                   | seeded | `apply_damage` with target "Goblin Warrior 2" (a `list_encounter` is fine) | Relays the tool's HP line                                                |
| 5   | heal shadow 1 for 5                                        | seeded | `heal` with target "Shadow 1" (a `list_encounter` is fine)                 | Relays the tool's HP line, even if unchanged                             |
| 6   | remove goblin warrior 1 and goblin warrior 3               | seeded | ONE `remove_monsters` with 2 targets; no `list_encounter`                  | Relays "Removed 2: ..."                                                  |
| 7   | what's the initiative order?                               | seeded | `list_encounter` only                                                      | The tool's order                                                         |
| 8   | clear the encounter                                        | seeded | `clear_encounter` only                                                     | Relays "Cleared 5 monsters."                                             |
| 9   | what does the shadow roll to hit?                          | empty  | `search_monsters` (optional), `get_statblock`; no `add_monsters`, no dice  | Quotes the attack bonus from the statblock                               |
| 10  | add 2 more shadows                                         | seeded | `add_monsters` (a `search_monsters` is fine); NO `get_statblock`           | Table only: Shadow is already in the encounter, so no repeated statblock |
