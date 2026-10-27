import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

// The rule pages (docs/*.md and the READMEs) are read at every ticket. A
// paragraph that grows by one clause per ticket stops being readable long
// before it stops being true, so a block longer than MAX_BLOCK_CHARS fails
// here and the ticket splits the section instead of appending to it. Ticket
// history goes in docs/decisions/ (see docs/reviewing.md, section 6), which
// this test does not read. See #319.
export const MAX_BLOCK_CHARS = 1000;

/** A block of prose: consecutive non-blank lines outside code fences, tables and headings; a list item starts its own block. */
export interface Block {
  /** 1-based line of the block's first line. */
  line: number;
  chars: number;
}

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^\s*#{1,6}\s/;
const TABLE_ROW = /^\s*\|/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;

/** The prose blocks of a Markdown document, with their length in characters. */
export function proseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  let current: { line: number; text: string[] } | undefined;
  let fenced = false;
  const flush = () => {
    if (current) {
      blocks.push({
        line: current.line,
        chars: current.text.join(" ").trim().length,
      });
      current = undefined;
    }
  };
  markdown.split("\n").forEach((raw, index) => {
    const line = raw.trimEnd();
    if (FENCE.test(line)) {
      flush();
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    if (line.trim() === "" || HEADING.test(line) || TABLE_ROW.test(line)) {
      flush();
      return;
    }
    if (LIST_ITEM.test(line)) flush();
    if (current) current.text.push(line.trim());
    else current = { line: index + 1, text: [line.trim()] };
  });
  flush();
  return blocks;
}

/** The blocks of `markdown` longer than `limit` characters. */
export function oversizedBlocks(markdown: string, limit: number): Block[] {
  return proseBlocks(markdown).filter((block) => block.chars > limit);
}

function markdownIn(dir: string): string[] {
  return readdirSync(join(root, dir))
    .filter((name) => name.endsWith(".md"))
    .map((name) => join(dir, name));
}

function packageReadmes(): string[] {
  return readdirSync(join(root, "packages"))
    .map((name) => join("packages", name, "README.md"))
    .filter((path) => statSync(join(root, path), { throwIfNoEntry: false }));
}

/** The pages this test keeps readable, relative to the repo root. */
export const PAGES = [
  "README.md",
  join("scripts", "README.md"),
  ...markdownIn("docs"),
  ...packageReadmes(),
];

describe("proseBlocks", () => {
  it("splits on blank lines and starts a block per list item", () => {
    const md = "one\ntwo\n\nthree\n- four\n  more\n- five\n1. six\n";
    expect(proseBlocks(md)).toEqual([
      { line: 1, chars: 7 },
      { line: 4, chars: 5 },
      { line: 5, chars: 11 },
      { line: 7, chars: 6 },
      { line: 8, chars: 6 },
    ]);
  });

  it("ignores headings, table rows and fenced code", () => {
    const md = [
      "# Title",
      "prose",
      "| a | b |",
      "| - | - |",
      "```ts",
      "const x = 1;",
      "",
      "const y = 2;",
      "```",
      "after",
    ].join("\n");
    expect(proseBlocks(md)).toEqual([
      { line: 2, chars: 5 },
      { line: 10, chars: 5 },
    ]);
  });

  it("reports only the blocks over the limit", () => {
    const md = "short\n\n" + "x".repeat(30) + "\n\nshort again\n";
    expect(oversizedBlocks(md, 20)).toEqual([{ line: 3, chars: 30 }]);
  });
});

describe("docs stay readable", () => {
  it("covers the root README, docs/*.md and every package README", () => {
    expect(PAGES).toContain("README.md");
    expect(PAGES).toContain(join("docs", "architecture.md"));
    expect(PAGES).toContain(join("packages", "owlbear", "README.md"));
    expect(PAGES.some((page) => page.includes("decisions"))).toBe(false);
  });

  it.each(PAGES)(
    `%s has no block over ${MAX_BLOCK_CHARS} characters`,
    (page) => {
      const markdown = readFileSync(join(root, page), "utf8");
      const oversized = oversizedBlocks(markdown, MAX_BLOCK_CHARS).map(
        (block) => `${page}:${block.line} (${block.chars} chars)`,
      );
      expect(oversized).toEqual([]);
    },
  );
});
