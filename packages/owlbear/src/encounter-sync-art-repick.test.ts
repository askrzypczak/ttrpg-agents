import { describe, expect, it } from "vitest";
import type { PublishedTokenArt } from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import type {
  BridgeMessage,
  TokenImageUploadResponse,
} from "@ttrpg-agents/protocol";
import {
  createEncounterSync,
  type Reupload,
  type TypeArt,
} from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import type { Timers } from "./reconnecting-socket.js";
import { instanceIdOf, type EncounterInstance } from "./sync-plan.js";
import { createMessageFeed } from "./testing/messages.js";

const NAMES: Record<string, string> = {
  "dire-wolf": "Dire Wolf",
  goblin: "Goblin",
  shadow: "Shadow",
  orc: "Orc",
};

const inst = (n: number, monsterKey: string): EncounterInstance =>
  makeTestInstance({
    id: `${monsterKey}-${n}`,
    monsterKey,
    displayName: `${NAMES[monsterKey] ?? monsterKey} ${n}`,
    createdAt: n,
  });

/** Dire wolf art picked in an earlier session: a link with no stored bytes. */
const wolfArt: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/wolf.png",
  mime: "image/png",
  width: 200,
  height: 200,
};

const STORED_SHA = "c3".repeat(32);

/** Shadow art with stored bytes; the tests answer its url as gone. */
const storedShadowArt: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/shadow-old.png",
  mime: "image/png",
  width: 300,
  height: 280,
  sha256: STORED_SHA,
};

/** What the GM picks from the panel. */
const repicked: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/new-art.png",
  mime: "image/png",
  width: 256,
  height: 256,
};

/** An image the picker answers that is not usable art. */
const unusable: PublishedTokenArt = {
  url: "http://insecure.example/art.png",
  mime: "image/png",
  width: 0,
  height: 280,
};

const STORED_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7,
]);
const PICKED_SHA = "e5".repeat(32);

const storedAnswer: TokenImageUploadResponse = {
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
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Lets pending promise chains and timers queued by the sync run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/** What the picker does when opened: answer art, cancel, or throw. */
type Answer = () =>
  PublishedTokenArt | undefined | Promise<PublishedTokenArt | undefined>;

function setup(
  options: {
    /** Whether a stored image url answers. Default: alive. */
    imageAlive?: boolean;
    /** Passes a `storeImage` option answering this. Default: left out. */
    storeImage?: TokenImageUploadResponse;
    /** Whether a command goes out. Default: always. */
    connected?: () => boolean;
  } = {},
) {
  const searches: (string | undefined)[] = [];
  const fetched: string[] = [];
  const storedBytes: Uint8Array[] = [];
  const storeFailures: string[] = [];
  const reported: [string, PublishedTokenArt][] = [];
  const errors: unknown[] = [];
  const overrides: string[] = [];
  const reuploads: Reupload[][] = [];
  const typeArt: TypeArt[][] = [];
  // The picker cancels until a test sets an answer.
  let answer: Answer = () => undefined;
  const fake = createFakeObr(undefined, undefined, {
    imageAlive: options.imageAlive ?? true,
    pickImage: (search) => {
      searches.push(search);
      return answer();
    },
    fetchImage: (url) => {
      fetched.push(url);
      return STORED_BYTES.slice();
    },
  });
  const connected = options.connected ?? (() => true);
  const { storeImage } = options;
  const sync = createEncounterSync(
    fake.obr,
    (e) => errors.push(e),
    () => {},
    {
      timers: idleTimers,
      send: (message) => {
        if (!connected()) return false;
        if (message.type === "token-art-set")
          reported.push([message.payload.monsterKey, message.payload.art]);
        return true;
      },
      ...(storeImage === undefined
        ? {}
        : {
            storeImage: (bytes: Uint8Array) => {
              storedBytes.push(bytes);
              return Promise.resolve(storeImage);
            },
          }),
      loadImage: () =>
        Promise.resolve({ bytes: STORED_BYTES.slice(), mime: "image/png" }),
      onArtStoreFailed: (text) => storeFailures.push(text),
      onOverride: (text) => overrides.push(text),
      onReuploadsChange: (list) => reuploads.push(structuredClone(list)),
      onTypeArtChange: (list) => typeArt.push(structuredClone(list)),
    },
  );
  const tokenOf = (instanceId: string) =>
    fake.scene.getItems().find((item) => instanceIdOf(item) === instanceId);
  /** The Token art list as last reported; empty before any report. */
  const listed = () => typeArt.at(-1) ?? [];
  /** The state of one type in the Token art list as last reported. */
  const stateOf = (monsterKey: string) =>
    listed().find((row) => row.monsterKey === monsterKey)?.state;
  return {
    fake,
    sync,
    searches,
    fetched,
    storedBytes,
    storeFailures,
    reported,
    errors,
    overrides,
    reuploads,
    typeArt,
    listed,
    stateOf,
    tokenOf,
    answer: (next: Answer) => {
      answer = next;
    },
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

/** A sync whose goblin picker was cancelled and whose dire wolf has art. */
async function declinedGoblin(options: Parameters<typeof setup>[0] = {}) {
  const feed = createMessageFeed();
  const s = setup(options);
  await s.sync.handleMessage(
    feed.snapshot(
      [inst(1, "goblin"), inst(2, "goblin"), inst(1, "dire-wolf")],
      { art: { "dire-wolf": wolfArt } },
    ),
  );
  await settle();
  return { ...s, feed };
}

describe("createEncounterSync Token art list", () => {
  it("onTypeArtChange lists each monster type of the encounter once, in encounter order, named by monsterTypeName, with its art state: art, none, declined or reupload", async () => {
    const feed = createMessageFeed();
    const s = setup({ imageAlive: false });
    const goblinPick = deferred<PublishedTokenArt | undefined>();
    s.answer(() => goblinPick.promise);

    const applied = s.sync.handleMessage(
      feed.snapshot(
        [
          inst(1, "dire-wolf"),
          inst(1, "goblin"),
          inst(1, "shadow"),
          inst(2, "dire-wolf"),
        ],
        // The orc has art but no instance: it is not listed.
        {
          art: { "dire-wolf": wolfArt, shadow: storedShadowArt, orc: wolfArt },
        },
      ),
    );
    await settle();

    // The goblin's fresh picker is open.
    expect(s.listed()).toEqual([
      { monsterKey: "dire-wolf", monsterName: "Dire Wolf", state: "art" },
      { monsterKey: "goblin", monsterName: "Goblin", state: "none" },
      { monsterKey: "shadow", monsterName: "Shadow", state: "reupload" },
    ]);

    goblinPick.resolve(undefined);
    await applied;
    await settle();

    expect(s.listed()).toEqual([
      { monsterKey: "dire-wolf", monsterName: "Dire Wolf", state: "art" },
      { monsterKey: "goblin", monsterName: "Goblin", state: "declined" },
      { monsterKey: "shadow", monsterName: "Shadow", state: "reupload" },
    ]);
    // Reported only when the list changed.
    for (let i = 1; i < s.typeArt.length; i++)
      expect(s.typeArt[i], `report ${String(i)}`).not.toEqual(s.typeArt[i - 1]);
    expect(s.errors).toEqual([]);
  });

  it("a type whose fresh picker was cancelled, failed or returned an invalid image is listed as declined", async () => {
    const cases: { label: string; answer: Answer }[] = [
      { label: "cancelled pick", answer: () => undefined },
      {
        label: "picker error",
        answer: () => Promise.reject(new Error("picker failed")),
      },
      { label: "invalid pick", answer: () => structuredClone(unusable) },
    ];
    for (const { label, answer } of cases) {
      const s = setup();
      s.answer(answer);
      await s.sync.handleMessage(
        createMessageFeed().snapshot([inst(1, "goblin")]),
      );
      await settle();

      expect(s.fake.pickImageCalls(), label).toBe(1);
      expect(s.listed(), label).toEqual([
        { monsterKey: "goblin", monsterName: "Goblin", state: "declined" },
      ]);
      expectCircles(s.tokenOf, ["goblin-1"]);
      expect(s.errors, label).toEqual([]);
    }
  });
});

describe("createEncounterSync repickArt", () => {
  it("repickArt on a declined type opens the picker with no search; a valid pick becomes the type's art, is sent as a token-art-set, and replaces its circle tokens with image tokens, each with the re-skin replacement note", async () => {
    const s = await declinedGoblin();
    expectCircles(s.tokenOf, ["goblin-1", "goblin-2"]);
    const circleIds = [s.tokenOf("goblin-1")?.id, s.tokenOf("goblin-2")?.id];
    expect(s.searches).toEqual([undefined]);

    s.answer(() => structuredClone(repicked));
    await s.sync.repickArt("goblin");
    await settle();

    expect(s.searches).toEqual([undefined, undefined]);
    expect(s.reported).toEqual([["goblin", repicked]]);
    expectImages(s.tokenOf, ["goblin-1", "goblin-2"], repicked);
    expect(s.tokenOf("goblin-1")?.id).not.toBe(circleIds[0]);
    expect(s.tokenOf("goblin-2")?.id).not.toBe(circleIds[1]);
    expect(s.overrides).toEqual([
      "Goblin 1's token was replaced with a new one drawn with the art picked for its monster type; any attachments on the old token were deleted with it.",
      "Goblin 2's token was replaced with a new one drawn with the art picked for its monster type; any attachments on the old token were deleted with it.",
    ]);
    expect(s.stateOf("goblin")).toBe("art");
    expect(s.errors).toEqual([]);
  });

  it("repickArt on a type with art replaces its art: its image tokens are redrawn in place with the new pick, each listed under the overrides, and tokens created afterwards are drawn with it with no fresh picker", async () => {
    const feed = createMessageFeed();
    const s = setup();
    await s.sync.handleMessage(
      feed.snapshot([inst(1, "dire-wolf"), inst(2, "dire-wolf")], {
        art: { "dire-wolf": wolfArt },
      }),
    );
    await settle();
    expectImages(s.tokenOf, ["dire-wolf-1", "dire-wolf-2"], wolfArt);
    const ids = [s.tokenOf("dire-wolf-1")?.id, s.tokenOf("dire-wolf-2")?.id];
    expect(s.fake.pickImageCalls()).toBe(0);

    s.answer(() => structuredClone(repicked));
    await s.sync.repickArt("dire-wolf");
    await settle();

    expect(s.fake.pickImageCalls()).toBe(1);
    expect(s.reported).toEqual([["dire-wolf", repicked]]);
    expectImages(s.tokenOf, ["dire-wolf-1", "dire-wolf-2"], repicked);
    // Redrawn in place, at scale 1.
    expect(s.tokenOf("dire-wolf-1")?.id).toBe(ids[0]);
    expect(s.tokenOf("dire-wolf-2")?.id).toBe(ids[1]);
    for (const id of ["dire-wolf-1", "dire-wolf-2"])
      expect(s.tokenOf(id)?.scale ?? { x: 1, y: 1 }, id).toEqual({
        x: 1,
        y: 1,
      });
    expect(s.overrides).toEqual([
      "Dire Wolf 1's token was redrawn with the art picked for its monster type.",
      "Dire Wolf 2's token was redrawn with the art picked for its monster type.",
    ]);

    await s.sync.handleMessage(
      feed.event({ type: "added", instances: [inst(3, "dire-wolf")] }),
    );
    await settle();

    expectImages(s.tokenOf, ["dire-wolf-3"], repicked);
    expect(s.fake.pickImageCalls()).toBe(1);
    expect(s.stateOf("dire-wolf")).toBe("art");
    expect(s.errors).toEqual([]);
  });

  it("repickArt on a type listed for re-upload replaces its stored art with the pick, stores the pick's bytes, and takes the type off the re-upload list", async () => {
    const feed = createMessageFeed();
    const s = setup({ imageAlive: false, storeImage: storedAnswer });
    await s.sync.handleMessage(
      feed.snapshot([inst(1, "shadow"), inst(2, "shadow")], {
        art: { shadow: storedShadowArt },
      }),
    );
    await settle();
    expect(s.reuploads.at(-1)?.map((row) => row.monsterKey)).toEqual([
      "shadow",
    ]);
    expect(s.stateOf("shadow")).toBe("reupload");
    expectCircles(s.tokenOf, ["shadow-1", "shadow-2"]);

    s.answer(() => structuredClone(repicked));
    await s.sync.repickArt("shadow");
    await settle();

    // No asset search: this is not the re-uploaded image.
    expect(s.searches).toEqual([undefined]);
    expect(s.fake.uploads()).toEqual([]);
    expect(s.fetched).toEqual([repicked.url]);
    expect(s.storedBytes).toHaveLength(1);
    // The pick's own hash, not the old stored one.
    expect(s.reported).toEqual([
      ["shadow", repicked],
      ["shadow", { ...repicked, sha256: PICKED_SHA }],
    ]);
    expect(s.reuploads.at(-1)).toEqual([]);
    expect(s.sync.artWaits()).toEqual([]);
    expect(s.stateOf("shadow")).toBe("art");
    expectImages(s.tokenOf, ["shadow-1", "shadow-2"], repicked);
    expect(s.errors).toEqual([]);
  });

  it("the bytes of a re-picked image are stored as after a fresh pick, and the art is sent again with their hash", async () => {
    const s = await declinedGoblin({ storeImage: storedAnswer });
    // The dire wolf's link art is stored once on its own.
    const fetchedBefore = s.fetched.length;
    const storedBefore = s.storedBytes.length;
    const reportedBefore = s.reported.length;

    s.answer(() => structuredClone(repicked));
    await s.sync.repickArt("goblin");
    await settle();

    expect(s.fetched.slice(fetchedBefore)).toEqual([repicked.url]);
    expect(s.storedBytes.slice(storedBefore)).toHaveLength(1);
    expect([...(s.storedBytes.at(-1) ?? [])]).toEqual([...STORED_BYTES]);
    expect(s.reported.slice(reportedBefore)).toEqual([
      ["goblin", repicked],
      ["goblin", { ...repicked, sha256: PICKED_SHA }],
    ]);
    expect(s.storeFailures).toEqual([]);

    // A refused store is reported once and the art stays a link.
    const refused = await declinedGoblin({
      storeImage: {
        ok: false,
        error: { code: "svg", message: "SVG images are not accepted" },
      },
    });
    const failuresBefore = refused.storeFailures.length;
    const sentBefore = refused.reported.length;
    refused.answer(() => structuredClone(repicked));
    await refused.sync.repickArt("goblin");
    await settle();

    expect(refused.storeFailures.slice(failuresBefore)).toHaveLength(1);
    expect(refused.reported.slice(sentBefore)).toEqual([["goblin", repicked]]);
    expectImages(refused.tokenOf, ["goblin-1", "goblin-2"], repicked);
    expect(s.errors).toEqual([]);
  });

  it("a stale snapshot after a re-pick keeps the re-picked art for the type", async () => {
    // The socket is down until the hello-ack, so the re-picked art waits.
    let connected = false;
    const feed = createMessageFeed();
    const s = setup({ connected: () => connected });
    await s.sync.handleMessage(
      feed.snapshot([inst(1, "dire-wolf")], { art: { "dire-wolf": wolfArt } }),
    );
    await settle();

    s.answer(() => structuredClone(repicked));
    await s.sync.repickArt("dire-wolf");
    await settle();
    expectImages(s.tokenOf, ["dire-wolf-1"], repicked);
    expect(s.reported).toEqual([]);

    // The reconnect's snapshot was built before the pick reached the store:
    // it still carries the old art.
    connected = true;
    await s.sync.handleMessage(helloAck);
    expect(s.reported).toEqual([["dire-wolf", repicked]]);
    await s.sync.handleMessage(
      feed.snapshot([inst(1, "dire-wolf"), inst(2, "dire-wolf")], {
        art: { "dire-wolf": wolfArt },
      }),
    );
    await settle();

    expectImages(s.tokenOf, ["dire-wolf-1", "dire-wolf-2"], repicked);
    expect(s.fake.pickImageCalls()).toBe(1);
    expect(s.errors).toEqual([]);
  });

  it("a cancelled, failed or invalid re-pick leaves the type's art state and tokens as they were, and a later press opens the picker again", async () => {
    const cases: { label: string; answer: Answer }[] = [
      { label: "cancelled pick", answer: () => undefined },
      {
        label: "picker error",
        answer: () => Promise.reject(new Error("picker failed")),
      },
      { label: "invalid pick", answer: () => structuredClone(unusable) },
    ];
    for (const { label, answer } of cases) {
      const s = await declinedGoblin();
      const before = s.listed();
      expect(
        before.map((row) => row.state),
        label,
      ).toEqual(["declined", "art"]);
      const tokensBefore = structuredClone(s.fake.scene.getItems());
      const reports = s.typeArt.length;
      const picks = s.fake.pickImageCalls();

      s.answer(answer);
      await expect(s.sync.repickArt("goblin"), label).resolves.toBe(undefined);
      await expect(s.sync.repickArt("dire-wolf"), label).resolves.toBe(
        undefined,
      );
      await settle();

      expect(s.fake.pickImageCalls(), label).toBe(picks + 2);
      expect(s.typeArt.length, label).toBe(reports);
      expect(s.listed(), label).toEqual(before);
      expect(s.fake.scene.getItems(), label).toEqual(tokensBefore);
      expect(s.reported, label).toEqual([]);
      expect(s.overrides, label).toEqual([]);
      expect(s.errors, label).toEqual([]);

      // The GM can press again.
      await s.sync.repickArt("goblin");
      expect(s.fake.pickImageCalls(), label).toBe(picks + 3);
    }
  });

  it("neither a type offered again in the Token art list nor an open re-pick picker adds an art wait", async () => {
    const s = await declinedGoblin();
    expect(s.stateOf("goblin")).toBe("declined");
    expect(s.sync.artWaits()).toEqual([]);

    const pick = deferred<PublishedTokenArt | undefined>();
    s.answer(() => pick.promise);
    const repick = s.sync.repickArt("goblin");
    await settle();
    expect(s.fake.pickImageCalls()).toBe(2);
    expect(s.sync.artWaits()).toEqual([]);

    pick.resolve(undefined);
    await repick;
    expect(s.sync.artWaits()).toEqual([]);
    expect(s.errors).toEqual([]);
  });

  it("a press of Pick art is ignored for a type whose pick is still running, whose fresh picker is open or queued in a reconcile, or that is not in the Token art list", async () => {
    // A pick still running.
    const running = await declinedGoblin();
    const pick = deferred<PublishedTokenArt | undefined>();
    running.answer(() => pick.promise);
    const first = running.sync.repickArt("goblin");
    await settle();
    expect(running.fake.pickImageCalls()).toBe(2);
    await running.sync.repickArt("goblin");
    expect(running.fake.pickImageCalls()).toBe(2);
    pick.resolve(undefined);
    await first;
    // Once it ended, a press opens the picker again.
    running.answer(() => undefined);
    await running.sync.repickArt("goblin");
    expect(running.fake.pickImageCalls()).toBe(3);

    // A fresh picker open (goblin) or queued (orc) in a reconcile.
    const feed = createMessageFeed();
    const fresh = setup();
    const freshPick = deferred<PublishedTokenArt | undefined>();
    let opened = 0;
    fresh.answer(() => (opened++ === 0 ? freshPick.promise : undefined));
    const applied = fresh.sync.handleMessage(
      feed.snapshot([inst(1, "goblin"), inst(1, "orc")]),
    );
    await settle();
    expect(fresh.fake.pickImageCalls()).toBe(1);
    expect(fresh.listed().map((row) => row.monsterKey)).toEqual([
      "goblin",
      "orc",
    ]);
    await fresh.sync.repickArt("goblin");
    await fresh.sync.repickArt("orc");
    expect(fresh.fake.pickImageCalls()).toBe(1);
    freshPick.resolve(undefined);
    await applied;
    await settle();
    // The orc's own fresh picker ran after the goblin's.
    expect(fresh.fake.pickImageCalls()).toBe(2);

    // Not in the list: no instance in the encounter, or unknown.
    const absent = await declinedGoblin();
    const before = absent.fake.pickImageCalls();
    await absent.sync.repickArt("orc");
    await absent.sync.repickArt("dragon");
    expect(absent.fake.pickImageCalls()).toBe(before);
    expect(absent.reported).toEqual([]);
    expect(running.errors).toEqual([]);
    expect(fresh.errors).toEqual([]);
  });

  it("a valid re-pick that resolves after the type left the encounter still becomes its art", async () => {
    const feed = createMessageFeed();
    const s = setup();
    await s.sync.handleMessage(
      feed.snapshot([inst(1, "dire-wolf"), inst(1, "goblin")], {
        art: { "dire-wolf": wolfArt },
      }),
    );
    await settle();

    const pick = deferred<PublishedTokenArt | undefined>();
    s.answer(() => pick.promise);
    const repick = s.sync.repickArt("dire-wolf");
    await settle();
    expect(s.fake.pickImageCalls()).toBe(2);

    await s.sync.handleMessage(
      feed.event({ type: "removed", id: "dire-wolf-1" }),
    );
    expect(s.listed().map((row) => row.monsterKey)).toEqual(["goblin"]);
    pick.resolve(structuredClone(repicked));
    await repick;
    await settle();

    expect(s.reported).toEqual([["dire-wolf", repicked]]);

    await s.sync.handleMessage(
      feed.event({ type: "added", instances: [inst(2, "dire-wolf")] }),
    );
    await settle();

    expectImages(s.tokenOf, ["dire-wolf-2"], repicked);
    expect(s.fake.pickImageCalls()).toBe(2);
    expect(s.errors).toEqual([]);
  });
});
