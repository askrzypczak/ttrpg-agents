// Test-only extension page. The panel (main.ts) does not call addItems or
// setMetadata yet, so this drives the real createObrAdapter() through the
// logic modules (the API is published only once OBR_READY has arrived), and lets sendRaw probe the fake host's strictness.
import { createObrAdapter } from "../src/obr-adapter.js";
import { addHiddenToken } from "../src/hidden-token.js";
import { writeInitiativeMetadata } from "../src/initiative.js";
import "./globals.d.ts";

const obr = createObrAdapter();

let ref = "";
window.addEventListener("message", (event) => {
  const message = event.data as { id?: string; data?: { ref?: string } };
  if (message?.id === "OBR_READY" && message.data?.ref) ref = message.data.ref;
});

obr.onReady(() => {
  window.__e2e = {
    obr,
    addHiddenToken: (token) =>
      addHiddenToken(obr, {
        ...token,
        image: {
          url: "http://127.0.0.1/none.png",
          mime: "image/png",
          width: 150,
          height: 150,
        },
        grid: { dpi: 150, offset: { x: 75, y: 75 } },
      }),
    writeInitiativeMetadata: (value) => writeInitiativeMetadata(obr, value),
    sendRaw: (id) =>
      new Promise((resolve, reject) => {
        const nonce = `_raw-${Math.random()}`;
        const timer = setTimeout(
          () => reject(new Error(`no reply to ${id}`)),
          3000,
        );
        const onMessage = (event: MessageEvent) => {
          const message = event.data as { id?: string; data?: unknown };
          if (message?.id?.startsWith(id) && message.id.endsWith(nonce)) {
            clearTimeout(timer);
            window.removeEventListener("message", onMessage);
            resolve({ id: message.id, data: message.data });
          }
        };
        window.addEventListener("message", onMessage);
        // The driver is served from the host's origin (same-origin iframe).
        window.parent.postMessage(
          { id, data: {}, ref, nonce },
          location.origin,
        );
      }),
  };
});
