# The matchers run only in the person's browser

The text matcher and the shape matcher run in Web Workers in the person's own browser, on every device, and nowhere else: the server runs no matcher. The server is one machine of one CPU (ADR-0017), and the matchers take seconds of CPU an ad: run for every person on the server, they would queue behind each other and slow the API and the sync server. Measured on the prototypes, the browser gives Node's answers to the last digit (the same CanvasKit build draws the same pixels, ADR-0005, and ONNX Runtime Web gives ONNX Runtime's shortlists) at the speed of one server core, so running the work in the browser costs no accuracy.

## Consequences

- **The browser downloads the text matcher's files once**, about 28 MB gzipped (the model, ONNX Runtime Web, the font fingerprints), kept for good at permanent addresses named by their SHA-256, `app.dazbee.com/matchers/<sha256>.bin`, which the API answers from our storage to anyone, as it does the Google faces' files, and which the browser also keeps in Cache Storage. It then fetches each piece's fonts as match copies at `app.dazbee.com/fonts/google/match/v<version>/<face id>.ttf`, about 4.5 MB an ad. The shape matcher needs nothing beyond CanvasKit, which the editor has.
- **The browser runs them in a pool of workers sized to the device**, started with the first piece and ended once nothing is matching, so a tab holds no matcher memory while it isn't matching.
- **A browser that can't run them keeps the picture**, with the reason. A server backup is added only if it is ever needed.
- **ONNX Runtime Web runs on WebAssembly only**, not WebGPU: WebGPU was checked against WebAssembly on one graphics card, and a float difference on another could change a close pick, so every device would no longer give the same answer.
- **Writes stay with commands** (ADR-0004): a matcher only answers with layers, and the tab that asked writes them in one step.
- **The text matcher's model starts from ImageNet-1k weights** (timm's `convnext_atto.d2_in1k`; timm's code is Apache-2.0, ImageNet's terms are for non-commercial research). The owner accepted that grey area for accuracy on 2026-11-22; a model trained without them is the way out if it is ever closed.

## Considered Options

- **The server for every person**: rejected. A 4 vCPU / 8 GB box would be needed at once, and its cost grows with every person, where the browser's is free and scales with them.
- **Worker threads in the API**: rejected. The API is capped at 512 MB in two colours during a deploy, and CanvasKit's memory only grows; a matcher thread needs about 1 GB.
- **WebGL drawing in the matcher**: rejected by ADR-0005. Candidates are drawn on the CPU surface, so every device judges the same pixels.
