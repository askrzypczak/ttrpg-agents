// Harness page: plays the Owlbear host and iframes the extension.
// Query: target=<url> (required), role=gm|player (default gm), ready=0|1,
// token=<hex> (URL fragment for the extension), obrOrigin=<origin> (advertise a wrong host origin to test the SDK check).
import { SceneModel } from "../src/scene-model.js";
import { FakeHost } from "./fake-host.js";
import "./globals.d.ts";

const params = new URLSearchParams(location.search);
const target = new URL(params.get("target") ?? "", location.href);
const role = params.get("role") === "player" ? "player" : "gm";
const scene = new SceneModel(role, params.get("ready") !== "0");

const iframe = document.getElementById("extension") as HTMLIFrameElement;
window.__host = new FakeHost({ iframe, scene });

// The SDK reads `obrref` = base64("<host origin> <room id>").
target.searchParams.set(
  "obrref",
  btoa(`${params.get("obrOrigin") ?? location.origin} e2e-room`),
);
// Like the real manifest popover URL, the bridge token rides in the fragment.
const token = params.get("token");
iframe.src = target.href + (token ? `#${token}` : "");
