# Interface design

RadixAI's crawler is the primary workspace: a large, actual URL-link graph with a small run toolbar and activity strip. The original reference is [Zivlen's crawler animation](https://x.com/zivlen_coder/status/2111063806248157386). Its branching network and dense operating view inform the composition; all rendered research links come from real crawl discoveries.

## Guidance reviewed and applied

- [Anthropic frontend-design skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md): subject-specific hierarchy, restrained decoration, purposeful typography, sentence-case product copy. The memorable element is the spider; surrounding controls stay quiet.
- [Vercel Web Interface Guidelines](https://vercel.com/design/guidelines) and [review skill](https://github.com/vercel-labs/agent-skills/blob/main/skills/web-design-guidelines/SKILL.md): visible focus, keyboard operation, responsive layouts, explicit loading/error states, reduced-motion support, pagination and limited rendering for long lists.
- [Linear's calmer interface](https://linear.app/now/behind-the-latest-design-refresh): predictable placement of actions, reduced visual noise, and restrained neutral color values.

## Implementation choices

- Six core tokens: canvas #111111, surface #161616, raised #1c1c1c, border #2b2b2b, primary text #ececea, muted text #989895. Teal #9bddd0 marks primary controls; the active spider has a small soft halo. The compact telemetry strip uses mint, cyan, magenta, yellow, orange, and violet to distinguish recorded measurements and review states, following the user-provided reference.
- System sans for controls and prose; monospace for URLs, timestamps, and measurements.
- Canvas movement runs on requestAnimationFrame only during live crawling, replay, or a finite transition. Critically damped springs preserve velocity through updates; new branches grow from their parents. A bounded Web Worker calculates layout off the main thread; replay reveals subsets of a cached full layout, keeping the camera stable. A separate crawler agent travels between request destinations; URL points do not sway. Motion stops when paused and settled, offscreen, hidden, or reduced motion is requested. Edges are batched; device pixel ratio is capped at 2; labels appear on seeds and selection.
- Stable graph inputs across unchanged polling responses; no overlapping snapshot requests; one active crawl step at a time.
- Real graph seeds, frontier and parent-child links. Replay is explicitly labeled as a recorded crawl and advances through actual saved pages.
- Library pagination at 60 rows; seed picker at 60 search matches; chat history initially limited to 10 messages; chat code loaded when its tab opens.
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

1. Ask finds individual documents; “Crawl these documents” opens the starting-point configuration without claiming a crawl already started.
2. A new crawl has zero silently selected sources. A URL-only crawl stays URL-only.
3. A resource can be inspected in Ask or Sources without discarding the active question, filters or scroll context.
4. Pausing keeps the queue, shows progress feedback, and stops ambient movement after settling. Completed crawls explain whether the page limit was reached.
5. Saving is guarded against repeated requests and makes removal from Saved explicit.

## October 21 refinement

Reopened the reference video in the browser and inspected its moving radial crawler and bottom telemetry strip. The crawler is now an independent canvas agent: an illuminated core with 24 articulated legs, a short trail, and destination pings. Static URL nodes stay anchored. Destination changes come from processing URLs and fetch events; idle, paused and completed runs settle, and recorded replay is labeled.

A bounded telemetry endpoint reports the current request, counters and the latest 80 events without repeatedly loading the graph. Request duration charts use actual recorded HTTP timings and display an empty state when timings are unavailable. Layout runs in a worker; frame drawing stays outside React state.

Applied the current Anthropic frontend-design skill and Vercel web-interface guidelines again to the complete workflow: quiet neutral surfaces, a compact instrument strip, sentence-case labels, clear query and provider context, a two-panel search/document view, and editorial result rows instead of repeated purpose cards. Shared document styles are scoped to their view. Results combine discovered papers/reports with relevant captured pages, preserve query provenance, and expose filtering and duplicate counts.

The live search uses the free OpenAlex, Crossref, World Bank, and SEC EDGAR APIs. Company-report questions return individual SEC filings with the actual company, form, reporting period, and document path. Provider failures are explicit. Discovery metadata is distinguished from fetched page metadata; no full-document synthesis is implied. Saved records are durable, exact open-access URLs retain their evidence, and old session/login/navigation captures are excluded from normal Results while the archive is preserved.

Hosted verification exposed OpenAlex shared-IP rate limits. Topic searches now query OpenAIRE, Crossref, World Bank, and OpenAlex together. Crossref requires a currently effective Creative Commons license and a public document response check. Its [public API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/) needs no paid account; [reuse licensing is not by itself evidence of free access](https://www.crossref.org/documentation/retrieve-metadata/text-and-data-mining/), so access gates and unusable document responses are excluded. OpenAIRE requires explicit access evidence for the selected copy. Loading states follow the actual request, previous search documents disappear while a new question runs, and a failed or empty search gives a specific explanation.

Search feedback leads with the result: documents added and the collection available. Individual provider failures sit in expandable Search coverage, so an OpenAlex cooldown does not tell the user to retry a completed search. “Find more documents” continues the original question with server-owned pagination; it preserves the existing collection while pending, adds new records first, and survives reloads. Counts distinguish new documents, the cumulative collection, and provider records examined in the last batch. Only 24 collected document rows render initially, with an explicit control to reveal more. A zero-result batch is never described as exhaustive coverage.

RadixAI's Extensive mode sequences up to 20 saved research batches with a visible stop control; Deep runs six and Quick runs one. The 3D web uses real x/y/z layout, perspective projection, depth-sorted nodes, and an orbit camera. Drag rotates; Shift/right-drag pans, and dedicated touch controls expose the same modes. Existing spring motion, worker layout, bounded drawing, and reduced-motion behavior remain. The crawler follows real request destinations in the projected network.

Every crawl has a run overview with exact operational totals and the recorded reason it stopped. The six colored panels use plain labels: Crawl log, Websites, Topic coverage, Word heat, Query match, and Live review. Larger snapshots carry sampling notices. Metadata analysis is cached separately from operational polling so new events do not repeatedly analyze 1,000 page summaries.

### Uiverse components

Applied the user's [Uiverse library](https://uiverse.io/elements) to the real loading and interaction states: fast tactile button feedback, a restrained static dot pattern, and an accessible staggered-bar loading indicator. Exact component URLs, authors, modifications, and MIT notices are preserved in [uiverse-attribution.md](uiverse-attribution.md). The loading state responds to actual pending requests and never adds a simulated progress delay.

### Supervised crawl telemetry

The six-panel strip follows the supplied X video frames: Crawl Log, Sections, Coverage Radar, Word Heat, Spec Score, and Crawler.ts. Charts derive from captured metadata, queue state, and HTTP events; no simulated counters or code typing. The last panel exposes the backend Chief of Staff decision and all four agent verdicts. A separate eight-stage strip advances only when the backend emits a phase. Color is paired with text labels, charts have accessible descriptions, and six columns wrap to three, two, and one across narrower viewports. Metadata analysis is memoized separately from the elapsed clock; SVGs and visible logs are bounded.

Chart labels occupy reserved space outside the data marks: radar terms have outer gutters and the gauge caption sits below its arc. Panel columns wrap according to available container width, with readable minimum widths; timer labels stack instead of squeezing beside long durations.
