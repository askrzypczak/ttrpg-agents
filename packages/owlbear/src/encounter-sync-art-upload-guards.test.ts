import { describe, expect, it, vi } from "vitest";
import type { PublishedTokenArt } from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import type { TokenImageUploadResponse } from "@ttrpg-agents/protocol";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import type { Timers } from "./reconnecting-socket.js";
import { createMessageFeed } from "./testing/messages.js";
import { instanceIdOf, type EncounterInstance } from "./sync-plan.js";

const inst = (n: number): EncounterInstance =>
  makeTestInstance({ id: `i${n}`, displayName: `Shadow ${n}`, createdAt: n });

const shadowArt: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/shadow.png",
  mime: "image/png",
  width: 300,
  height: 280,
};

const otherArt: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/shadow-2.png",
  mime: "image/png",
  width: 200,
  height: 200,
};

const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SHA256 = "cd".repeat(32);

const stored: TokenImageUploadResponse = {
  ok: true,
  image: { sha256: SHA256, mime: "image/png", width: 300, height: 280 },
};

/** Timers that never fire, so a failed reconcile is not retried behind the test's back. */
const idleTimers: Timers = {
  setTimeout: () => 1,
  clearTimeout: () => {},
};

/** Lets pending promise chains and timers queued by the sync run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/** An upload the test answers by hand. */
function pendingUpload() {
  let resolve!: (value: TokenImageUploadResponse) => void;
  const promise = new Promise<TokenImageUploadResponse>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function setup(options: {
  storeImage: () => Promise<TokenImageUploadResponse>;
  onArtStoreFailed?: (text: string) => void;
}) {
  const fake = createFakeObr(undefined, undefined, {
    pickImage: shadowArt,
    fetchImage: BYTES,
  });
  const uploads: Uint8Array[] = [];
  const reported: [string, PublishedTokenArt][] = [];
  const errors: unknown[] = [];
  const sync = createEncounterSync(
    fake.obr,
    (e) => errors.push(e),
    () => {},
    {
      timers: idleTimers,
      send: (message) => {
        if (message.type === "token-art-set")
          reported.push([message.payload.monsterKey, message.payload.art]);
        return true;
      },
      storeImage: (bytes) => {
        uploads.push(bytes);
        return options.storeImage();
      },
      ...(options.onArtStoreFailed === undefined
        ? {}
        : { onArtStoreFailed: options.onArtStoreFailed }),
    },
  );
  const tokenIds = () =>
    fake.scene
      .getItems()
      .map(instanceIdOf)
      .filter((id) => id !== undefined)
      .sort();
  return { sync, uploads, reported, errors, tokenIds };
}

describe("createEncounterSync token art upload guards", () => {
  it("an upload answered after a snapshot brought back the same art still sends the hash", async () => {
    const feed = createMessageFeed();
    const upload = pendingUpload();
    const { sync, uploads, reported } = setup({
      storeImage: () => upload.promise,
    });

    await sync.handleMessage(feed.snapshot([inst(1)]));
    await vi.waitFor(() => expect(uploads).toHaveLength(1));
    // A reconnect: the store's copy of the pick, without a hash yet.
    await sync.handleMessage({
      v: 1,
      type: "hello-ack",
      payload: { serverVersion: "0" },
    });
    await sync.handleMessage(
      feed.snapshot([inst(1)], { art: { shadow: { ...shadowArt } } }),
    );

    upload.resolve(stored);
    await vi.waitFor(() => expect(reported).toHaveLength(2));
    expect(reported[1]).toEqual(["shadow", { ...shadowArt, sha256: SHA256 }]);
  });

  it("an upload answered after the type's art changed sends no hash for the earlier pick", async () => {
    const feed = createMessageFeed();
    const upload = pendingUpload();
    const { sync, uploads, reported } = setup({
      storeImage: () => upload.promise,
    });

    await sync.handleMessage(feed.snapshot([inst(1)]));
    await vi.waitFor(() => expect(uploads).toHaveLength(1));
    await sync.handleMessage(
      feed.snapshot([inst(1)], { art: { shadow: otherArt } }),
    );

    upload.resolve(stored);
    await settle();
    expect(reported).toEqual([["shadow", shadowArt]]);
  });

  // A rejection escaping the upload would fail the run as unhandled.
  it("a throwing failure handler leaves no unhandled rejection and later snapshots still apply", async () => {
    const feed = createMessageFeed();
    let calls = 0;
    const { sync, tokenIds, errors } = setup({
      storeImage: () => Promise.reject(new Error("bridge unreachable")),
      onArtStoreFailed: () => {
        calls += 1;
        throw new Error("panel gone");
      },
    });

    await sync.handleMessage(feed.snapshot([inst(1)]));
    await vi.waitFor(() => expect(calls).toBe(1));
    await sync.handleMessage(
      feed.snapshot([inst(1), inst(2)], { art: { shadow: shadowArt } }),
    );
    await settle();

    expect(tokenIds()).toEqual(["i1", "i2"]);
    expect(errors).toEqual([]);
  });
});
