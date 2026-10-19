# SIGNAL — Research Crawler

A private research workspace for finance, business, technology, and case studies. It combines a conversational source finder, interactive network graph, persistent crawler, and an exportable source database.

## What is included

- 371 distinct seed resources across four domains, with descriptions, tags, access labels, and verification provenance. 100 sources were checked against official page content during catalog research; the remainder are explicitly labeled discovery seeds.
- A chat interface with six built-in research use cases: company deep dives, SaaS pricing, competitive landscapes, AI in banking, market sizing, and startup failures. Follow-ups such as “only free sources” and “more case studies” refine the source recommendations.
- Weighted metadata retrieval over the catalog and captured page summaries. The initial version is key-free retrieval, not a connected generative language model. It does not invent article findings or pretend to have read uncrawled documents.
- A server-side HTML/RSS/Atom crawler with persistent queues, graph edges, timestamps, logs, canonical URL deduplication within each run, pause/resume, bounded depth and page limits, robots checks, and host throttling.
- A clearly labeled recorded example from a real crawl (35 public pages, 1,075 discovered URLs, 2,200 hyperlinks) demonstrates the spider in a fresh workspace.
- A neutral, graph-first workspace with event-driven canvas rendering, real URL branching, replay, queue inspection, and keyboard pan/zoom.
- Interactive source inspection, keyword/domain/access filters, bookmarks, custom sources, JSON database exports, and CSV catalog exports.
- Cloudflare D1 persistence and per-user authorization through Sites identity headers.

## Run locally

Requires Node.js 22.13+ and npm. Node 24+ is recommended for the SQLite-backed integration tests.

```sh
npm ci
npm run db:generate # only after a schema change; initial migrations are already committed
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_blue_justice.sql
npm run dev
```

Open the printed localhost URL. The local preview uses a loopback-only development user and local D1 storage. The hosted private application uses the authenticated Sites user. Keep production behind the Sites access boundary; do not expose a standalone deployment that blindly trusts externally supplied identity headers.

For subsequent schema changes, generate and apply each **new** migration in order. Do not replay previously applied SQL. Hosted Sites applies committed schema migrations during deployment.

## Use the workspace

1. Ask a research question or pick a built-in use case.
2. Inspect the suggested source links. Seed descriptions identify where to research; they are not case-study findings.
3. Choose **Crawl these sources**, review the seed URLs, page budget, depth, and crawl boundary, then launch.
4. Keep the workspace open while the crawl runs. The browser advances a durable server-side queue; closing the tab stops progress, and reopening resumes running jobs. Pause is available in the network view and crawl history.
5. Explore captured metadata and links in the network or indexed-page table. Export source or crawl records when needed.

No unattended schedule or paid API is enabled. Some catalog resources require a third-party subscription. Availability and access labels can change.

## Crawl boundaries

The crawler accepts public HTTPS URLs, checks robots.txt, follows at most three redirects, limits each response to 1 MB, and uses bounded requests and per-host delays. It does not bypass paywalls or authentication, execute site JavaScript, extract PDFs, or archive entire documents. Pages that disallow indexing or fail access checks are logged rather than silently counted as successful captures. DNS names are validated and redirects are revalidated; arbitrary hostnames are not resolved and pinned by the application. The hosted runtime's network boundary remains essential.

The spider graph contains real seed URLs and discovered hyperlinks only. Completed crawls can be replayed, explicitly labeled as recorded activity. The source universe is finite and expandable; no exhaustive coverage of the web is claimed.

## Checks

```sh
node --experimental-strip-types --test tests/*.test.ts
npx tsc --noEmit
npm run build
```

Tests cover extraction, robots matching, URL checks, ownership, persistence, pause/resume, feed discovery, source retrieval, and conversation filters.

## Project structure

- `app/page.tsx`, `app/graph.tsx`, `app/chat.tsx`: workspace UI
- `app/api/`: same-origin, authenticated database/crawler/chat endpoints
- `lib/crawler.ts`: crawling, extraction, queue, and persistence
- `lib/research.ts`: metadata retrieval and research planning
- `lib/catalog.json`: source catalog with provenance
- `db/schema.ts`, `drizzle/`: schema and migrations
- `.openai/hosting.json`: Sites project identity and D1 binding (no secrets)

This repository contains code and public source-catalog metadata. Private crawl data, chat transcripts, credentials, local runtime state, build output, and dependency folders are excluded from Git.

Interface rationale and the primary UI design skills applied are documented in [docs/interface-design.md](docs/interface-design.md).
