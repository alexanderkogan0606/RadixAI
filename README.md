# SIGNAL — Research Crawler

A private research workspace for finance, business, technology, and case studies. It combines a conversational source finder, interactive network graph, persistent crawler, and an exportable source database.

## What is included

- 262 free seed resources across four domains, with descriptions, tags and verification provenance. The complete 371-entry catalog is retained for access classification; paid, mixed and freemium resources are excluded from browsing and recommendations.
- A chat interface with six built-in research use cases covering AI banking deployments, SaaS pricing, mergers and acquisitions, semiconductor supply chains, Apple quarterly filings, and startup failures. All recommendations are free-only; follow-ups such as “more case studies” refine their relevance.
- Live, key-free document discovery from OpenAlex, Crossref, World Bank, and SEC EDGAR, with specific document URLs, abstracts or filing metadata, dates, provenance, and visible provider status. Company report questions use SEC filings with company, form, and reporting-period matching. Results are saved to D1. This is retrieval, not a connected generative language model or full-document synthesis.
- A server-side HTML/RSS/Atom crawler with persistent queues, graph edges, timestamps, logs, canonical URL deduplication within each run, pause/resume, bounded depth and page limits, robots checks, and host throttling.
- A backend Chief of Staff coordinates four independent rule-based checks: source structure, free access, topical relevance, and content quality. Its persisted decision controls whether metadata is retained and outgoing links are explored. No paid model or AI API is required.
- A clearly labeled recorded example from a real crawl (35 public pages, 1,075 discovered URLs, 2,200 hyperlinks) demonstrates the spider in a fresh workspace.
- A neutral workbench with a distinct radial crawler agent moving between real request destinations, a six-panel color telemetry dashboard with HTTP timings, eight event-driven processing stages, anchored URL branching, replay, queue inspection, and keyboard pan/zoom.
- A dedicated Research results area across crawl runs, with search, stable pagination, purpose, practical reading guidance, research context, bookmarks, and access/provenance labels.
- Source inspection, keyword/domain filters, custom URLs, JSON database exports, and CSV catalog exports.
- Cloudflare D1 persistence and per-user authorization through Sites identity headers.

## Run locally

Requires Node.js 22.13+ and npm. Node 24+ is recommended for the SQLite-backed integration tests.

```sh
npm ci
npm run db:generate # only after a schema change; initial migrations are already committed
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_blue_justice.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_discovered_documents.sql
npm run dev
```

Open the printed localhost URL. The local preview uses a loopback-only development user and local D1 storage. The hosted private application uses the authenticated Sites user. Keep production behind the Sites access boundary; do not expose a standalone deployment that blindly trusts externally supplied identity headers.

For subsequent schema changes, generate and apply each **new** migration in order. Do not replay previously applied SQL. Hosted Sites applies committed schema migrations during deployment.

## Use the workspace

1. Ask a research question or pick a built-in use case.
2. Review specific papers and reports in the Documents panel, including the abstract, provider, date, original URL, and free-access evidence. Documents are saved to Results automatically.
3. Choose **Crawl these documents**, review the seed URLs, page budget, depth, and crawl boundary, then launch.
4. Keep the workspace open while the crawl runs. The browser advances a durable server-side queue; closing the tab stops progress, and reopening resumes running jobs. Pause is available in the network view and crawl history.
5. Open **Results** or the completed crawl’s **View research results** button. Each free-source link explains its purpose and how to use it. Filter by crawl, search, save resources, or inspect the captured summary and context.

No unattended schedule or paid API is enabled. Known paid, mixed and freemium seeds and destinations are blocked, and explicit payment or login gates are skipped. Custom public URLs may be crawled, but unmatched access is labeled Unknown and withheld from free results. Access is classified by destination URL and catalog path, with exact-document exceptions backed by stored provider evidence. That evidence never grants access to an entire mixed-access publisher. Catalogued free access is not a guarantee that every full article is available. Historical data remains in the private archive.

For a specific filing, try “Apple latest quarterly report”, “AAPL Q1 2025 quarterly report”, or “Microsoft annual report 2024”. Quarter/year requests use the issuer's fiscal calendar unless you explicitly say “calendar”; titles show the actual period-end date. SEC search covers up to two named SEC-reporting companies and recent filings plus one historical page per company. Missing companies or periods produce an explanation rather than unrelated substitute links. Provider rate limits and access failures are visible in the conversation.

If OpenAlex fails or rate-limits requests, Crossref supplies a free fallback. Only relevant records with actual abstracts, a currently effective Creative Commons license, and a publicly reachable document are admitted. The fallback checks the article/PDF response without credentials, rejects access gates, and retains the original provider failure in the search status. Provider requests are bounded and cached; no paid API or account is required.

## Backend supervision

Every fetched candidate is reviewed by Source Scout, Access Guard, Relevance Reviewer, and Quality Reviewer. The Chief of Staff aggregates their findings into **approve**, **archive** (unconfirmed access, excluded from free Results), **discover** (follow useful links without indexing), or **reject** (do not index or traverse). Each review is stored with the crawl, URL, objective, agent reasons, and time. Failures before extraction explicitly mark content checks as not run. These are deterministic metadata checks, not generative agents or a guarantee of factual accuracy.

The live dashboard shows the latest review, actual event log, per-website progress, metadata-term coverage radar and heatmap, query-term match score, and HTTP durations. The Objective → Sources → Access → Fetch → Extract → Review → Save → Complete strip follows recorded backend stages. Metadata scores are labeled and do not claim to measure full-document truth or quality. Replays use recorded observations.

## Crawl boundaries

The crawler accepts public HTTPS URLs, checks robots.txt, follows at most three redirects, limits each response to 1 MB, and uses bounded requests and per-host delays. It does not bypass paywalls or authentication, execute site JavaScript, extract PDF full text, or archive entire documents. For a successfully fetched PDF with exact provider access evidence, it can retain the provider title/abstract and explicitly labels that metadata basis. Pages that disallow indexing or fail access checks are logged rather than silently counted as successful captures. DNS names are validated and redirects are revalidated; arbitrary hostnames are not resolved and pinned by the application. The hosted runtime's network boundary remains essential.

The spider graph contains real seed URLs and discovered hyperlinks only. Completed crawls can be replayed, explicitly labeled as recorded activity. The source universe is finite and expandable; no exhaustive coverage of the web is claimed.

## Checks

```sh
node --experimental-strip-types --test tests/*.test.ts
npx tsc --noEmit
npm run build
```

Tests cover extraction, robots matching, URL checks, ownership, persistence, pause/resume, feed discovery, free-only policy, explicit paywalls, retrieval, explanatory guidance, stable results pagination beyond dashboard limits, and frame-rate-independent graph motion.

## Project structure

- `app/page.tsx`, `app/graph.tsx`, `app/crawl-dashboard.tsx`, `app/chat.tsx`, `app/results.tsx`: workspace UI
- `app/api/`: same-origin, authenticated database/crawler/chat endpoints
- `lib/crawler.ts`: crawling, extraction, queue, and persistence
- `lib/crawl-supervision.ts`: independent checks, Chief of Staff decisions, and audit format
- `lib/crawl-metrics.ts`, `app/crawl-process.tsx`: bounded telemetry and recorded processing stages
- `lib/research.ts`, `lib/discovery.ts`, `lib/filing-discovery.ts`, `lib/document-availability.ts`, `lib/discovery-store.ts`: live retrieval, provider adapters, company filing lookup, public document checks, and persistent provenance
- `lib/results.ts`: owner-scoped research pagination and filters
- `lib/free-access.ts`, `lib/resource-quality.ts`, `lib/resource-guide.ts`: access classification, quality/relevance gates, and metadata-based reading guidance
- `lib/catalog.json`: source catalog with provenance
- `db/schema.ts`, `drizzle/`: schema and migrations
- `.openai/hosting.json`: Sites project identity and D1 binding (no secrets)

This repository contains code and public source-catalog metadata. Private crawl data, chat transcripts, credentials, local runtime state, build output, and dependency folders are excluded from Git.

Interface rationale and the primary UI design skills applied are documented in [docs/interface-design.md](docs/interface-design.md).
The adapted Uiverse buttons, dot pattern, and loading indicator are credited with their MIT notices in [docs/uiverse-attribution.md](docs/uiverse-attribution.md).
