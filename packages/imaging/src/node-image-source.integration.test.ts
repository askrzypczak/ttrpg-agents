import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImageUnavailableError } from "@ttrpg-agents/engine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNodeImageSource } from "./node-image-source.js";

const MIB = 1024 * 1024;

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "imaging-source-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A fetch that fails the test if a file load reaches the network. */
const noFetch = (() =>
  Promise.reject(
    new Error("a file load must not fetch"),
  )) as typeof globalThis.fetch;

describe("createNodeImageSource with files", () => {
  it("load reads the bytes of an absolute file path", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 8, 7, 6, 5]);
    const path = join(dir, "owlbear.png");
    await writeFile(path, bytes);
    const loaded = await createNodeImageSource({ fetch: noFetch }).load({
      path,
    });
    expect(new Uint8Array(loaded)).toEqual(bytes);
  });

  it.each<[string, () => Promise<string>]>([
    ["a missing file", () => Promise.resolve(join(dir, "missing.png"))],
    [
      "a sparse file over the 20 MiB cap made with `truncate`",
      async () => {
        const path = join(dir, "huge.png");
        await writeFile(path, new Uint8Array(0));
        await truncate(path, 20 * MIB + 1);
        return path;
      },
    ],
    ["a relative path", () => Promise.resolve("art/owlbear.png")],
  ])(
    "load refuses %s with an ImageUnavailableError naming the path",
    async (_case, makePath) => {
      const path = await makePath();
      const error = await createNodeImageSource({ fetch: noFetch })
        .load({ path })
        .then(
          () => undefined,
          (e: unknown) => e,
        );
      expect(error).toBeInstanceOf(ImageUnavailableError);
      expect((error as Error).message).toContain(path);
    },
  );
});
