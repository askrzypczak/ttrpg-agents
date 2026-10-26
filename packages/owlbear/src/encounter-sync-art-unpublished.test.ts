import { describe, expect, it, vi } from "vitest";
import type { PublishedTokenArt, TokenArt } from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import type { BridgeMessage } from "@ttrpg-agents/protocol";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr, type FakePick } from "./fake-adapter.js";
import type { ImageUpload } from "./obr-adapter.js";
import type { Timers } from "./reconnecting-socket.js";
import { createMessageFeed } from "./testing/messages.js";
import { instanceIdOf, type EncounterInstance } from "./sync-plan.js";
import type { StoredTokenImage } from "./token-art.js";

const inst = (n: number, monsterKey = "shadow"): EncounterInstance =>
  makeTestInstance({
    id: `${monsterKey}-${n}`,
    monsterKey,
    displayName: `${monsterKey} ${n}`,
    createdAt: n,
  });

const STORED_SHA = "c3".repeat(32);
/** The asset name the stored shadow image is uploaded under. */
const UPLOAD_NAME = `ttrpg-art-${"c3".repeat(8)}`;

/** Shadow art with stored bytes that were never published to Owlbear. */
const unpublished = { sha256: STORED_SHA } as TokenArt;

/** What the GM picks after the upload: the new asset. */
const picked: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/ttrpg-art-c3c3c3c3c3c3c3c3.png",
  mime: "image/png",
  width: 300,
  height: 280,
};

const STORED_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7,
]);

/** The image fields a token is drawn with. */
const pictureOf = ({ url, mime, width, height }: PublishedTokenArt) => ({
  url,
  mime,
  width,
  height,
});

/** Timers that never fire, so a failed reconcile is not retried behind the test's back. */
const idleTimers: Timers = {
  setTimeout: () => 1,
  clearTimeout: () => {},
};

const helloAck: BridgeMessage = {
  v: 1,
  type: "hello-ack",
  payload: { serverVersion: "0" },
};

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Lets pending promise chains and timers queued by the sync run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function setup(
  options: {
    pickImage?: FakePick;
    uploadImage?: (image: ImageUpload) => void | Promise<void>;
    /** `null` leaves the option out. Default: answers the stored bytes. */
    loadImage?: ((sha256: string) => Promise<StoredTokenImage>) | null;
    awaitUploadConfirmed?: (prompt: string) => Promise<void>;
  } = {},
) {
  const alive: string[] = [];
  const searches: (string | undefined)[] = [];
  const loads: string[] = [];
  const prompts: string[] = [];
  const fetched: string[] = [];
  const storedBytes: Uint8Array[] = [];
  const reported: [string, PublishedTokenArt][] = [];
  const errors: unknown[] = [];
  const pick = options.pickImage;
  const fake = createFakeObr(undefined, undefined, {
    imageAlive: (url) => {
      alive.push(url);
      return false;
    },
    pickImage: (search) => {
      searches.push(search);
      return typeof pick === "function" ? pick(search) : structuredClone(pick);
    },
    ...(options.uploadImage === undefined
      ? {}
      : { uploadImage: options.uploadImage }),
    fetchImage: (url) => {
      fetched.push(url);
      return STORED_BYTES.slice();
    },
  });
  const load = options.loadImage;
  const loadImage =
    load === null
      ? undefined
      : (sha256: string) => {
          loads.push(sha256);
          return load === undefined
            ? Promise.resolve({
                bytes: STORED_BYTES.slice(),
                mime: "image/png",
              })
            : load(sha256);
        };
  const confirm = options.awaitUploadConfirmed;
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
        storedBytes.push(bytes);
        return Promise.resolve({
          ok: true,
          image: {
            sha256: "e5".repeat(32),
            mime: "image/png",
            width: 300,
            height: 280,
          },
        });
      },
      ...(loadImage === undefined ? {} : { loadImage }),
      awaitUploadConfirmed: (prompt) => {
        prompts.push(prompt);
        return confirm === undefined ? Promise.resolve() : confirm(prompt);
      },
    },
  );
  const tokenOf = (instanceId: string) =>
    fake.scene.getItems().find((item) => instanceIdOf(item) === instanceId);
  return {
    fake,
    sync,
    alive,
    searches,
    loads,
    prompts,
    fetched,
    storedBytes,
    reported,
    errors,
    tokenOf,
  };
}

/** Expects one IMAGE token per instance id, drawn with `art`. */
function expectImages(
  tokenOf: (id: string) => unknown,
  ids: string[],
  art: PublishedTokenArt,
): void {
  for (const id of ids)
    expect(tokenOf(id), id).toMatchObject({
      type: "IMAGE",
      image: pictureOf(art),
    });
}

/** Expects one SHAPE (circle) token per instance id. */
function expectCircles(tokenOf: (id: string) => unknown, ids: string[]): void {
  for (const id of ids)
    expect(tokenOf(id), id).toMatchObject({ type: "SHAPE" });
}

describe("createEncounterSync token art without a url", () => {
  it("art without a url uploads its stored bytes under the hash-derived name with no liveness check, waits for the GM, then opens the picker once with that name as the default search", async () => {
    const feed = createMessageFeed();
    const confirmed = deferred<void>();
    const s = setup({
      pickImage: picked,
      awaitUploadConfirmed: () => confirmed.promise,
    });

    const applied = s.sync.handleMessage(
      feed.snapshot([inst(1), inst(2)], { art: { shadow: unpublished } }),
    );

    await vi.waitFor(() => expect(s.prompts).toHaveLength(1));
    expect(s.alive).toEqual([]);
    expect(s.loads).toEqual([STORED_SHA]);
    const uploads = s.fake.uploads();
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.name).toBe(UPLOAD_NAME);
    expect(uploads[0]?.mime).toBe("image/png");
    expect([...(uploads[0]?.bytes ?? [])]).toEqual([...STORED_BYTES]);

    // The GM has not confirmed yet: no picker.
    await settle();
    expect(s.fake.pickImageCalls()).toBe(0);

    confirmed.resolve();
    await applied;
    expect(s.searches).toEqual([UPLOAD_NAME]);
    expect(s.fake.uploads()).toHaveLength(1);
    expect(s.alive).toEqual([]);
  });

  it("the pick for art without a url becomes the type's art with the existing sha256, is sent as one token-art-set and draws the type's first tokens", async () => {
    const feed = createMessageFeed();
    const s = setup({ pickImage: picked });

    await s.sync.handleMessage(
      feed.snapshot([inst(1), inst(2)], { art: { shadow: unpublished } }),
    );

    expect(s.reported).toEqual([["shadow", { ...picked, sha256: STORED_SHA }]]);
    expectImages(s.tokenOf, ["shadow-1", "shadow-2"], picked);

    // A later token of the type is drawn with the picked art, with no new dialog.
    await s.sync.handleMessage(
      feed.event({ type: "added", instances: [inst(3)] }),
    );
    await settle();
    expectImages(s.tokenOf, ["shadow-3"], picked);
    expect(s.reported).toHaveLength(1);
    expect(s.fetched).toEqual([]);
    expect(s.storedBytes).toEqual([]);
    expect(s.fake.uploads()).toHaveLength(1);
    expect(s.fake.pickImageCalls()).toBe(1);
    expect(s.alive).toEqual([]);
    expect(s.errors).toEqual([]);
  });

  it("a cancelled pick for art without a url, or a sync without loadImage, leaves the type's tokens circles with no fresh pick and asks nothing again this session", async () => {
    // Cancelled pick.
    const feed = createMessageFeed();
    const s = setup({ pickImage: undefined });

    await s.sync.handleMessage(
      feed.snapshot([inst(1), inst(2)], { art: { shadow: unpublished } }),
    );

    expect(s.fake.uploads()).toHaveLength(1);
    expect(s.searches).toEqual([UPLOAD_NAME]);
    expectCircles(s.tokenOf, ["shadow-1", "shadow-2"]);
    expect(s.reported).toEqual([]);

    // Later reconciles: a new instance, then a reconnect with its snapshot.
    await s.sync.handleMessage(
      feed.event({ type: "added", instances: [inst(3)] }),
    );
    await s.sync.handleMessage(helloAck);
    await s.sync.handleMessage(
      feed.snapshot([inst(1), inst(2), inst(3), inst(4)], {
        art: { shadow: unpublished },
      }),
    );

    expectCircles(s.tokenOf, ["shadow-1", "shadow-2", "shadow-3", "shadow-4"]);
    expect(s.loads).toHaveLength(1);
    expect(s.fake.uploads()).toHaveLength(1);
    expect(s.searches).toEqual([UPLOAD_NAME]);
    expect(s.alive).toEqual([]);
    expect(s.reported).toEqual([]);

    // Without loadImage: circles, and neither an upload nor a picker.
    const bare = setup({ loadImage: null, pickImage: picked });
    const bareFeed = createMessageFeed();
    await bare.sync.handleMessage(
      bareFeed.snapshot([inst(1)], { art: { shadow: unpublished } }),
    );
    await bare.sync.handleMessage(
      bareFeed.event({ type: "added", instances: [inst(2)] }),
    );

    expectCircles(bare.tokenOf, ["shadow-1", "shadow-2"]);
    expect(bare.fake.uploads()).toEqual([]);
    expect(bare.fake.pickImageCalls()).toBe(0);
    expect(bare.alive).toEqual([]);
    expect(bare.reported).toEqual([]);
  });

  it("an upload error, a picker error or an invalid pick for art without a url creates the circle and is not asked again this session", async () => {
    const insecure: PublishedTokenArt = {
      ...picked,
      url: "http://insecure.example/shadow.png",
    };
    const cases = [
      {
        label: "upload error",
        uploadImage: () => Promise.reject(new Error("upload failed")),
        pickImage: picked as FakePick,
        picks: 0,
      },
      {
        label: "picker error",
        uploadImage: undefined,
        pickImage: (() =>
          Promise.reject(new Error("picker failed"))) as FakePick,
        picks: 1,
      },
      {
        label: "invalid pick",
        uploadImage: undefined,
        pickImage: insecure as FakePick,
        picks: 1,
      },
    ];
    for (const { label, uploadImage, pickImage, picks } of cases) {
      const feed = createMessageFeed();
      const s = setup({
        pickImage,
        ...(uploadImage === undefined ? {} : { uploadImage }),
      });

      await s.sync.handleMessage(
        feed.snapshot([inst(1)], { art: { shadow: unpublished } }),
      );
      expect(s.fake.uploads(), label).toHaveLength(1);
      expect(s.fake.pickImageCalls(), label).toBe(picks);
      expectCircles(s.tokenOf, ["shadow-1"]);
      expect(s.reported, label).toEqual([]);

      await s.sync.handleMessage(
        feed.event({ type: "added", instances: [inst(2)] }),
      );
      expectCircles(s.tokenOf, ["shadow-2"]);
      expect(s.fake.uploads(), label).toHaveLength(1);
      expect(s.fake.pickImageCalls(), label).toBe(picks);
      expect(s.loads, label).toHaveLength(1);
      expect(s.alive, label).toEqual([]);
      expect(s.reported, label).toEqual([]);
    }
  });

  it("a snapshot still carrying the art without a url after the pick keeps the picked art and asks nothing again", async () => {
    const feed = createMessageFeed();
    const s = setup({ pickImage: picked });

    await s.sync.handleMessage(
      feed.snapshot([inst(1)], { art: { shadow: unpublished } }),
    );
    expectImages(s.tokenOf, ["shadow-1"], picked);
    expect(s.reported).toHaveLength(1);

    // The reconnect's snapshot was built before the pick reached the store:
    // it still carries the art without a url.
    await s.sync.handleMessage(helloAck);
    await s.sync.handleMessage(
      feed.snapshot([inst(1), inst(2)], { art: { shadow: unpublished } }),
    );

    expectImages(s.tokenOf, ["shadow-1", "shadow-2"], picked);
    expect(s.loads).toHaveLength(1);
    expect(s.fake.uploads()).toHaveLength(1);
    expect(s.fake.pickImageCalls()).toBe(1);
    expect(s.alive).toEqual([]);
    expect(s.errors).toEqual([]);
  });
});
