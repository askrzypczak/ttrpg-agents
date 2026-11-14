// Harness page: plays the Owlbear host and iframes the extension.
// Query: target=<url> (required), role=gm|player (default gm), ready=0|1,
// failItems=<message> (item calls fail), pickedImages=<JSON array> (the asset picker's answer), obrOrigin=<origin> (advertise a wrong host origin to test the SDK check),
// sceneId=<id> (the scene's id in its metadata; absent: none).
import { SCENE_ID_METADATA_KEY } from "../src/open-scene.js";
import { SceneModel } from "../src/scene-model.js";
import { FakeHost } from "./fake-host.js";
import "./globals.d.ts";

const params = new URLSearchParams(location.search);
const target = new URL(params.get("target") ?? "", location.href);
const role = params.get("role") === "player" ? "player" : "gm";
const scene = new SceneModel(role, params.get("ready") !== "0");
const sceneId = params.get("sceneId");
if (sceneId !== null) scene.setMetadata({ [SCENE_ID_METADATA_KEY]: sceneId });

const iframe = document.getElementById("extension") as HTMLIFrameElement;
const pickedImages = params.get("pickedImages");
window.__host = new FakeHost({
  iframe,
  scene,
  failItems: params.get("failItems") ?? undefined,
  pickedImages:
    pickedImages === null ? undefined : (JSON.parse(pickedImages) as unknown[]),
});

// The SDK reads `obrref` = base64("<host origin> <room id>").
target.searchParams.set(
  "obrref",
  btoa(`${params.get("obrOrigin") ?? location.origin} e2e-room`),
);
iframe.src = target.href;
