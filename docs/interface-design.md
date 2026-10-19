# Interface design

Signal's crawler is the primary workspace: a large, actual URL-link graph with a small run toolbar and activity strip. The original reference is [Zivlen's crawler animation](https://x.com/zivlen_coder/status/2111063806248157386). Its branching network and dense operating view inform the composition; all rendered research links come from real crawl discoveries.

## Guidance reviewed and applied

- [Anthropic frontend-design skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md): subject-specific hierarchy, restrained decoration, purposeful typography, sentence-case product copy. The memorable element is the spider; surrounding controls stay quiet.
- [Vercel Web Interface Guidelines](https://vercel.com/design/guidelines) and [review skill](https://github.com/vercel-labs/agent-skills/blob/main/skills/web-design-guidelines/SKILL.md): visible focus, keyboard operation, responsive layouts, explicit loading/error states, reduced-motion support, pagination and limited rendering for long lists.
- [Linear's calmer interface](https://linear.app/now/behind-the-latest-design-refresh): predictable placement of actions, reduced visual noise, and restrained neutral color values.

## Implementation choices

- Six core tokens: canvas #111111, surface #161616, raised #1c1c1c, border #2b2b2b, primary text #ececea, muted text #989895. Teal #9bddd0 is reserved for live activity, focus and key controls; the active node has a small soft halo. No colorful domain coding or decorative charts.
- System sans for controls and prose; monospace for URLs, timestamps, and measurements.
- Canvas movement runs on requestAnimationFrame only during live crawling, replay, or a finite transition. Critically damped springs preserve velocity through updates; new branches grow from their parents. A bounded Web Worker calculates layout off the main thread; replay reveals subsets of a cached full layout, keeping the camera stable. Subtle branch sway, travelling activity dots, and a tracking ring show live activity. Motion stops when paused and settled, offscreen, hidden, or reduced motion is requested. Edges are batched; device pixel ratio is capped at 2; labels appear on seeds and selection.
- Stable graph inputs across unchanged polling responses; no overlapping snapshot requests; one active crawl step at a time.
- Real graph seeds, frontier and parent-child links. Replay is explicitly labeled as a recorded crawl and advances through actual saved pages.
- Library pagination at 60 rows; seed picker at 60 search matches; chat history initially limited to 24 messages; chat code loaded when its tab opens.
- Canvas keyboard controls: arrows pan, +/- zoom, F or 0 fit. Modal focus is contained and returned on close. Source links are also accessible in tables and lists.

## Review checklist

Review populated, empty, loading, error, mobile, and keyboard states. Verify zoom and pan do not trigger page scrolling. Confirm canvas data-render-count stays unchanged during idle polling and inspect data-draw-ms when testing. Never add fabricated URLs, graph edges, activity counters, or source claims to make the screen appear busy.


## Usability reference library and decisions

Reviewed October 18–19, 2026. This is a focused reference set, not a claim to catalogue every interface or tool on the web. Guidance is applied to the actual research workflow; dependencies are added only when they solve a demonstrated need.

| Reference | Applied decision |
| --- | --- |
| [Anthropic frontend-design skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) | Preserve the user's neutral research workspace. Keep the live spider as the main visual; reserve teal for activity and actions. |
| [Vercel interface review skill](https://github.com/vercel-labs/agent-skills/blob/main/skills/web-design-guidelines/SKILL.md) and [guidelines](https://vercel.com/design/guidelines) | Clear action labels, keyboard focus, inline help, visible saving state, small render cost, and reduced-motion behavior. |
| [NN/g usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) | Starting sources are visible and intentional; pasted URLs have an explicit count. Use familiar words such as “Collected pages.” |
| [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) | Keep topic, sources, URLs and page limit visible. Put link depth and domain boundaries in Advanced settings. |
| [GOV.UK error summary](https://design-system.service.gov.uk/components/error-summary/) | Crawl errors persist inside the form and receive keyboard focus. Correcting a URL clears its error. |
| [Atlassian empty state](https://atlassian.design/components/empty-state/) | Explain the recorded example and provide a direct path to a user's own crawl. Empty results tell users how to proceed. |
| [WAI modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) | Named dialogs, Escape, focus containment and focus return. Source inspection is a nonmodal drawer so the current task stays intact. |
| [Linear interface refresh](https://linear.app/now/behind-the-latest-design-refresh) | Quiet chrome, consistent action placement, restrained density and predictable navigation. |

### Tools evaluated

- [React Flow performance guidance](https://reactflow.dev/learn/advanced-use/performance): useful for editable node workflows; retain the existing canvas for this dense crawl graph. Stable props and memoized components prevent unnecessary recomputation.
- [Motion accessibility](https://motion.dev/docs/react-accessibility): apply reduced-motion handling and purposeful transitions. Native canvas springs already provide continuous movement, so no animation dependency was added.
- [Radix accessibility](https://www.radix-ui.com/primitives/docs/overview/accessibility): use native controls and WAI patterns for the current small set of interactions. Radix remains available in the project for future complex widgets.
- Browser screenshots, DOM checks, canvas draw-time counters, TypeScript, and native Node tests validate the implementation. The animation tests cover frame-rate independence, interrupted movement, parent spawning, replay continuity, reduced motion, and settling.

### Workflow checks

1. Ask finds sources; “Review & start crawl” opens the starting-point configuration without claiming a crawl already started.
2. A new crawl has zero silently selected sources. A URL-only crawl stays URL-only.
3. A resource can be inspected in Ask or Sources without discarding the active question, filters or scroll context.
4. Pausing keeps the queue, shows progress feedback, and stops ambient movement after settling. Completed crawls explain whether the page limit was reached.
5. Saving is guarded against repeated requests and makes removal from Saved explicit.
