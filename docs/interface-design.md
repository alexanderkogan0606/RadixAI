# Interface design

Signal's crawler is the primary workspace: a large, actual URL-link graph with a small run toolbar and activity strip. The original reference is [Zivlen's crawler animation](https://x.com/zivlen_coder/status/2111063806248157386). Its branching network and dense operating view inform the composition; all rendered research links come from real crawl discoveries.

## Guidance reviewed and applied

- [Anthropic frontend-design skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md): subject-specific hierarchy, restrained decoration, purposeful typography, sentence-case product copy. The memorable element is the spider; surrounding controls stay quiet.
- [Vercel Web Interface Guidelines](https://vercel.com/design/guidelines) and [review skill](https://github.com/vercel-labs/agent-skills/blob/main/skills/web-design-guidelines/SKILL.md): visible focus, keyboard operation, responsive layouts, explicit loading/error states, reduced-motion support, pagination and limited rendering for long lists.
- [Linear's calmer interface](https://linear.app/now/behind-the-latest-design-refresh): predictable placement of actions, reduced visual noise, and restrained neutral color values.

## Implementation choices

- Six core tokens: canvas #111111, surface #161616, raised #1c1c1c, border #2b2b2b, primary text #ececea, muted text #989895. No colorful domain coding, glows, or decorative charts.
- System sans for controls and prose; monospace for URLs, timestamps, and measurements.
- Event-driven canvas rendering. No permanent animation or force-simulation loop. A bounded Web Worker relaxes the real graph topology off the main thread, then stops; status-only updates reuse the layout. Edges are batched; device pixel ratio is capped at 2; labels appear on seeds and selection.
- Stable graph inputs across unchanged polling responses; no overlapping snapshot requests; one active crawl step at a time.
- Real graph seeds, frontier and parent-child links. Replay is explicitly labeled as a recorded crawl and advances through actual saved pages.
- Library pagination at 60 rows; seed picker at 60 search matches; chat history initially limited to 24 messages; chat code loaded when its tab opens.
- Canvas keyboard controls: arrows pan, +/- zoom, F or 0 fit. Modal focus is contained and returned on close. Source links are also accessible in tables and lists.

## Review checklist

Review populated, empty, loading, error, mobile, and keyboard states. Verify zoom and pan do not trigger page scrolling. Confirm canvas data-render-count stays unchanged during idle polling and inspect data-draw-ms when testing. Never add fabricated URLs, graph edges, activity counters, or source claims to make the screen appear busy.
