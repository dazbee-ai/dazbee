# The matchers run in the person's browser; a worker app runs them only for agents and devices that can't

The text matcher and the shape matcher run in Web Workers in the person's own browser, on every device, and the server runs them only for agents (the MCP server) and for a browser that can't. The server is one machine of one CPU (ADR-0017), and the matchers take seconds of CPU an ad: run for every person on the server, they would queue behind each other and slow the API and the sync server. Measured on the prototypes, the browser gives the server's answers to the last digit (the same CanvasKit build draws the same pixels, ADR-0005, and ONNX Runtime Web gives ONNX Runtime's shortlists) at the speed of one server core, so moving the work to the browser costs no accuracy.

## Consequences

- **The browser downloads the text matcher's files once**, about 28 MB gzipped (the model, ONNX Runtime Web, the font fingerprints), kept for good at permanent addresses named by their SHA-256, `app.dazbee.com/matchers/<sha256>.bin`, which the API answers from our storage to anyone, as it does the Google faces' files, and which the browser also keeps in Cache Storage. It then fetches each piece's fonts as match copies at `app.dazbee.com/fonts/google/match/v<version>/<face id>.ttf`, about 4.5 MB an ad. The shape matcher needs nothing beyond CanvasKit, which the editor has.
- **The server side is ADR-0001's worker app**, its first use: one process beside the API, reached only by the API (the MCP server and a browser that can't go through the API's route), running the same matcher code in Node threads at a lower CPU priority than the API and the sync server, with a cap on threads, waiting jobs and memory.
- **ONNX Runtime Web runs on WebAssembly only**, not WebGPU: WebGPU was checked against WebAssembly on one graphics card, and a float difference on another could change a close pick, so every device would no longer give the same answer.
- **Writes stay with commands** (ADR-0004): a matcher only answers with layers, and the tab that asked, the person's or the agent's, writes them in one step.
- **The text matcher's model starts from ImageNet-1k weights** (timm's `convnext_atto.d2_in1k`; timm's code is Apache-2.0, ImageNet's terms are for non-commercial research). The owner accepted that grey area for accuracy on 2026-11-22; a model trained without them is the way out if it is ever closed.

## Considered Options

- **The server for every person**: rejected. A 4 vCPU / 8 GB box would be needed at once, and its cost grows with every person, where the browser's is free and scales with them.
- **Worker threads in the API**: rejected. The API is capped at 512 MB in two colours during a deploy, and CanvasKit's memory only grows; a matcher thread needs about 1 GB.
- **WebGL drawing in the matcher**: rejected by ADR-0005. Candidates are drawn on the CPU surface, so the browser and the server judge the same pixels.
