export const MAX_DICE_COUNT = 1000;
export const MAX_DICE_SIDES = 1000;
export const MAX_CONSTANT = 1_000_000;

export type DiceTerm =
  | { kind: "dice"; sign: 1 | -1; count: number; sides: number }
  | { kind: "constant"; sign: 1 | -1; value: number };

export interface DiceExpression {
  /** The original input string. */
  source: string;
  terms: DiceTerm[];
}

export class DiceParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiceParseError";
  }
}

/** Parses statblock dice expressions such as `5d8 + 5`, `d20`, `3d6 - 1`. */
export function parseDice(input: string): DiceExpression {
  const fail = (msg: string, pos: number): never => {
    throw new DiceParseError(
      `Invalid dice expression "${input}": ${msg} at position ${pos}`,
    );
  };
  const isDigit = (c: string): boolean =>
    c >= "0" && c <= "9" && c.length === 1;
  let pos = 0;
  const skipWs = (): void => {
    while (pos < input.length && /\s/.test(input.charAt(pos))) pos++;
  };
  const readInt = (): number | undefined => {
    const start = pos;
    while (pos < input.length && isDigit(input.charAt(pos))) pos++;
    return pos === start ? undefined : Number(input.slice(start, pos));
  };

  const terms: DiceTerm[] = [];
  let sign: 1 | -1 = 1;
  skipWs();
  if (pos >= input.length) return fail("expression is empty", 0);

  for (;;) {
    skipWs();
    const termStart = pos;
    const first = readInt();
    const c = input.charAt(pos);
    if (c === "d" || c === "D") {
      pos++;
      const sides = readInt();
      if (sides === undefined)
        return fail("expected number of sides after 'd'", pos);
      const count = first ?? 1;
      if (count < 1 || count > MAX_DICE_COUNT) {
        return fail(
          `dice count must be between 1 and ${MAX_DICE_COUNT}`,
          termStart,
        );
      }
      if (sides < 1 || sides > MAX_DICE_SIDES) {
        return fail(
          `dice sides must be between 1 and ${MAX_DICE_SIDES}`,
          termStart,
        );
      }
      terms.push({ kind: "dice", sign, count, sides });
    } else if (first !== undefined) {
      if (!Number.isSafeInteger(first) || first > MAX_CONSTANT) {
        return fail(
          `constant must be an integer no greater than ${MAX_CONSTANT}`,
          termStart,
        );
      }
      terms.push({ kind: "constant", sign, value: first });
    } else {
      return fail(
        pos >= input.length
          ? "unexpected end of input"
          : `unexpected character '${c}'`,
        pos,
      );
    }

    skipWs();
    if (pos >= input.length) break;
    const op = input.charAt(pos);
    if (op !== "+" && op !== "-")
      return fail(`expected '+' or '-' but found '${op}'`, pos);
    sign = op === "+" ? 1 : -1;
    pos++;
  }
  return { source: input, terms };
}
