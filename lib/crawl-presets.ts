/** Shared browser/server crawl budgets. Every fetched page is still a separate durable step. */
export const CRAWL_LIMITS={minPages:5,maxPages:2000,maxDepth:8,maxSeeds:60,maxQueue:10_000} as const;
export const CRAWL_PRESETS=[
  {id:"focused",label:"Focused",maxPages:100,maxDepth:2,scope:"same-domain",description:"A quick pass through the starting websites."},
  {id:"deep",label:"Deep",maxPages:500,maxDepth:5,scope:"same-domain",description:"Follow the starting websites further. Recommended."},
  {id:"extensive",label:"Extensive",maxPages:2000,maxDepth:8,scope:"linked-domains",description:"Explore further across linked public websites."},
] as const;
export const DEFAULT_CRAWL_PRESET=CRAWL_PRESETS[1];
