import { describe, expect, it, vi } from "vitest";
import type { PublishedTokenArt } from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import type {
  BridgeMessage,
  TokenImageUploadResponse,
} from "@ttrpg-agents/protocol";
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
/** The asset name the stored shadow image is uploaded again under. */
const REPUBLISH_NAME = `ttrpg-art-${"c3".repeat(8)}`;

/** Shadow art with stored bytes; whether its url is alive is up to each test. */
const storedArt: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/shadow-old.png",
  mime: "image/png",
  width: 300,
  height: 280,
  sha256: STORED_SHA,
};

const goblinArt: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/goblin.png",
  mime: "image/png",
  width: 200,
  height: 200,
  sha256: "d4".repeat(32),
};

/** What the GM picks after the upload: the new asset. */
const republished: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/ttrpg-art-c3c3c3c3c3c3c3c3.png",
  mime: "image/png",
  width: 300,
  height: 280,
};

/** An art pick for a type that had none. */
const pickedArt: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/shadow-new.png",
  mime: "image/png",
  width: 256,
  height: 256,
};

const STORED_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7,
]);
const PICKED_SHA = "e5".repeat(32);

const stored: TokenImageUploadResponse = {
  ok: true,
  image: { sha256: PICKED_SHA, mime: "image/png", width: 256, height: 256 },
};

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
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets pending promise chains and timers queued by the sync run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function setup(
  options: {
    imageAlive?: boolean | ((url: string) => boolean | Promise<boolean>);
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
  const failures: string[] = [];
  const fetched: string[] = [];
  const storedBytes: Uint8Array[] = [];
  const reported: [string, PublishedTokenArt][] = [];
  const errors: unknown[] = [];
  const answerAlive = options.imageAlive ?? true;
  const pick = options.pickImage;
  const fake = createFakeObr(undefined, undefined, {
    imageAlive: (url) => {
      alive.push(url);
      return typeof answerAlive === "function" ? answerAlive(url) : answerAlive;
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
        return Promise.resolve(stored);
      },
      ...(loadImage === undefined ? {} : { loadImage }),
      awaitUploadConfirmed: (prompt) => {
        prompts.push(prompt);
        return confirm === undefined ? Promise.resolve() : confirm(prompt);
      },
      onArtRepublishFailed: (text) => failures.push(text),
    },
  );
  const tokenOf = (instanceId: string) =>
    fake.scene.getItems().find((item) => instanceIdOf(item) === instanceId);
  const tokens = () =>
    fake.scene.getItems().filter((item) => !!instanceIdOf(item));
  return {
    fake,
    sync,
    alive,
    searches,
    loads,
    prompts,
    failures,
    fetched,
    storedBytes,
    reported,
    errors,
    tokenOf,
    tokens,
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

describe("createEncounterSync token art republish: live urls", () => {
  it("a type whose stored art has a hash and a live url gets image tokens with no upload and no picker", async () => {
    const feed = createMessageFeed();
    const s = setup({ imageAlive: true });

    await s.sync.handleMessage(
      feed.snapshot([inst(1), inst(2)], { art: { shadow: storedArt } }),
    );

    expect(s.alive).toEqual([storedArt.url]);
    expectImages(s.tokenOf, ["shadow-1", "shadow-2"], storedArt);
    expect(s.fake.uploads()).toEqual([]);
    expect(s.fake.pickImageCalls()).toBe(0);
    expect(s.loads).toEqual([]);
    expect(s.prompts).toEqual([]);
    expect(s.reported).toEqual([]);
    expect(s.errors).toEqual([]);
  });

  it("the liveness check runs once per type per session", async () => {
    const feed = createMessageFeed();
    const s = setup({ imageAlive: true });
    const art = { shadow: storedArt, goblin: goblinArt };

    await s.sync.handleMessage(
      feed.snapshot([inst(1), inst(1, "goblin")], { art }),
    );
    await s.sync.handleMessage(
      feed.event({ type: "added", instances: [inst(2), inst(2, "goblin")] }),
    );
    await s.sync.handleMessage(helloAck);
    await s.sync.handleMessage(
      feed.snapshot(
        [inst(1), inst(2), inst(3), inst(1, "goblin"), inst(2, "goblin")],
        { art },
      ),
    );

    expect([...s.alive].sort()).toEqual([goblinArt.url, storedArt.url].sort());
    expectImages(s.tokenOf, ["shadow-1", "shadow-2", "shadow-3"], storedArt);
    expectImages(s.tokenOf, ["goblin-1", "goblin-2"], goblinArt);
  });

  it("a type picked this session is not checked", async () => {
    const feed = createMessageFeed();
    const s = setup({ imageAlive: true, pickImage: pickedArt });

    // No art yet: the GM picks one, and its bytes get a hash.
    await s.sync.handleMessage(feed.snapshot([inst(1)]));
    await vi.waitFor(() => expect(s.reported).toHaveLength(2));
    expect(s.reported[1]).toEqual([
      "shadow",
      { ...pickedArt, sha256: PICKED_SHA },
    ]);

    // A later snapshot carries the picked art with its hash, and a goblin
    // with stored art; both types get new tokens.
    await s.sync.handleMessage(helloAck);
    await s.sync.handleMessage(
      feed.snapshot([inst(1), inst(2), inst(1, "goblin")], {
        art: {
          shadow: { ...pickedArt, sha256: PICKED_SHA },
          goblin: goblinArt,
        },
      }),
    );

    expect(s.alive).toEqual([goblinArt.url]);
    expect(s.fake.pickImageCalls()).toBe(1);
    expectImages(s.tokenOf, ["shadow-1", "shadow-2"], pickedArt);
    expectImages(s.tokenOf, ["goblin-1"], goblinArt);
  });

  it("a liveness check that cannot tell uses the stored art with no dialogs", async () => {
    const feed = createMessageFeed();
    const s = setup({
      imageAlive: () => Promise.reject(new TypeError("Failed to fetch")),
    });

    await s.sync.handleMessage(
      feed.snapshot([inst(1), inst(2)], { art: { shadow: storedArt } }),
    );

    expect(s.alive).toEqual([storedArt.url]);
    expectImages(s.tokenOf, ["shadow-1", "shadow-2"], storedArt);
    expect(s.loads).toEqual([]);
    expect(s.fake.uploads()).toEqual([]);
    expect(s.prompts).toEqual([]);
    expect(s.fake.pickImageCalls()).toBe(0);
    expect(s.reported).toEqual([]);
    expect(s.failures).toEqual([]);
    expect(s.errors).toEqual([]);
  });

  it("art without a hash is not republished: a dead url draws it as stored with no load, upload or picker", async () => {
    const feed = createMessageFeed();
    const linkOnly = pictureOf(storedArt);
    const s = setup({ imageAlive: false });

    await s.sync.handleMessage(
      feed.snapshot([inst(1), inst(1, "goblin")], {
        art: { shadow: linkOnly, goblin: goblinArt },
      }),
    );

    // Both urls are checked; the link-only one is not republished.
    await vi.waitFor(() =>
      expect([...s.alive].sort()).toEqual([goblinArt.url, linkOnly.url].sort()),
    );
    await settle();
    expectImages(s.tokenOf, ["shadow-1"], linkOnly);
    expect(s.fake.uploads().map((u) => u.name)).not.toContain(REPUBLISH_NAME);
    expect(s.loads).not.toContain(STORED_SHA);
    // The picker opens only for the goblin's republish, never for the shadow.
    expect(s.searches).toEqual([`ttrpg-art-${"d4".repeat(8)}`]);
    expect(s.fake.pickImageCalls()).toBe(1);
  });

  it("without loadImage stored art is used as stored with no liveness check", async () => {
    const without = setup({ loadImage: null, imageAlive: false });
    await without.sync.handleMessage(
      createMessageFeed().snapshot([inst(1)], { art: { shadow: storedArt } }),
    );

    expect(without.alive).toEqual([]);
    expectImages(without.tokenOf, ["shadow-1"], storedArt);
    expect(without.fake.uploads()).toEqual([]);
    expect(without.fake.pickImageCalls()).toBe(0);
    expect(without.reported).toEqual([]);

    // Control: with loadImage, the same art is checked.
    const withLoad = setup({ imageAlive: true });
    await withLoad.sync.handleMessage(
      createMessageFeed().snapshot([inst(1)], { art: { shadow: storedArt } }),
    );
    expect(withLoad.alive).toEqual([storedArt.url]);
  });
});

describe("createEncounterSync token art republish: dead urls", () => {
  it("a dead url with stored bytes uploads them under the hash-derived name, waits for the GM, then opens the picker with that name as the default search", async () => {
    const feed = createMessageFeed();
    const confirmed = deferred<void>();
    const s = setup({
      imageAlive: false,
      pickImage: republished,
      awaitUploadConfirmed: () => confirmed.promise,
    });

    const applied = s.sync.handleMessage(
      feed.snapshot([inst(1), inst(2)], { art: { shadow: storedArt } }),
    );

    await vi.waitFor(() => expect(s.prompts).toHaveLength(1));
    expect(s.alive).toEqual([storedArt.url]);
    expect(s.loads).toEqual([STORED_SHA]);
    const uploads = s.fake.uploads();
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.name).toBe(REPUBLISH_NAME);
    expect(uploads[0]?.mime).toBe("image/png");
    expect([...(uploads[0]?.bytes ?? [])]).toEqual([...STORED_BYTES]);
    expect(s.prompts[0]).toContain("shadow");
    expect(s.prompts[0]).toContain(REPUBLISH_NAME);

    // The GM has not confirmed yet: no picker.
    await settle();
    expect(s.fake.pickImageCalls()).toBe(0);

    confirmed.resolve();
    await applied;
    expect(s.searches).toEqual([REPUBLISH_NAME]);
    expect(s.fake.uploads()).toHaveLength(1);
  });

  it("the republished pick becomes the type's art with the existing sha256, is sent as one token-art-set and draws the new tokens", async () => {
    const feed = createMessageFeed();
    const s = setup({ imageAlive: false, pickImage: republished });

    await s.sync.handleMessage(
      feed.snapshot([inst(1), inst(2)], { art: { shadow: storedArt } }),
    );

    expect(s.reported).toEqual([
      ["shadow", { ...republished, sha256: STORED_SHA }],
    ]);
    expectImages(s.tokenOf, ["shadow-1", "shadow-2"], republished);

    // A later token of the type is drawn with the new art, with no new dialog.
    await s.sync.handleMessage(
      feed.event({ type: "added", instances: [inst(3)] }),
    );
    expectImages(s.tokenOf, ["shadow-3"], republished);
    expect(s.reported).toHaveLength(1);
    expect(s.fake.uploads()).toHaveLength(1);
    expect(s.fake.pickImageCalls()).toBe(1);
    expect(s.errors).toEqual([]);
  });

  it("the republished pick's image is not fetched or uploaded to the bridge", async () => {
    const feed = createMessageFeed();
    const s = setup({ imageAlive: false, pickImage: republished });

    await s.sync.handleMessage(
      feed.snapshot([inst(1)], { art: { shadow: storedArt } }),
    );
    await vi.waitFor(() => expect(s.reported).toHaveLength(1));
    await settle();

    expect(s.fetched).toEqual([]);
    expect(s.storedBytes).toEqual([]);
    expect(s.reported).toEqual([
      ["shadow", { ...republished, sha256: STORED_SHA }],
    ]);
  });

  it("a cancelled pick after the upload leaves the art unchanged, creates the circle and is not asked again this session", async () => {
    const feed = createMessageFeed();
    const s = setup({ imageAlive: false, pickImage: undefined });

    await s.sync.handleMessage(
      feed.snapshot([inst(1), inst(2)], { art: { shadow: storedArt } }),
    );

    expect(s.fake.uploads()).toHaveLength(1);
    expect(s.fake.pickImageCalls()).toBe(1);
    expectCircles(s.tokenOf, ["shadow-1", "shadow-2"]);
    expect(s.reported).toEqual([]);
    expect(s.failures).toEqual([]);

    // Later reconciles: a new instance, then a reconnect with its snapshot.
    await s.sync.handleMessage(
      feed.event({ type: "added", instances: [inst(3)] }),
    );
    await s.sync.handleMessage(helloAck);
    await s.sync.handleMessage(
      feed.snapshot([inst(1), inst(2), inst(3), inst(4)], {
        art: { shadow: storedArt },
      }),
    );

    expectCircles(s.tokenOf, ["shadow-1", "shadow-2", "shadow-3", "shadow-4"]);
    expect(s.alive).toHaveLength(1);
    expect(s.loads).toHaveLength(1);
    expect(s.fake.uploads()).toHaveLength(1);
    expect(s.fake.pickImageCalls()).toBe(1);
    expect(s.reported).toEqual([]);
    expect(s.failures).toEqual([]);
  });

  it("an upload error or a picker error creates the circle and is not asked again this session", async () => {
    const cases = [
      {
        label: "upload error",
        uploadImage: () => Promise.reject(new Error("upload failed")),
        pickImage: republished as FakePick,
        picks: 0,
      },
      {
        label: "picker error",
        uploadImage: undefined,
        pickImage: (() =>
          Promise.reject(new Error("picker failed"))) as FakePick,
        picks: 1,
      },
    ];
    for (const { label, uploadImage, pickImage, picks } of cases) {
      const feed = createMessageFeed();
      const s = setup({
        imageAlive: false,
        pickImage,
        ...(uploadImage === undefined ? {} : { uploadImage }),
      });

      await s.sync.handleMessage(
        feed.snapshot([inst(1)], { art: { shadow: storedArt } }),
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
      expect(s.reported, label).toEqual([]);
    }
  });

  it("a republished pick that fails validation creates the circle and is not asked again this session", async () => {
    const feed = createMessageFeed();
    const unusable: PublishedTokenArt = {
      url: "http://insecure.example/shadow.png",
      mime: "image/png",
      width: 0,
      height: 280,
    };
    const s = setup({ imageAlive: false, pickImage: unusable });

    await s.sync.handleMessage(
      feed.snapshot([inst(1)], { art: { shadow: storedArt } }),
    );
    expect(s.fake.uploads()).toHaveLength(1);
    expect(s.fake.pickImageCalls()).toBe(1);
    expectCircles(s.tokenOf, ["shadow-1"]);
    expect(s.reported).toEqual([]);

    await s.sync.handleMessage(
      feed.event({ type: "added", instances: [inst(2)] }),
    );
    expectCircles(s.tokenOf, ["shadow-2"]);
    expect(s.fake.uploads()).toHaveLength(1);
    expect(s.fake.pickImageCalls()).toBe(1);
    expect(s.reported).toEqual([]);
  });

  it("a snapshot bringing back the dead art keeps the type a circle this session", async () => {
    const feed = createMessageFeed();
    const s = setup({ imageAlive: false, pickImage: undefined });

    await s.sync.handleMessage(
      feed.snapshot([inst(1)], { art: { shadow: storedArt } }),
    );
    expectCircles(s.tokenOf, ["shadow-1"]);

    // The store still holds the dead art and sends it again.
    await s.sync.handleMessage(helloAck);
    await s.sync.handleMessage(
      feed.snapshot([inst(1), inst(2)], { art: { shadow: storedArt } }),
    );
    await s.sync.handleMessage(
      feed.snapshot([inst(1), inst(2), inst(3)], {
        art: { shadow: storedArt },
      }),
    );

    expectCircles(s.tokenOf, ["shadow-1", "shadow-2", "shadow-3"]);
    expect(s.tokens()).toHaveLength(3);
    expect(s.alive).toHaveLength(1);
    expect(s.fake.uploads()).toHaveLength(1);
    expect(s.fake.pickImageCalls()).toBe(1);
  });
});

describe("createEncounterSync token art republish: stored bytes that cannot be loaded", () => {
  const reason = "no token image with that hash";

  it("stored bytes that cannot be loaded create the circle and are not asked again this session", async () => {
    const feed = createMessageFeed();
    const s = setup({
      imageAlive: false,
      pickImage: republished,
      loadImage: () => Promise.reject(new Error(reason)),
    });

    await s.sync.handleMessage(
      feed.snapshot([inst(1), inst(2)], { art: { shadow: storedArt } }),
    );

    expect(s.loads).toEqual([STORED_SHA]);
    expectCircles(s.tokenOf, ["shadow-1", "shadow-2"]);
    expect(s.fake.uploads()).toEqual([]);
    expect(s.prompts).toEqual([]);
    expect(s.fake.pickImageCalls()).toBe(0);
    expect(s.reported).toEqual([]);

    await s.sync.handleMessage(
      feed.event({ type: "added", instances: [inst(3)] }),
    );
    await s.sync.handleMessage(helloAck);
    await s.sync.handleMessage(
      feed.snapshot([inst(1), inst(2), inst(3), inst(4)], {
        art: { shadow: storedArt },
      }),
    );

    expectCircles(s.tokenOf, ["shadow-3", "shadow-4"]);
    expect(s.alive).toHaveLength(1);
    expect(s.loads).toHaveLength(1);
    expect(s.fake.uploads()).toEqual([]);
    expect(s.fake.pickImageCalls()).toBe(0);
  });

  it("stored bytes that cannot be loaded are reported through onArtRepublishFailed", async () => {
    const feed = createMessageFeed();
    const s = setup({
      imageAlive: false,
      pickImage: republished,
      loadImage: () => Promise.reject(new Error(reason)),
    });

    await s.sync.handleMessage(
      feed.snapshot([inst(1)], { art: { shadow: storedArt } }),
    );
    expect(s.failures).toEqual([
      `Could not republish the token art for shadow: ${reason}`,
    ]);

    // Not reported again by later reconciles.
    await s.sync.handleMessage(
      feed.event({ type: "added", instances: [inst(2)] }),
    );
    expect(s.failures).toHaveLength(1);
    expect(s.errors).toEqual([]);
  });
});

describe("createEncounterSync token art republish: snapshots after the pick", () => {
  it("a stale snapshot after a republish keeps the republished art", async () => {
    const feed = createMessageFeed();
    const alive: string[] = [];
    const fake = createFakeObr(undefined, undefined, {
      imageAlive: (url) => {
        alive.push(url);
        return false;
      },
      pickImage: republished,
    });
    // The socket is down until the hello-ack, so the re-picked art waits.
    let connected = false;
    const reported: [string, PublishedTokenArt][] = [];
    const errors: unknown[] = [];
    const sync = createEncounterSync(
      fake.obr,
      (e) => errors.push(e),
      () => {},
      {
        timers: idleTimers,
        send: (message) => {
          if (!connected) return false;
          if (message.type === "token-art-set")
            reported.push([message.payload.monsterKey, message.payload.art]);
          return true;
        },
        loadImage: () =>
          Promise.resolve({ bytes: STORED_BYTES.slice(), mime: "image/png" }),
      },
    );
    const tokenOf = (instanceId: string) =>
      fake.scene.getItems().find((item) => instanceIdOf(item) === instanceId);

    await sync.handleMessage(
      feed.snapshot([inst(1)], { art: { shadow: storedArt } }),
    );
    expectImages(tokenOf, ["shadow-1"], republished);
    expect(reported).toEqual([]);

    // The reconnect's snapshot was built before the queued pick reached the
    // store: it still carries the dead art.
    connected = true;
    await sync.handleMessage(helloAck);
    expect(reported).toEqual([
      ["shadow", { ...republished, sha256: STORED_SHA }],
    ]);
    await sync.handleMessage(
      feed.snapshot([inst(1), inst(2)], { art: { shadow: storedArt } }),
    );

    expectImages(tokenOf, ["shadow-1", "shadow-2"], republished);
    expect(alive).toEqual([storedArt.url]);
    expect(fake.uploads()).toHaveLength(1);
    expect(fake.pickImageCalls()).toBe(1);
    expect(errors).toEqual([]);
  });
});
