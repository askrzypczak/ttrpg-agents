// A fake Owlbear Rodeo host for e2e tests. It speaks the postMessage protocol
// of @owlbear-rodeo/sdk 3.x (see MessageBus.ts there) and answers ONLY the
// calls the extension makes. Any other message id is answered with an
// `_ERROR` reply and recorded in `errors`, so the fake cannot drift silently
// from what the extension uses.
import {
  MissingSceneError,
  SceneModel,
  type ItemPatch,
  type SceneItem,
} from "../src/scene-model.js";

export interface FakeHostOptions {
  iframe: HTMLIFrameElement;
  scene: SceneModel;
  userId?: string;
  /** Makes every item call fail with this message, even on a ready scene. */
  failItems?: string;
  /**
   * What the GM picks each time the asset picker opens (`ImageDownload`
   * objects of the SDK). Default: none, as when the GM cancels.
   */
  pickedImages?: unknown[];
}

interface SdkMessage {
  id: string;
  data: unknown;
  ref: string;
  nonce?: string;
}

function isSdkMessage(value: unknown): value is SdkMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

const NO_REPLY = Symbol("no-reply");

/** Screen size the fake reports; the view centre is half of it. */
export const VIEWPORT = { width: 1000, height: 600 } as const;

class UnhandledMessageError extends Error {}

export class FakeHost {
  /** Descriptions of messages the fake did not understand. Tests expect []. */
  readonly errors: string[] = [];
  /** The data of each asset picker request, in order. */
  readonly imageRequests: unknown[] = [];
  readonly scene: SceneModel;
  private readonly iframe: HTMLIFrameElement;
  private readonly ref = "e2e-ref";
  private readonly userId: string;
  private readonly failItems: string | undefined;
  private readonly pickedImages: unknown[];
  private readonly readySubscribed = { value: false };
  private readonly itemsSubscribed = { value: false };

  constructor(options: FakeHostOptions) {
    this.scene = options.scene;
    this.iframe = options.iframe;
    this.userId = options.userId ?? "e2e-user";
    this.failItems = options.failItems;
    this.pickedImages = options.pickedImages ?? [];
    window.addEventListener("message", this.onMessage);
    this.scene.onChange((change) => {
      if (change.kind === "ready" && this.readySubscribed.value)
        this.post({
          id: "OBR_SCENE_EVENT_READY_CHANGE",
          data: { ready: change.ready },
        });
      if (change.kind === "items" && this.itemsSubscribed.value)
        this.post({
          id: "OBR_SCENE_ITEMS_EVENT_CHANGE",
          data: { items: this.scene.getItems() },
        });
    });
    this.iframe.addEventListener("load", () => {
      this.post({
        id: "OBR_READY",
        data: { userId: this.userId, ref: this.ref },
      });
    });
  }

  private post(message: { id: string; data: unknown }): void {
    const target = this.iframe.contentWindow;
    if (!target) return;
    // Target the iframe's own origin; the SDK ignores other origins.
    target.postMessage(message, new URL(this.iframe.src).origin);
  }

  private reply(
    message: SdkMessage,
    kind: "RESPONSE" | "ERROR",
    data: unknown,
  ): void {
    this.post({ id: `${message.id}_${kind}${message.nonce ?? ""}`, data });
  }

  private readonly onMessage = (event: MessageEvent): void => {
    if (event.source !== this.iframe.contentWindow) return;
    if (!isSdkMessage(event.data)) return;
    const message = event.data;
    try {
      if (message.ref !== this.ref)
        throw new UnhandledMessageError(
          `Message "${message.id}" carried unknown ref ${JSON.stringify(message.ref)}; expected the ref issued in OBR_READY.`,
        );
      const result = this.handle(message);
      if (result !== NO_REPLY) this.reply(message, "RESPONSE", result);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (error instanceof UnhandledMessageError) this.errors.push(text);
      const name = error instanceof Error ? error.name : "Error";
      this.reply(message, "ERROR", { name, message: text });
    }
  };

  private handle(message: SdkMessage): unknown {
    const data = (message.data ?? {}) as Record<string, unknown>;
    // Subscribing is fire-and-forget in the SDK and works whether or not a
    // scene is loaded, so it is answered before the item-call guards.
    if (message.id === "OBR_SCENE_ITEMS_SUBSCRIBE") {
      this.itemsSubscribed.value = true;
      return NO_REPLY;
    }
    if (message.id === "OBR_SCENE_ITEMS_UNSUBSCRIBE") {
      this.itemsSubscribed.value = false;
      return NO_REPLY;
    }
    if (message.id.startsWith("OBR_SCENE_ITEMS_")) {
      if (this.failItems !== undefined) throw new Error(this.failItems);
      if (!this.scene.isReady()) throw new MissingSceneError();
    }
    switch (message.id) {
      case "OBR_PLAYER_GET_ROLE":
        return { role: this.scene.role === "gm" ? "GM" : "PLAYER" };
      case "OBR_SCENE_IS_READY":
        return { ready: this.scene.isReady() };
      case "OBR_SCENE_READY_SUBSCRIBE":
        this.readySubscribed.value = true;
        return NO_REPLY;
      case "OBR_SCENE_READY_UNSUBSCRIBE":
        this.readySubscribed.value = false;
        return NO_REPLY;
      case "OBR_SCENE_ITEMS_GET_ALL_ITEMS":
        return { items: this.scene.getItems() };
      case "OBR_SCENE_ITEMS_ADD_ITEMS":
        this.scene.addItems(data.items as SceneItem[]);
        return {};
      case "OBR_SCENE_ITEMS_UPDATE_ITEMS":
        for (const update of data.updates as Array<
          { id: string; type?: string } & ItemPatch
        >) {
          // The SDK sends only changed keys plus id and type.
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { id, type: _type, ...patch } = update;
          this.scene.updateItems([id], patch);
        }
        return {};
      case "OBR_SCENE_ITEMS_DELETE_ITEMS":
        this.scene.deleteItems(data.ids as string[]);
        return {};
      // Viewport: a fixed 1000x600 screen with an identity transform, so the
      // view centre in scene coordinates is (500, 300).
      case "OBR_VIEWPORT_GET_WIDTH":
        return { width: VIEWPORT.width };
      case "OBR_VIEWPORT_GET_HEIGHT":
        return { height: VIEWPORT.height };
      case "OBR_VIEWPORT_INVERSE_TRANSFORM_POINT":
        return { point: data.point };
      case "OBR_SCENE_GET_METADATA":
        return { metadata: this.scene.getMetadata() };
      case "OBR_SCENE_SET_METADATA":
        this.scene.setMetadata(data.update as Record<string, unknown>);
        return {};
      // The asset picker; the real one waits for the GM with no timeout.
      case "OBR_ASSETS_DOWNLOAD_IMAGES":
        this.imageRequests.push(message.data);
        return { images: structuredClone(this.pickedImages) };
      default:
        throw new UnhandledMessageError(
          `Unhandled Owlbear message "${message.id}": the fake host does not implement it. Add it to e2e/fake-host.ts (and the ObrAdapter and its fake) deliberately.`,
        );
    }
  }
}
