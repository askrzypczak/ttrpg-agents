import { z } from "zod";

const CHALLENGE_RATINGS: readonly number[] = [
  0,
  0.125,
  0.25,
  0.5,
  ...Array.from({ length: 30 }, (_, i) => i + 1),
];

const LEVELS: readonly number[] = Array.from({ length: 20 }, (_, i) => i + 1);

/** The index of the first row of each distinct value, in file order. */
function firstRows(values: readonly number[]): number[] {
  const seen = new Set<number>();
  const indexes: number[] = [];
  values.forEach((value, i) => {
    if (!seen.has(value)) {
      seen.add(value);
      indexes.push(i);
    }
  });
  return indexes;
}

/**
 * Exactly one row for each allowed value: a value outside `allowed` or repeated
 * is an issue at its row, a missing value an issue at the array.
 */
function checkRows(
  values: readonly number[],
  allowed: readonly number[],
  array: string,
  field: string,
  label: string,
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<number>();
  values.forEach((value, i) => {
    if (!allowed.includes(value)) {
      ctx.addIssue({
        code: "custom",
        path: [array, i, field],
        message: `${label} ${value} is not one of the table's ${label}s`,
      });
    } else if (seen.has(value)) {
      ctx.addIssue({
        code: "custom",
        path: [array, i, field],
        message: `${label} ${value} has more than one row`,
      });
    }
    seen.add(value);
  });
  for (const value of allowed) {
    if (!seen.has(value)) {
      ctx.addIssue({
        code: "custom",
        path: [array],
        message: `${label} ${value} has no row`,
      });
    }
  }
}

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
  .superRefine((tables, ctx) => {
    checkRows(
      tables.xpByCr.map((row) => row.cr),
      CHALLENGE_RATINGS,
      "xpByCr",
      "cr",
      "CR",
      ctx,
    );
    checkRows(
      tables.budgetPerCharacter.map((row) => row.level),
      LEVELS,
      "budgetPerCharacter",
      "level",
      "level",
      ctx,
    );

    // XP must not fall as CR rises: compare the first row of each CR in CR order.
    const byCr = firstRows(tables.xpByCr.map((row) => row.cr)).sort(
      (a, b) => tables.xpByCr[a]!.cr - tables.xpByCr[b]!.cr,
    );
    for (let k = 1; k < byCr.length; k++) {
      const lower = tables.xpByCr[byCr[k - 1]!]!;
      const higher = tables.xpByCr[byCr[k]!]!;
      if (higher.xp < lower.xp) {
        ctx.addIssue({
          code: "custom",
          path: ["xpByCr", byCr[k]!, "xp"],
          message: `XP for CR ${higher.cr} (${higher.xp}) is below XP for CR ${lower.cr} (${lower.xp})`,
        });
      }
    }

    tables.budgetPerCharacter.forEach((row, i) => {
      if (row.low > row.moderate) {
        ctx.addIssue({
          code: "custom",
          path: ["budgetPerCharacter", i, "moderate"],
          message: `level ${row.level}: Low (${row.low}) is above Moderate (${row.moderate})`,
        });
      }
      if (row.moderate > row.high) {
        ctx.addIssue({
          code: "custom",
          path: ["budgetPerCharacter", i, "high"],
          message: `level ${row.level}: Moderate (${row.moderate}) is above High (${row.high})`,
        });
      }
    });
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
  const row = tables.xpByCr.find((r) => r.cr === cr);
  if (row === undefined) return undefined;
  if (options?.inLair !== true) return row.xp;
  let next: { cr: number; xp: number } | undefined;
  for (const r of tables.xpByCr) {
    if (r.cr > cr && (next === undefined || r.cr < next.cr)) next = r;
  }
  return (next ?? row).xp;
}
