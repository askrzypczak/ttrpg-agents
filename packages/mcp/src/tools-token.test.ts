import {
  TokeniserError,
  type CreatureRepository,
  type EncounterDirectory,
  type MonsterIndex,
  type Tokeniser,
} from "@ttrpg-agents/engine";
import {
  makeTestImageSource,
  makeTestSetupPorts,
  makeTestTokeniser,
  pngDeclaring,
  webpDeclaring,
} from "@ttrpg-agents/engine/testing";
import { describe, expect, it } from "vitest";
import type { ToolContext } from "./context.js";
import { tools, type ToolResult } from "./tools.js";

const PATH = "/home/dm/art/owlbear.png";

/** A stand-in for a store that records and refuses every call. */
function refusingStore<T extends object>(name: string, calls: string[]): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      if (typeof prop === "symbol" || prop === "then") return undefined;
      return () => {
        calls.push(`${name}.${prop}`);
        throw new Error(`${name}.${prop} must not be called`);
      };
    },
  });
}

function contextWith(tokeniser: Tokeniser) {
  const storeCalls: string[] = [];
  const ctx: ToolContext = {
    table: {
      sceneStatus: () => Promise.reject(new Error("not stubbed")),
      sceneMap: () => Promise.reject(new Error("not stubbed")),
      sceneTokens: () => Promise.reject(new Error("not stubbed")),
      mapImage: () => Promise.reject(new Error("not stubbed")),
    },
    browser: { showPage: () => Promise.reject(new Error("not stubbed")) },
    encounters: refusingStore<EncounterDirectory>("encounters", storeCalls),
    monsters: refusingStore<MonsterIndex>("monsters", storeCalls),
    creatures: refusingStore<CreatureRepository>("creatures", storeCalls),
    rng: { nextInt: () => 0 },
    now: () => new Date("2026-01-01T00:00:00Z"),
    newGroupId: () => "group",
    newCommandId: () => "command",
    setup: makeTestSetupPorts(),
    tokeniser,
    imageSource: makeTestImageSource({ [PATH]: pngDeclaring(1000, 600) }),
  };
  return { ctx, storeCalls };
}

async function previewToken(
  ctx: ToolContext,
  args: unknown,
): Promise<ToolResult> {
  return tools.find((t) => t.name === "preview_token")!.handler(ctx, args);
}

describe("preview_token", () => {
  it("preview_token returns the token as a WebP image block and a text line with the source size, focus, zoom and crop, with no structured content, and touches neither the encounter store nor the creature store", async () => {
    const { ctx, storeCalls } = contextWith(makeTestTokeniser());
    const result = await previewToken(ctx, {
      image: PATH,
      focus: { x: 0.5, y: 0.4 },
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toBeUndefined();
    expect(result.content).toEqual([
      {
        type: "image",
        data: Buffer.from(webpDeclaring(512, 512)).toString("base64"),
        mimeType: "image/webp",
      },
      {
        type: "text",
        text: "Source: 1000 x 600 px PNG. Focus: x 0.50, y 0.40. Zoom: 1. Crop: 600 px square at x 200, y 0.",
      },
    ]);
    expect(storeCalls).toEqual([]);
  });

  it("preview_token answers an error naming the cause when the tokeniser cannot load sharp", async () => {
    const cause =
      'Could not load the "sharp" module using the linux-x64 runtime';
    const cannotLoad = () =>
      Promise.reject(new TokeniserError(`Cannot load sharp: ${cause}`));
    const { ctx, storeCalls } = contextWith(
      makeTestTokeniser({ focalPoint: cannotLoad, renderToken: cannotLoad }),
    );
    const result = await previewToken(ctx, { image: PATH });
    expect(result.isError).toBe(true);
    const text = result.content
      .flatMap((c) => (c.type === "text" ? [c.text] : []))
      .join("\n");
    expect(text).toContain(cause);
    expect(storeCalls).toEqual([]);
  });
});
