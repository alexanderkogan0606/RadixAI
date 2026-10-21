# Contributing to RadixAI

Issues and pull requests are welcome at https://github.com/alexanderkogan0606/RadixAI.

1. Fork the repository and create a branch for your change.
2. Follow the local setup in README.md. Use a fresh local database for development.
3. Keep changes focused and add a regression test for crawler, relevance, access, or persistence fixes.
4. Run the checks below and explain the behavior changed and how you verified it in your pull request.

```sh
node --experimental-strip-types --test tests/*.test.ts
npx tsc --noEmit
npm run build
```

Preserve per-user authorization, robots.txt handling, crawl delays, and free-source filtering. Do not commit credentials, personal research exports, database files, or runtime state. Retain third-party attribution notices.

The checked-in `.openai/hosting.json` identifies the original hosted RadixAI project. Forks must register their own Site before publishing; they must not deploy to the original project ID. A deployment outside Sites needs its own verified authentication boundary; do not trust identity headers supplied directly by visitors.

Contributions are provided under the repository’s MIT License.
