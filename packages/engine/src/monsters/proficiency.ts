/** SRD proficiency bonus by challenge rating: +2 for CR 0 to 4 (fractions included), +1 per 4 CR after, +9 at CR 29-30; the pattern continues above 30. */
export function proficiencyBonus(cr: number): number {
  return 2 + Math.floor((Math.max(cr, 1) - 1) / 4);
}
