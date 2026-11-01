import { describe, expect, it } from "vitest";
import type { PublishedTokenArt } from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import type { TokenImageUploadResponse } from "@ttrpg-agents/protocol";
import { createEncounterSync, type TypeArt } from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import type { ImageUpload } from "./obr-adapter.js";
import { describeError } from "./panel-state.js";
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

/** The bytes of the image file the GM chooses: "abc". */
const FILE_BYTES = [0x61, 0x62, 0x63];
/** `ttrpg-art-` and the first 16 hex characters of SHA-256("abc"). */
const UPLOAD_NAME = "ttrpg-art-ba7816bf8f01cfea";

/** An image file chosen in the panel. */
const imageFile = () =>
  new Blob([new Uint8Array(FILE_BYTES)], { type: "image/png" });

/** A file whose bytes cannot be read. */
const unreadableFile = () =>
  ({
    type: "image/png",
    size: 3,
    arrayBuffer: () => Promise.reject(new Error("file unreadable")),
  }) as unknown as Blob;

/** Dire wolf art picked in an earlier session: a link with no stored bytes. */
const wolfArt: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/wolf.png",
  mime: "image/png",
  width: 200,
  height: 200,
};

/** Shadow art with stored bytes; the tests answer its url as gone. */
const storedShadowArt: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/shadow-old.png",
  mime: "image/png",
  width: 300,
  height: 280,
  sha256: "c3".repeat(32),
};

/** What the GM picks: the uploaded image. */
const uploadedArt: PublishedTokenArt = {
  url: `https://cdn.owlbear.rodeo/assets/${UPLOAD_NAME}.png`,
  mime: "image/png",
  width: 256,
  height: 256,
};

/** A Pick art choice other than the upload. */
const otherArt: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/other.png",
  mime: "image/png",
  width: 128,
  height: 128,
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

/** Marks a call the test awaits later as handled, so an early rejection is not reported twice. */
function later<T>(promise: Promise<T>): Promise<T> {
  void promise.catch(() => {});
  return promise;
}

/** What the picker does when opened: answer art, cancel, or throw. */
type Answer = () =>
  PublishedTokenArt | undefined | Promise<PublishedTokenArt | undefined>;

/** What the asset upload does: resolve, reject, or wait. */
type UploadAnswer = (image: ImageUpload) => void | Promise<void>;

function setup(
  options: {
    /** Whether a stored image url answers. Default: alive. */
    imageAlive?: boolean;
    /** Passes a `storeImage` option answering this. Default: left out. */
    storeImage?: TokenImageUploadResponse;
  } = {},
) {
  const searches: (string | undefined)[] = [];
  const fetched: string[] = [];
  const storedBytes: Uint8Array[] = [];
  const failures: string[] = [];
  const reported: [string, PublishedTokenArt][] = [];
  const errors: unknown[] = [];
  const overrides: string[] = [];
  const typeArt: TypeArt[][] = [];
  // The picker cancels until a test sets an answer.
  let answer: Answer = () => undefined;
  // The upload resolves until a test sets an answer.
  let uploadAnswer: UploadAnswer = () => {};
  const fake = createFakeObr(undefined, undefined, {
    imageAlive: options.imageAlive ?? true,
    pickImage: (search) => {
      searches.push(search);
      return answer();
    },
    uploadImage: (image) => uploadAnswer(image),
    fetchImage: (url) => {
      fetched.push(url);
      return STORED_BYTES.slice();
    },
  });
  const { storeImage } = options;
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
      onArtRepublishFailed: (text) => failures.push(text),
      onOverride: (text) => overrides.push(text),
      onTypeArtChange: (list) => typeArt.push(structuredClone(list)),
    },
  );
  const tokenOf = (instanceId: string) =>
    fake.scene.getItems().find((item) => instanceIdOf(item) === instanceId);
  /** The Token art list as last reported; empty before any report. */
  const listed = () => typeArt.at(-1) ?? [];
  /** One type's row in the Token art list as last reported. */
  const rowOf = (monsterKey: string) =>
    listed().find((row) => row.monsterKey === monsterKey);
  return {
    fake,
    sync,
    searches,
    fetched,
    storedBytes,
    failures,
    reported,
    errors,
    overrides,
    typeArt,
    listed,
    rowOf,
    tokenOf,
    answer: (next: Answer) => {
      answer = next;
    },
    uploadAnswer: (next: UploadAnswer) => {
      uploadAnswer = next;
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

/** What an upload handed to Owlbear, with its bytes as a plain array. */
const uploadOf = ({ bytes, mime, name }: ImageUpload) => ({
  bytes: [...bytes],
  mime,
  name,
});

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

describe("createEncounterSync uploadArtFile", () => {
  it("uploadArtFile uploads the file's bytes and type to the GM's Owlbear library under ttrpg-art- and the first 16 hex characters of their SHA-256, for a type in each Token art state, and opens no picker", async () => {
    // Declined, has art and listed for re-upload.
    const s = setup({ imageAlive: false });
    await s.sync.handleMessage(
      createMessageFeed().snapshot(
        [inst(1, "goblin"), inst(1, "dire-wolf"), inst(1, "shadow")],
        { art: { "dire-wolf": wolfArt, shadow: storedShadowArt } },
      ),
    );
    await settle();
    expect(s.listed().map((row) => row.state)).toEqual([
      "declined",
      "art",
      "reupload",
    ]);
    const picks = s.fake.pickImageCalls();

    for (const monsterKey of ["goblin", "dire-wolf", "shadow"])
      await s.sync.uploadArtFile(monsterKey, imageFile());
    await settle();

    const expected = {
      bytes: FILE_BYTES,
      mime: "image/png",
      name: UPLOAD_NAME,
    };
    expect(s.fake.uploads().map(uploadOf)).toEqual([
      expected,
      expected,
      expected,
    ]);
    expect(s.fake.pickImageCalls()).toBe(picks);

    // No art yet: the scene is not ready, so no fresh picker has opened.
    const none = setup();
    none.fake.scene.setReady(false);
    await none.sync.handleMessage(
      createMessageFeed().snapshot([inst(1, "orc")]),
    );
    await settle();
    expect(none.rowOf("orc")?.state).toBe("none");

    await none.sync.uploadArtFile("orc", imageFile());
    await settle();

    expect(none.fake.uploads().map(uploadOf)).toEqual([expected]);
    expect(none.fake.pickImageCalls()).toBe(0);
    expect(s.errors).toEqual([]);
    expect(none.errors).toEqual([]);
  });

  it("after uploadArtFile the type's Token art row carries the asset name the upload used", async () => {
    const s = await declinedGoblin();
    expect(s.rowOf("goblin")).not.toHaveProperty("uploadedAs");

    await s.sync.uploadArtFile("goblin", imageFile());
    await settle();

    expect(s.listed()).toEqual([
      {
        monsterKey: "goblin",
        monsterName: "Goblin",
        state: "declined",
        uploadedAs: UPLOAD_NAME,
      },
      { monsterKey: "dire-wolf", monsterName: "Dire Wolf", state: "art" },
    ]);
    expect(s.errors).toEqual([]);
  });

  it('a file that cannot be read, or whose Owlbear upload rejects, is reported through onArtRepublishFailed as "Could not upload the new token art for <name>: <reason>", leaves the type\'s art, tokens and Token art row as they were, and a later upload is tried again', async () => {
    const unreadable = new Error("file unreadable");
    const refused = new Error("upload refused");
    const cases: {
      label: string;
      file: () => Blob;
      upload: UploadAnswer;
      reason: unknown;
      uploadsTried: number;
    }[] = [
      {
        label: "unreadable file",
        file: unreadableFile,
        upload: () => {},
        reason: unreadable,
        uploadsTried: 0,
      },
      {
        label: "upload rejects",
        file: imageFile,
        upload: () => Promise.reject(refused),
        reason: refused,
        uploadsTried: 1,
      },
    ];
    for (const { label, file, upload, reason, uploadsTried } of cases) {
      const s = await declinedGoblin();
      const before = s.listed();
      const reports = s.typeArt.length;
      const tokensBefore = structuredClone(s.fake.scene.getItems());

      s.uploadAnswer(upload);
      await expect(s.sync.uploadArtFile("goblin", file()), label).resolves.toBe(
        undefined,
      );
      await settle();

      expect(s.failures, label).toEqual([
        `Could not upload the new token art for Goblin: ${describeError(reason)}`,
      ]);
      expect(s.fake.uploads(), label).toHaveLength(uploadsTried);
      expect(s.typeArt.length, label).toBe(reports);
      expect(s.listed(), label).toEqual(before);
      expect(s.fake.scene.getItems(), label).toEqual(tokensBefore);
      expect(s.reported, label).toEqual([]);
      expect(s.fake.pickImageCalls(), label).toBe(1);

      // The GM can try again.
      s.uploadAnswer(() => {});
      await s.sync.uploadArtFile("goblin", imageFile());
      await settle();
      expect(s.fake.uploads(), label).toHaveLength(uploadsTried + 1);
      expect(s.rowOf("goblin")?.uploadedAs, label).toBe(UPLOAD_NAME);
      expect(s.errors, label).toEqual([]);
    }
  });

  it("a reconcile triggered while a file upload is still running is applied without waiting for it", async () => {
    const s = await declinedGoblin();
    const upload = deferred<undefined>();
    s.uploadAnswer(() => upload.promise);

    const running = later(s.sync.uploadArtFile("goblin", imageFile()));
    await settle();
    expect(s.fake.uploads()).toHaveLength(1);
    expect(s.sync.artWaits()).toEqual([]);

    await s.sync.handleMessage(
      s.feed.event({ type: "added", instances: [inst(3, "goblin")] }),
    );
    await settle();

    expectCircles(s.tokenOf, ["goblin-1", "goblin-2", "goblin-3"]);

    upload.resolve(undefined);
    await running;
    await settle();
    expect(s.rowOf("goblin")?.uploadedAs).toBe(UPLOAD_NAME);
    expect(s.errors).toEqual([]);
  });

  it("while a type's file upload runs, a second upload, a pick of the uploaded image and Pick art for the type are ignored", async () => {
    const s = await declinedGoblin();
    // The goblin's fresh picker opened once.
    expect(s.fake.pickImageCalls()).toBe(1);
    const upload = deferred<undefined>();
    s.uploadAnswer(() => upload.promise);

    const running = later(s.sync.uploadArtFile("goblin", imageFile()));
    await settle();
    expect(s.fake.uploads()).toHaveLength(1);

    await s.sync.uploadArtFile("goblin", imageFile());
    await s.sync.pickUploadedFile("goblin");
    await s.sync.repickArt("goblin");
    await settle();

    expect(s.fake.uploads()).toHaveLength(1);
    expect(s.fake.pickImageCalls()).toBe(1);

    upload.resolve(undefined);
    await running;
    await settle();

    // Once it ended, a pick of the uploaded image opens the picker.
    await s.sync.pickUploadedFile("goblin");
    expect(s.fake.pickImageCalls()).toBe(2);
    expect(s.searches.at(-1)).toBe(UPLOAD_NAME);
    expect(s.errors).toEqual([]);
  });

  it("an upload or a pick of the uploaded image is ignored for a type not in the Token art list or whose fresh picker is open or queued, and a pick of the uploaded image for a type with no upload this session", async () => {
    // Not in the list: no instance in the encounter, or unknown.
    const absent = await declinedGoblin();
    const picksBefore = absent.fake.pickImageCalls();
    await absent.sync.uploadArtFile("orc", imageFile());
    await absent.sync.uploadArtFile("dragon", imageFile());
    await absent.sync.pickUploadedFile("orc");
    await absent.sync.pickUploadedFile("dragon");
    await settle();
    expect(absent.fake.uploads()).toEqual([]);
    expect(absent.fake.pickImageCalls()).toBe(picksBefore);

    // No upload this session.
    await absent.sync.pickUploadedFile("goblin");
    await absent.sync.pickUploadedFile("dire-wolf");
    await settle();
    expect(absent.fake.pickImageCalls()).toBe(picksBefore);

    // A fresh picker open (goblin) or queued (orc) in a reconcile, for types
    // uploaded before the scene was ready.
    const fresh = setup();
    fresh.fake.scene.setReady(false);
    await fresh.sync.handleMessage(
      createMessageFeed().snapshot([inst(1, "goblin"), inst(1, "orc")]),
    );
    await settle();
    await fresh.sync.uploadArtFile("goblin", imageFile());
    await fresh.sync.uploadArtFile("orc", imageFile());
    await settle();
    expect(fresh.fake.uploads()).toHaveLength(2);
    expect(fresh.rowOf("goblin")?.uploadedAs).toBe(UPLOAD_NAME);
    expect(fresh.rowOf("orc")?.uploadedAs).toBe(UPLOAD_NAME);

    const goblinPick = deferred<PublishedTokenArt | undefined>();
    let opened = 0;
    fresh.answer(() => (opened++ === 0 ? goblinPick.promise : undefined));
    fresh.fake.scene.setReady(true);
    await settle();
    expect(fresh.fake.pickImageCalls()).toBe(1);

    await fresh.sync.uploadArtFile("goblin", imageFile());
    await fresh.sync.uploadArtFile("orc", imageFile());
    await fresh.sync.pickUploadedFile("goblin");
    await fresh.sync.pickUploadedFile("orc");
    await settle();
    expect(fresh.fake.uploads()).toHaveLength(2);
    expect(fresh.fake.pickImageCalls()).toBe(1);

    goblinPick.resolve(undefined);
    await settle();
    // The orc's own fresh picker ran after the goblin's.
    expect(fresh.fake.pickImageCalls()).toBe(2);
    expect(fresh.searches).toEqual([undefined, undefined]);
    expect(absent.reported).toEqual([]);
    expect(absent.errors).toEqual([]);
    expect(fresh.errors).toEqual([]);
  });
});

describe("createEncounterSync pickUploadedFile", () => {
  it("pickUploadedFile opens the picker with the uploaded asset name as its search; a valid pick becomes the type's art, is sent as a token-art-set, and replaces the type's circle tokens with image tokens, each with the re-skin replacement note", async () => {
    const s = await declinedGoblin();
    expectCircles(s.tokenOf, ["goblin-1", "goblin-2"]);
    const circleIds = [s.tokenOf("goblin-1")?.id, s.tokenOf("goblin-2")?.id];
    await s.sync.uploadArtFile("goblin", imageFile());
    await settle();

    s.answer(() => structuredClone(uploadedArt));
    await s.sync.pickUploadedFile("goblin");
    await settle();

    expect(s.searches).toEqual([undefined, UPLOAD_NAME]);
    expect(s.reported).toEqual([["goblin", uploadedArt]]);
    expectImages(s.tokenOf, ["goblin-1", "goblin-2"], uploadedArt);
    expect(s.tokenOf("goblin-1")?.id).not.toBe(circleIds[0]);
    expect(s.tokenOf("goblin-2")?.id).not.toBe(circleIds[1]);
    expect(s.overrides).toEqual([
      "Goblin 1's token was replaced with a new one drawn with the art picked for its monster type; any attachments on the old token were deleted with it.",
      "Goblin 2's token was replaced with a new one drawn with the art picked for its monster type; any attachments on the old token were deleted with it.",
    ]);
    expect(s.rowOf("goblin")?.state).toBe("art");

    // Tokens created afterwards are drawn with it, with no fresh picker.
    await s.sync.handleMessage(
      s.feed.event({ type: "added", instances: [inst(3, "goblin")] }),
    );
    await settle();
    expectImages(s.tokenOf, ["goblin-3"], uploadedArt);
    expect(s.fake.pickImageCalls()).toBe(2);
    expect(s.errors).toEqual([]);
  });

  it("the bytes of a picked uploaded image are fetched from Owlbear and stored as after a fresh pick, and the art is sent again with their hash", async () => {
    const s = await declinedGoblin({ storeImage: storedAnswer });
    await s.sync.uploadArtFile("goblin", imageFile());
    await settle();
    const fetchedBefore = s.fetched.length;
    const storedBefore = s.storedBytes.length;
    const reportedBefore = s.reported.length;

    s.answer(() => structuredClone(uploadedArt));
    await s.sync.pickUploadedFile("goblin");
    await settle();

    expect(s.fetched.slice(fetchedBefore)).toEqual([uploadedArt.url]);
    expect(s.storedBytes.slice(storedBefore)).toHaveLength(1);
    expect([...(s.storedBytes.at(-1) ?? [])]).toEqual([...STORED_BYTES]);
    expect(s.reported.slice(reportedBefore)).toEqual([
      ["goblin", uploadedArt],
      ["goblin", { ...uploadedArt, sha256: PICKED_SHA }],
    ]);
    expect(s.errors).toEqual([]);
  });

  it("a valid panel pick for the type takes the uploaded asset name off its Token art row", async () => {
    // The upload's own pick.
    const own = await declinedGoblin();
    await own.sync.uploadArtFile("goblin", imageFile());
    await settle();
    expect(own.rowOf("goblin")?.uploadedAs).toBe(UPLOAD_NAME);
    own.answer(() => structuredClone(uploadedArt));
    await own.sync.pickUploadedFile("goblin");
    await settle();
    expect(own.rowOf("goblin")).toEqual({
      monsterKey: "goblin",
      monsterName: "Goblin",
      state: "art",
    });

    // Pick art, choosing some other image.
    const repick = await declinedGoblin();
    await repick.sync.uploadArtFile("goblin", imageFile());
    await settle();
    expect(repick.rowOf("goblin")?.uploadedAs).toBe(UPLOAD_NAME);
    repick.answer(() => structuredClone(otherArt));
    await repick.sync.repickArt("goblin");
    await settle();
    expect(repick.reported).toEqual([["goblin", otherArt]]);
    expect(repick.rowOf("goblin")).toEqual({
      monsterKey: "goblin",
      monsterName: "Goblin",
      state: "art",
    });
    expect(own.errors).toEqual([]);
    expect(repick.errors).toEqual([]);
  });

  it("a cancelled, failed or invalid pick of the uploaded image leaves the type's art, tokens and uploaded asset name as they were, and a later press opens the picker again", async () => {
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
      await s.sync.uploadArtFile("goblin", imageFile());
      await settle();
      const before = s.listed();
      expect(before[0]?.uploadedAs, label).toBe(UPLOAD_NAME);
      const tokensBefore = structuredClone(s.fake.scene.getItems());
      const reports = s.typeArt.length;
      const picks = s.fake.pickImageCalls();

      s.answer(answer);
      await expect(s.sync.pickUploadedFile("goblin"), label).resolves.toBe(
        undefined,
      );
      await settle();

      expect(s.fake.pickImageCalls(), label).toBe(picks + 1);
      expect(s.searches.at(-1), label).toBe(UPLOAD_NAME);
      expect(s.typeArt.length, label).toBe(reports);
      expect(s.listed(), label).toEqual(before);
      expect(s.fake.scene.getItems(), label).toEqual(tokensBefore);
      expect(s.reported, label).toEqual([]);
      expect(s.overrides, label).toEqual([]);
      expect(s.errors, label).toEqual([]);

      // The GM can press again.
      s.answer(() => undefined);
      await s.sync.pickUploadedFile("goblin");
      expect(s.fake.pickImageCalls(), label).toBe(picks + 2);
      expect(s.searches.at(-1), label).toBe(UPLOAD_NAME);
    }
  });
});
