# @ttrpg-agents/imaging

Driven adapter (Node only) behind the engine's token ports: `createSharpTokeniser` implements `Tokeniser` and `TokeniserProbe` with [sharp](https://sharp.pixelplumbing.com/), and `createNodeImageSource` implements `ImageSource` over local files and https. It imports only `@ttrpg-agents/engine`; only the mcp composition roots (`src/stdio.ts`, `src/status-cli.ts`) wire it in. The engine owns the crop maths, the limits and the token style; this package only loads bytes and draws pixels.

## Tokeniser

- Lazy load: creating the tokeniser loads nothing, so the MCP server starts when sharp cannot load. The first call imports sharp and keeps the result, a failed load included: restart the MCP server after fixing it (`npm ci`). While sharp cannot load, `renderToken` and `focalPoint` reject with a `TokeniserError` naming the first line of the cause, and `check()` (the setup report's probe, which never rejects) answers `failed` with it.
- `renderToken(bytes, crop, style)` extracts the crop, scales it to a `style.side` square, adds an alpha channel, cuts it to a circle (an SVG mask composited with `dest-in`) and draws the ring (an SVG circle stroked in `style.ringColour`, `round(ringWidth * side)` px wide, in the circle's outer band). It encodes WebP at quality 90 with lossless alpha (`alphaQuality` 100), so the corners stay fully transparent.
- `focalPoint(bytes)` asks sharp's attention strategy (luminance frequency, saturation and skin tones) for the region to keep when cropping the image to half its height, which forces a crop on square images too. At that size the image is not scaled, so the point sharp reports is in source pixels; it is answered as fractions of the width and height, the middle when sharp reports none. EXIF orientation is ignored, as in the engine's crop.
- A sharp error during a call is a `TokeniserError` naming its first line.

## Image source

- A path must be absolute. It is checked with `stat` before reading: a missing path, one that is not a regular file, or one over `TOKEN_SOURCE_MAX_BYTES` (20 MiB) is refused unread. The read stops one byte past the cap, so a file that grew after the check is refused too.
- A URL must be https. Redirects are followed by hand (`redirect: "manual"`), at most five, each `Location` resolved against the URL that answered it and refused unless it is https. Any other answer that is not 2xx is refused, naming its status.
- A declared `Content-Length` over the cap is refused before reading; otherwise the body is streamed and abandoned once more than the cap has arrived. One `AbortSignal.timeout` (`IMAGE_LOAD_TIMEOUT_MS`, 5 s) covers the whole load, redirects and body included. Any host is fetched: there is no allowlist and no private-address refusal.
- Every refusal is an `ImageUnavailableError` naming the path or URL and the cause. A file load has no timeout.
