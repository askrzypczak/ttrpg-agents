import { z } from "zod";

/**
 * The SRD difficulty tables: XP by challenge rating and the XP budget per
 * character by level. One row for each CR of 0, 1/8, 1/4, 1/2 and 1 to 30, and
 * for each level 1 to 20, in any order.
 */
export const difficultyTablesSchema = z
  .object({
    xpByCr: z.array(z.object({ cr: z.number(), xp: z.number().int().min(0) })),
    budgetPerCharacter: z.array(
      z.object({
        level: z.number().int(),
        low: z.number().int().min(0),
        moderate: z.number().int().min(0),
        high: z.number().int().min(0),
      }),
    ),
  })
  .superRefine(() => {
    throw new Error("not implemented");
  });

export type DifficultyTables = z.infer<typeof difficultyTablesSchema>;

/**
 * The XP of the row for `cr`, or undefined when the table has no such row.
 * With `inLair`, the XP of the next row up (the row's own XP at the top CR).
 */
export function xpForCr(
  tables: DifficultyTables,
  cr: number,
  options?: { inLair?: boolean },
): number | undefined {
  void tables;
  void cr;
  void options;
  throw new Error("not implemented");
}
