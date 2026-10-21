/** Research Atlas indexes public metadata. It never stores fetched HTML or acts as a proxy. */
import defaultCatalog from "./catalog.json" with { type:"json" };
// @ts-expect-error Node's native TypeScript test runner requires the explicit extension.
import { classifyPageAccess, detectPaywall, isFreeSource, isKnownRestrictedUrl, sourceForUrl } from "./free-access.ts";
// @ts-expect-error Node's native TypeScript test runner requires the explicit extension.
import { assessResource, linkPriority, queryTerms } from "./resource-quality.ts";
// @ts-expect-error Node's native TypeScript test runner requires the explicit extension.
import { AGENT_REVIEW_PREFIX, reviewCrawlCandidate, reviewCrawlFailure, type SupervisionReview } from "./crawl-supervision.ts";
export interface CatalogSource {
  id: string; name: string; url: string; domain: string; category?: string; feedUrl?: string; access?:string; exact?:boolean; title?:string; description?:string;
  provider?:string;query?:string;queryHistory?:string[];
}
type Row = Record<string, unknown>;
type DB = D1Database;
const BOT = "ResearchAtlasBot";
const MAX_BYTES = 1_000_000;
const MAX_QUEUE = 1500;
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
let eventSequence=0;

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
class WaitForHost extends Error {}
class CrawlBlocked extends Error {}
class CrawlSkipped extends Error {}

export function safeUrl(value: unknown, base?: string): string {
  if (typeof value !== "string" || value.length > 2400) throw new ApiError("Enter a valid public HTTPS URL.");
  let u: URL;
  try { u = new URL(value.trim(), base); } catch { throw new ApiError("Enter a valid public HTTPS URL."); }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) {
    throw new ApiError("Only public HTTPS URLs without credentials or custom ports are allowed.");
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  // IP literals, single-label hosts and internal/reserved namespaces are never crawl targets.
  if (!host.includes(".") || host.includes(":") || /^[\d.]+$/.test(host) ||
    !/^[a-z0-9.-]+$/.test(host) || /(^|\.)(localhost|local|internal|home|lan|corp|test|invalid|example|onion)$/.test(host) ||
    /(^|\.)(localtest\.me|lvh\.me|nip\.io|sslip\.io)$/.test(host) ||
    host === "metadata.google.internal" || host.endsWith(".localhost")) {
    throw new ApiError("Local, private, IP-address and reserved hosts cannot be crawled.");
  }
  u.hostname = host;
  u.hash = "";
  for (const key of [...u.searchParams.keys()]) {
    if (/^utm_/i.test(key) || ["fbclid", "gclid", "msclkid"].includes(key.toLowerCase())) u.searchParams.delete(key);
  }
  u.searchParams.sort();
  return u.href;
}

export function inScope(url: string, seedHosts: string[], scope: string): boolean {
  try {
    const host = new URL(safeUrl(url)).hostname.replace(/^www\./, "");
    return scope === "linked-domains" || seedHosts.some(h => h.replace(/^www\./, "") === host);
  } catch { return false; }
}

export function researchDomain(value:unknown,objective=""):string {
  const supported = ["Finance","Business","Technology","Case studies"];
  if (typeof value === "string" && supported.includes(value)) return value;
  if (/case[ -]?stud/i.test(objective)) return "Case studies";
  if (/\b(financ\w*|bank\w*|credit|stock\w*|invest\w*|macro\w*|equity|bond\w*|fund\w*)\b/i.test(objective)) return "Finance";
  if (/\b(tech\w*|software|cloud|AI|artificial intelligence|machine learning|semiconductor\w*|comput\w*)\b/i.test(objective)) return "Technology";
  return "Business";
}

function clean(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi," ")
    .replace(/<[^>]*>/g," ")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_m, n: string) => {
      const code = n[0].toLowerCase() === "x" ? parseInt(n.slice(1),16) : Number(n);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }).replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_m,n: string) => ({amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:" "}[n.toLowerCase()] || ""))
    .replace(/\s+/g," ").trim();
}
function attrs(tag: string): Record<string,string> {
  const result: Record<string,string> = {};
  const expression = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = expression.exec(tag))) result[match[1].toLowerCase()] = clean(match[2] ?? match[3] ?? match[4] ?? "");
  return result;
}
function tagText(doc: string, name: string): string {
  return clean(doc.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,"i"))?.[1] || "");
}
export interface Extracted {
  title: string; description: string; canonicalUrl: string; links: string[];
  linkDetails:{url:string;title:string;description?:string}[];
  feedEntries: {url:string;title:string;description:string}[]; tags: string[];
}

export function extractDocument(body: string, url: string, contentType = "text/html", query = ""): Extracted {
  const links = new Map<string,{url:string;title:string;description?:string}>();
  const entries: Extracted["feedEntries"] = [];
  const addLink = (href: string,title="",description="") => {
    try { const candidate = safeUrl(href,url),detail={url:candidate,title:clean(title).slice(0,300),description:clean(description).slice(0,600)};
      if(candidate!==url&&!/\.(png|jpe?g|gif|svg|webp|css|js|woff2?|zip|exe|mp[34]|ico)(?:\?|$)/i.test(candidate)&&linkPriority(detail,query)>=0){const previous=links.get(candidate);if(!previous||linkPriority(detail,query)>linkPriority(previous,query))links.set(candidate,detail)}
    } catch {}
  };
  let title = "", description = "", canonicalUrl = url;
  const feed = /(?:rss|atom|xml)/i.test(contentType) || /^\s*(?:<\?xml[^>]*>\s*)?<(rss|feed)\b/i.test(body);
  if (feed) {
    title = tagText(body,"title");
    description = tagText(body,"description") || tagText(body,"subtitle");
    const entryPattern = /<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
    let match;
    while ((match = entryPattern.exec(body)) && entries.length < 100) {
      const item = match[2];
      const atomLinks = [...item.matchAll(/<link\b[^>]*>/gi)].map(m=>attrs(m[0]));
      const href = atomLinks.find(a=>a.href && (!a.rel || a.rel === "alternate"))?.href || tagText(item,"link");
      try {
        const itemUrl = safeUrl(href,url);
        entries.push({url:itemUrl,title:tagText(item,"title").slice(0,300),description:(tagText(item,"description") || tagText(item,"summary") || tagText(item,"content")).slice(0,600)});
        addLink(itemUrl,tagText(item,"title"),tagText(item,"description")||tagText(item,"summary")||tagText(item,"content"));
      } catch {}
    }
  } else {
    title = tagText(body,"title");
    const metas = [...body.matchAll(/<meta\b[^>]*>/gi)].map(m=>attrs(m[0]));
    const metadata = (key: string) => metas.find(a => (a.property || a.name || "").toLowerCase() === key)?.content || "";
    title = metadata("og:title") || title || tagText(body,"h1");
    const main=body.match(/<(?:article|main)\b[^>]*>([\s\S]*?)<\/(?:article|main)>/i)?.[1]||body;
    const paragraphs=[...main.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].slice(0,60).map(match=>clean(match[1]));
    const descriptions=[metadata("description"),metadata("og:description"),...paragraphs].filter(Boolean);
    description=descriptions.find(value=>value.length>=28&&!/^(?:we use cookies|this (?:site|website) uses cookies|accept (?:all )?cookies|all rights reserved|copyright)/i.test(value)&&!["access-gate","error"].includes(assessResource({url,title,description:value}).reason||""))||descriptions[0]||"";
    for (const match of body.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>|<link\b[^>]*>/gi)) {
      const opening=match[0].match(/^<[^>]*>/)?.[0]||match[0],a = attrs(opening);
      if (a.rel?.toLowerCase() === "canonical" && a.href) {
        try { const candidate = safeUrl(a.href,url); if (new URL(candidate).hostname === new URL(url).hostname) canonicalUrl = candidate; } catch {}
      }
      if (a.href && !/nofollow/i.test(a.rel || "")) addLink(a.href,clean(match[0].replace(/^<[^>]*>/,""))||a.title||"");
      if (links.size >= 600) break;
    }
  }
  const words=new Set(queryTerms(`${title} ${description}`)),linkDetails=[...links.values()].sort((a,b)=>linkPriority(b,query)-linkPriority(a,query)).slice(0,120);
  return {title:(title || new URL(url).hostname).slice(0,300),description:description.slice(0,600),canonicalUrl,links:linkDetails.map(link=>link.url),linkDetails,feedEntries:entries,tags:queryTerms(query).filter(word=>words.has(word))};
}

export function robotsRules(text: string, path: string, agent = BOT): {allowed:boolean;delayMs:number} {
  const groups: {agents:string[];rules:{allow:boolean;path:string}[];delay:number}[] = [];
  let group: typeof groups[number] | undefined;
  let hasDirectives = false;
  for (const line of text.split(/\r?\n/)) {
    const withoutComment = line.replace(/#.*$/,"").trim();
    const at = withoutComment.indexOf(":"); if (at < 0) continue;
    const key = withoutComment.slice(0,at).trim().toLowerCase();
    const value = withoutComment.slice(at+1).trim();
    if (key === "user-agent") {
      if (!group || hasDirectives) { group = {agents:[],rules:[],delay:1000}; groups.push(group); hasDirectives = false; }
      if (value) group.agents.push(value.toLowerCase());
    } else if (group) {
      hasDirectives = true;
      if ((key === "allow" || key === "disallow") && value) group.rules.push({allow:key === "allow",path:value});
      if (key === "crawl-delay" && /^\d+(\.\d+)?$/.test(value)) group.delay = Math.max(1000,Number(value)*1000);
    }
  }
  const specificity = (g:typeof groups[number]) => Math.max(0,...g.agents.filter(a=>a !== "*" && agent.toLowerCase().includes(a)).map(a=>a.length));
  const longestAgent = Math.max(0,...groups.map(specificity));
  const selected = longestAgent ? groups.filter(g=>specificity(g) === longestAgent) : groups.filter(g=>g.agents.includes("*"));
  let best = -1, allowed = true;
  for (const g of selected) for (const rule of g.rules) {
    const expression = "^" + rule.path.split("*").map(p=>p.replace(/[.+?^${}()|[\]\\]/g,"\\$&")).join(".*").replace(/\\\$$/,"$");
    if (new RegExp(expression).test(path)) {
      const length = rule.path.replace(/\*/g,"").length;
      if (length > best || (length === best && rule.allow)) { best = length; allowed = rule.allow; }
    }
  }
  return {allowed,delayMs:Math.max(1000,...selected.map(g=>g.delay))};
}

function statement(db: DB, sql: string, ...params: unknown[]) { return db.prepare(sql).bind(...params); }
async function all(db: DB, sql: string, ...params: unknown[]): Promise<Row[]> { return (await statement(db,sql,...params).all<Row>()).results; }
async function first(db: DB, sql: string, ...params: unknown[]): Promise<Row|null> { return statement(db,sql,...params).first<Row>(); }
function eventStatement(db:DB,user:string,job:string,level:string,message:string,url:string|null=null,messageLimit=900) {
  const timestamp=Date.now(),id=`${String(timestamp).padStart(13,"0")}-${String(eventSequence++).padStart(10,"0")}-${uid()}`;
  return statement(db,"INSERT INTO atlas_events(id,user_id,job_id,time,level,message,url) VALUES(?,?,?,?,?,?,?)",id,user,job,new Date(timestamp).toISOString(),level,message.slice(0,messageLimit),url);
}
type CrawlStage="objective"|"sources"|"access"|"fetch"|"extract"|"review"|"save"|"complete";
function stageStatement(db:DB,user:string,job:string,stage:CrawlStage,message:string,url:string|null=null){
  return eventStatement(db,user,job,"info",`Stage · ${stage} · ${message}`,url);
}
function agentReviewStatement(db:DB,user:string,job:string,review:SupervisionReview){
  return eventStatement(db,user,job,review.decision==="approve"?"success":"info",AGENT_REVIEW_PREFIX+JSON.stringify(review),review.url,16000);
}
function queueStatement(db:DB,user:string,job:string,source:CatalogSource,url:string,depth:number,parent:string|null) {
  return statement(db,"INSERT OR IGNORE INTO atlas_queue(id,user_id,job_id,source_id,url,domain,category,depth,parent_url,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,'queued',?)",uid(),user,job,source.id,url,source.domain,source.category || "Custom sources",depth,parent,now());
}

export function publicJob(row: Row): Row {
  return {id:row.id,query:row.query,status:row.status,scope:row.scope,maxPages:row.max_pages,maxDepth:row.max_depth,processed:row.processed,indexed:row.indexed,errors:row.errors,queued:row.queued || 0,createdAt:row.created_at,updatedAt:row.updated_at};
}
function publicPage(row:Row):Row {
  return {id:row.id,url:row.url,title:row.title,description:row.description,domain:row.domain,category:row.category,sourceId:row.source_id,jobId:row.job_id,depth:row.depth,parentUrl:row.parent_url,fetchedAt:row.fetched_at,status:row.status,access:classifyPageAccess({url:String(row.url)},defaultCatalog),tags:JSON.parse(String(row.tags || "[]"))};
}
function customSource(row:Row):Row {
  return {id:row.id,name:row.name,url:row.url,domain:row.domain,category:"Custom sources",type:"Research library",access:classifyPageAccess({url:String(row.url)},defaultCatalog),description:"Source added to your personal research catalog.",tags:["custom"],geography:"Global",crawlMethod:"Manual",verification:"Discovery seed",provenanceUrl:null,createdAt:row.created_at};
}
async function getJob(db:DB,user:string,id:string) {
  const row = await first(db,"SELECT j.*, (SELECT count(*) FROM atlas_queue q WHERE q.job_id=j.id AND q.status IN ('queued','processing')) AS queued FROM atlas_jobs j WHERE j.id=? AND j.user_id=?",id,user);
  if (!row) throw new ApiError("Crawl job not found.",404);
  return row;
}
export async function readState(db:DB,user:string) {
  // One D1 request provides a consistent snapshot instead of a separate RPC for every panel.
  const results=await db.batch<Row>([
    statement(db,"SELECT j.*, (SELECT count(*) FROM atlas_queue q WHERE q.job_id=j.id AND q.status IN ('queued','processing')) AS queued FROM atlas_jobs j WHERE user_id=? ORDER BY created_at DESC LIMIT 100",user),
    statement(db,"SELECT * FROM atlas_pages WHERE user_id=? ORDER BY fetched_at DESC LIMIT 2000",user),
    statement(db,"SELECT * FROM atlas_events WHERE user_id=? ORDER BY time DESC,id DESC LIMIT 500",user),
    statement(db,"SELECT source,target,job_id AS jobId FROM atlas_edges WHERE user_id=? LIMIT 5000",user),
    statement(db,"SELECT * FROM atlas_sources WHERE user_id=? ORDER BY created_at DESC",user),
    statement(db,"SELECT resource_id FROM atlas_bookmarks WHERE user_id=?",user),
    statement(db,"SELECT (SELECT COUNT(*) FROM atlas_pages WHERE user_id=?) AS pages,COUNT(*) AS jobs,COALESCE(SUM(processed),0) AS processed,COALESCE(SUM(indexed),0) AS indexed,COALESCE(SUM(errors),0) AS errors,(SELECT COUNT(*) FROM atlas_queue WHERE user_id=? AND status IN ('queued','processing')) AS queued,(SELECT COUNT(*) FROM atlas_queue WHERE user_id=?) AS frontier FROM atlas_jobs WHERE user_id=?",user,user,user,user),
    statement(db,"SELECT p.* FROM atlas_pages p JOIN atlas_bookmarks b ON b.resource_id=p.id AND b.user_id=p.user_id WHERE p.user_id=? AND b.user_id=? ORDER BY p.fetched_at DESC",user,user),
    statement(db,"WITH recent AS (SELECT id,status,created_at FROM atlas_jobs WHERE user_id=? ORDER BY CASE WHEN status='running' THEN 0 WHEN status='paused' THEN 1 ELSE 2 END,created_at DESC LIMIT 3) SELECT q.id,q.url,q.parent_url AS parentUrl,q.source_id AS sourceId,q.status,q.depth,q.job_id AS jobId,q.domain FROM atlas_queue q JOIN recent j ON j.id=q.job_id WHERE q.user_id=? ORDER BY CASE WHEN j.status='running' THEN 0 WHEN j.status='paused' THEN 1 ELSE 2 END,j.created_at DESC,q.depth,q.created_at DESC LIMIT 3000",user,user),
  ]);
  const [jobRows,pageRows,eventRows,edgeRows,sourceRows,bookmarkRows,countRows,savedRows,frontierRows]=results.map(result=>result.results);
  return {jobs:jobRows.map(publicJob),pages:pageRows.map(publicPage),events:eventRows.map(r=>({id:r.id,jobId:r.job_id,time:r.time,level:r.level,message:r.message,url:r.url})),edges:edgeRows,customSources:sourceRows.map(customSource),bookmarks:bookmarkRows.map(r=>r.resource_id),counts:countRows[0],savedPages:savedRows.map(publicPage),frontier:frontierRows};
}

/** A selected historical run must not depend on the bounded cross-run dashboard snapshot. */
export async function readRun(db:DB,user:string,id:string){
  const results=await db.batch<Row>([
    statement(db,"SELECT j.*, (SELECT COUNT(*) FROM atlas_queue q WHERE q.job_id=j.id AND q.status IN ('queued','processing')) AS queued FROM atlas_jobs j WHERE j.id=? AND j.user_id=?",id,user),
    statement(db,"SELECT * FROM atlas_pages WHERE user_id=? AND job_id=? ORDER BY depth,fetched_at,id LIMIT 300",user,id),
    statement(db,"SELECT source,target,job_id AS jobId FROM atlas_edges WHERE user_id=? AND job_id=? ORDER BY source,target LIMIT 5000",user,id),
    statement(db,"SELECT id,url,parent_url AS parentUrl,source_id AS sourceId,status,depth,job_id AS jobId,domain FROM atlas_queue WHERE user_id=? AND job_id=? ORDER BY depth,created_at,id LIMIT 1500",user,id),
    statement(db,"SELECT id,job_id AS jobId,time,level,message,url FROM atlas_events WHERE user_id=? AND job_id=? ORDER BY time DESC,id DESC LIMIT 500",user,id),
    statement(db,"SELECT (SELECT COUNT(*) FROM atlas_pages WHERE user_id=? AND job_id=?) AS pages,(SELECT COUNT(*) FROM atlas_edges WHERE user_id=? AND job_id=?) AS edges,(SELECT COUNT(*) FROM atlas_queue WHERE user_id=? AND job_id=?) AS frontier,(SELECT COUNT(*) FROM atlas_events WHERE user_id=? AND job_id=?) AS events",user,id,user,id,user,id,user,id),
  ]);
  const [jobs,pages,edges,frontier,events,totals]=results.map(result=>result.results);
  if(!jobs.length)throw new ApiError("Crawl job not found.",404);
  const counts=totals[0];
  return {job:publicJob(jobs[0]),pages:pages.map(publicPage),edges,frontier,events,counts,
    truncated:{pages:Number(counts.pages)>pages.length,edges:Number(counts.edges)>edges.length,frontier:Number(counts.frontier)>frontier.length,events:Number(counts.events)>events.length}};
}

/** Full exports use a stable keyset rather than the bounded UI snapshot queries. */
export async function* exportDataChunks(db:DB,user:string,kind:string,catalog:CatalogSource[]):AsyncGenerator<string> {
  const queries:Record<string,{sql:string;key:string;map:(row:Row)=>unknown}> = {
    sources:{sql:"SELECT id,name,url,domain,created_at FROM atlas_sources WHERE user_id=? AND id>? ORDER BY id LIMIT 250",key:"id",map:customSource},
    jobs:{sql:"SELECT j.*, (SELECT COUNT(*) FROM atlas_queue q WHERE q.job_id=j.id AND q.status IN ('queued','processing')) AS queued FROM atlas_jobs j WHERE j.user_id=? AND j.id>? ORDER BY j.id LIMIT 250",key:"id",map:publicJob},
    pages:{sql:"SELECT * FROM atlas_pages WHERE user_id=? AND id>? ORDER BY id LIMIT 250",key:"id",map:publicPage},
    documents:{sql:"SELECT * FROM atlas_documents WHERE user_id=? AND id>? ORDER BY id LIMIT 250",key:"id",map:r=>{const {user_id,...document}=r;void user_id;return document}},
    edges:{sql:"SELECT id,job_id AS jobId,source,target FROM atlas_edges WHERE user_id=? AND id>? ORDER BY id LIMIT 250",key:"id",map:r=>r},
    events:{sql:"SELECT id,job_id AS jobId,time,level,message,url FROM atlas_events WHERE user_id=? AND id>? ORDER BY id LIMIT 250",key:"id",map:r=>r},
    bookmarks:{sql:"SELECT resource_id FROM atlas_bookmarks WHERE user_id=? AND resource_id>? ORDER BY resource_id LIMIT 250",key:"resource_id",map:r=>r.resource_id},
    messages:{sql:"SELECT id,role,content,metadata,created_at FROM atlas_chat WHERE user_id=? AND id>? ORDER BY id LIMIT 250",key:"id",map:r=>{
      let metadata:Row={};try{metadata=JSON.parse(String(r.metadata || "{}"));}catch{}
      return {id:r.id,role:r.role,content:r.content,metadata,createdAt:r.created_at};
    }},
  };
  async function* array(name:string):AsyncGenerator<string> {
    yield "[";
    let firstChunk=true;
    if(name === "sources") for(let offset=0;offset<catalog.length;offset+=250){
      yield (firstChunk?"":",")+catalog.slice(offset,offset+250).map(row=>JSON.stringify(row)).join(",");firstChunk=false;
    }
    const query=queries[name];
    let after="";
    while(true){
      const rows=await all(db,query.sql,user,after);
      if(!rows.length)break;
      yield (firstChunk?"":",")+rows.map(row=>JSON.stringify(query.map(row))).join(",");
      firstChunk=false;
      after=String(rows[rows.length-1][query.key]);
      if(rows.length<250)break;
    }
    yield "]";
  }
  if(kind === "pages"){yield* array("pages");return;}
  yield `{"exportedAt":${JSON.stringify(now())}`;
  for(const name of ["sources","jobs","pages","documents","edges","events","bookmarks","messages"]){
    yield `,${JSON.stringify(name)}:`;
    yield* array(name);
  }
  yield "}";
}

export async function createJob(db:DB,user:string,input:Row,catalog:CatalogSource[]) {
  const query = typeof input.query === "string" ? input.query.trim().slice(0,300) : "";
  const maxPages = Number(input.maxPages ?? 30), maxDepth = Number(input.maxDepth ?? 1);
  if (!Number.isInteger(maxPages) || maxPages < 5 || maxPages > 300) throw new ApiError("Page limit must be between 5 and 300.");
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 3) throw new ApiError("Crawl depth must be between 0 and 3.");
  const scope = input.scope ?? "same-domain";
  if (scope !== "same-domain" && scope !== "linked-domains") throw new ApiError("Choose a valid crawl scope.");
  const ids = Array.isArray(input.sourceIds) ? [...new Set(input.sourceIds.map(String))] : [];
  const urls = Array.isArray(input.urls) ? [...new Set(input.urls.map(v=>safeUrl(v)))] : [];
  if (ids.length + urls.length > 30) throw new ApiError("Choose up to 30 starting sources or URLs per crawl.");
  const custom = await all(db,"SELECT * FROM atlas_sources WHERE user_id=?",user);
  const catalogIds=new Set(catalog.map(source=>source.id));
  const accessCatalog=[...catalog,...defaultCatalog];
  const sourceMap = new Map<string,CatalogSource>([...catalog,...custom.map((r):CatalogSource=>({id:String(r.id),name:String(r.name),url:String(r.url),domain:String(r.domain),category:"Custom sources"}))].map(s=>[s.id,s]));
  const seeds: {source:CatalogSource;url:string}[] = [];
  for (const id of ids) {
    const source = sourceMap.get(id); if (!source) throw new ApiError("A selected source is no longer available.");
    if(catalogIds.has(id)&&!isFreeSource(source))throw new ApiError(`${source.name} is not listed as Free. Choose a free source.`);
    if(isKnownRestrictedUrl(source.url,accessCatalog)||isKnownRestrictedUrl(source.feedUrl||source.url,accessCatalog))throw new ApiError(`${source.name} requires paid or mixed access. Choose a free source.`);
    seeds.push({source,url:safeUrl(source.feedUrl || source.url)});
  }
  for (const url of urls) {
    if(isKnownRestrictedUrl(url,accessCatalog))throw new ApiError("This URL belongs to a paid or mixed-access source. Choose a free source or another public URL.");
    seeds.push({source:{id:"url:"+new URL(url).hostname,name:new URL(url).hostname,url,domain:researchDomain(input.domain,query),category:"Custom sources",access:classifyPageAccess({url},accessCatalog)},url});
  }
  if (!seeds.length) throw new ApiError("Select at least one source or enter a starting URL.");
  const id = uid(), time = now(), seedHosts = [...new Set(seeds.flatMap(s=>[new URL(s.url).hostname,new URL(safeUrl(s.source.url)).hostname]))];
  const active = await first(db,"SELECT count(*) AS total FROM atlas_jobs WHERE user_id=? AND status IN ('running','paused')",user);
  if (Number(active?.total) >= 10) throw new ApiError("Finish an existing crawl before starting another; up to 10 active crawls are supported.");
  await db.batch([
    statement(db,"INSERT INTO atlas_jobs(id,user_id,query,status,scope,max_pages,max_depth,processed,indexed,errors,seed_hosts,created_at,updated_at,lease_until) VALUES(?,?,?,'running',?,?,?,0,0,0,?,?,?,0)",id,user,query,scope,maxPages,maxDepth,JSON.stringify(seedHosts),time,time),
    ...seeds.map(s=>queueStatement(db,user,id,s.source,s.url,0,null)),
    stageStatement(db,user,id,"objective",query?`Validated research objective: ${query}`:"Validated a public research metadata crawl."),
    stageStatement(db,user,id,"sources",`Validated ${seeds.length} starting source${seeds.length===1?"":"s"}, ${scope==="same-domain"?"selected-domain":"linked-domain"} scope, depth ${maxDepth}, and a ${maxPages}-page limit.`,seeds[0].url),
    eventStatement(db,user,id,"info",`Started crawl with ${seeds.length} starting sources, depth ${maxDepth}, and a ${maxPages}-page limit.`),
  ]);
  return {job:publicJob(await getJob(db,user,id))};
}

async function reserveHost(db:DB,host:string,knownState?:Row) {
  let state=knownState || await first(db,"SELECT * FROM atlas_hosts WHERE host=?",host);
  if(!state){
    await statement(db,"INSERT OR IGNORE INTO atlas_hosts(host,next_allowed_at,crawl_delay) VALUES(?,0,1000)",host).run();
    state=await first(db,"SELECT * FROM atlas_hosts WHERE host=?",host);
  }
  const delay = Number(state?.next_allowed_at || 0)-Date.now();
  if (delay > 1800) throw new WaitForHost("Waiting for the source's crawl delay.");
  if (delay > 0) await new Promise(resolve=>setTimeout(resolve,delay+15));
  const timestamp = Date.now();
  const update = await statement(db,"UPDATE atlas_hosts SET next_allowed_at=?+MAX(crawl_delay,1000) WHERE host=? AND next_allowed_at<=?",timestamp,host,timestamp).run();
  if (!update.meta.changes) throw new WaitForHost("Another crawl is accessing this host; retry shortly.");
}

async function responseText(response:Response):Promise<string> {
  if (Number(response.headers.get("content-length") || 0) > MAX_BYTES) { await response.body?.cancel(); throw new CrawlSkipped("Page exceeds the 1 MB metadata-fetch limit."); }
  if (!response.body) return "";
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, result = "";
  try {
    while (true) {
      const {done,value} = await reader.read(); if (done) break;
      bytes += value.length;
      if (bytes > MAX_BYTES) { await reader.cancel(); throw new CrawlSkipped("Page exceeds the 1 MB metadata-fetch limit."); }
      result += decoder.decode(value,{stream:true});
    }
    return result + decoder.decode();
  } finally { reader.releaseLock(); }
}

async function fetchText(db:DB,url:string,robots=false,seedHosts:string[]=[],scope="linked-domains",catalog:CatalogSource[]=defaultCatalog,onStage?:(stage:"access"|"fetch",url:string)=>Promise<void>):Promise<{url:string;body:string;status:number;contentType:string;noindex:boolean;nofollow:boolean;metadataSource?:CatalogSource}> {
  let current = safeUrl(url);
  for (let redirects=0;redirects<=3;redirects++) {
    if(!robots)await onStage?.("access",current);
    if (!robots && !inScope(current,seedHosts,scope)) throw new CrawlSkipped("Redirect leaves the selected crawl scope.");
    if(!robots&&isKnownRestrictedUrl(current,catalog))throw new CrawlSkipped("Known paid or mixed-access destination skipped by the free-only policy.");
    const hostState=!robots ? await checkRobots(db,current) : undefined;
    await reserveHost(db,new URL(current).hostname,hostState);
    if(!robots)await onStage?.("fetch",current);
    const response = await fetch(current,{redirect:"manual",signal:AbortSignal.timeout(8000),headers:{"User-Agent":`${BOT}/1.0 (public research metadata; respects robots.txt)`,Accept:robots?"text/plain":"text/html,application/rss+xml,application/atom+xml,application/xml;q=0.8"}});
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get("location"); await response.body?.cancel();
      if (!location) throw new CrawlSkipped("Redirect did not include a destination.");
      current = safeUrl(location,current); continue;
    }
    const contentType = response.headers.get("content-type") || "";
    const knownDocument=!robots&&/application\/pdf/i.test(contentType)?sourceForUrl(current,catalog) as CatalogSource|undefined:undefined;
    if(response.ok&&knownDocument?.exact&&knownDocument.access==="Free"){
      await response.body?.cancel();
      return {url:current,body:"",status:response.status,contentType,noindex:/\b(noindex|none)\b/i.test(response.headers.get("x-robots-tag")||""),nofollow:true,metadataSource:knownDocument};
    }
    if (!robots && response.ok && !/html|xml|rss|atom|text\/plain/i.test(contentType)) {
      await response.body?.cancel(); throw new CrawlSkipped("File type is not supported by this metadata crawler.");
    }
    const body = response.ok ? await responseText(response) : "";
    if (!response.ok) await response.body?.cancel();
    const directives = response.headers.get("x-robots-tag") || "";
    return {url:current,body,status:response.status,contentType,noindex:/\b(noindex|none)\b/i.test(directives),nofollow:/\b(nofollow|none)\b/i.test(directives)};
  }
  throw new CrawlSkipped("Redirect limit reached.");
}

async function checkRobots(db:DB,url:string) {
  const u = new URL(url), host = u.hostname;
  let row = await first(db,"SELECT * FROM atlas_hosts WHERE host=?",host);
  if(!row){
    await statement(db,"INSERT OR IGNORE INTO atlas_hosts(host,next_allowed_at,crawl_delay) VALUES(?,0,1000)",host).run();
  }
  if (!row?.robots_fetched_at || Date.now()-Number(row.robots_fetched_at)>3_600_000) {
    const fetched = await fetchText(db,`${u.origin}/robots.txt`,true);
    let robotsText = fetched.body;
    if (fetched.status === 404 || fetched.status === 410) robotsText = "";
    else if (fetched.status < 200 || fetched.status >= 300) throw new CrawlBlocked(`Could not establish robots permission (HTTP ${fetched.status}); source was not fetched.`);
    const parsed = robotsRules(robotsText,u.pathname+u.search);
    await statement(db,"UPDATE atlas_hosts SET robots_text=?,robots_status=?,robots_fetched_at=?,crawl_delay=?,next_allowed_at=MAX(next_allowed_at,?) WHERE host=?",robotsText,fetched.status,Date.now(),parsed.delayMs,Date.now()+parsed.delayMs,host).run();
    row=await first(db,"SELECT * FROM atlas_hosts WHERE host=?",host);
  }
  const rules = robotsRules(String(row?.robots_text || ""),u.pathname+u.search);
  if (!rules.allowed) throw new CrawlBlocked("Blocked by the source's robots.txt rules.");
  return row || undefined;
}

export async function stepJob(db:DB,user:string,id:string,catalog:CatalogSource[]=defaultCatalog) {
  const job = await getJob(db,user,id);
  if (job.status !== "running") return {job:publicJob(job)};
  const lease = await statement(db,"UPDATE atlas_jobs SET lease_until=? WHERE id=? AND user_id=? AND status='running' AND lease_until<?",Date.now()+90_000,id,user,Date.now()).run();
  if (!lease.meta.changes) return {job:publicJob(job),waiting:true};
  let item:Row|null = null;
  let currentUrl="",candidateReview:SupervisionReview|undefined;
  try {
    // A failed browser request can leave a processing item behind; the expired job lease makes it retryable.
    await statement(db,"UPDATE atlas_queue SET status='queued' WHERE job_id=? AND user_id=? AND status='processing'",id,user).run();
    if (Number(job.processed) >= Number(job.max_pages)) {
      await finishJob(db,user,id,"Page limit reached."); return {job:publicJob(await getJob(db,user,id))};
    }
    const candidates=await all(db,"SELECT * FROM atlas_queue WHERE job_id=? AND user_id=? AND status='queued' ORDER BY depth,created_at,id LIMIT 120",id,user);
    candidates.sort((a,b)=>Number(a.depth)-Number(b.depth)||linkPriority({url:String(b.url)},String(job.query))-linkPriority({url:String(a.url)},String(job.query)));
    item=candidates[0]||null;
    if (!item) { await finishJob(db,user,id,"All discovered URLs have been processed."); return {job:publicJob(await getJob(db,user,id))}; }
    const initialUrl=String(item.url);currentUrl=initialUrl;
    await db.batch([statement(db,"UPDATE atlas_queue SET status='processing' WHERE id=? AND user_id=?",item.id,user),eventStatement(db,user,id,"info",`Fetching ${initialUrl}`,initialUrl),stageStatement(db,user,id,"access",`Checking public access, crawl scope and robots rules for ${initialUrl}`,initialUrl)]);
    const fetchStarted=Date.now();
    let firstAccess=true;
    const fetched = await fetchText(db,initialUrl,false,JSON.parse(String(job.seed_hosts)),String(job.scope),catalog,async(stage,url)=>{
      currentUrl=url;
      if(stage==="access"&&firstAccess){firstAccess=false;return;}
      await stageStatement(db,user,id,stage,stage==="access"?`Checking public access, crawl scope and robots rules for ${url}`:`Requesting document ${url}`,url).run();
    });
    const fetchSummary=`HTTP ${fetched.status} · ${Date.now()-fetchStarted} ms`;
    const accessGate=detectPaywall(fetched.body,fetched.status,fetched.contentType);
    if(accessGate)throw new CrawlSkipped(accessGate);
    if ([401,403,429].includes(fetched.status)) throw new CrawlBlocked(`Source returned HTTP ${fetched.status}; access restrictions were respected.`);
    if (fetched.status < 200 || fetched.status >= 300) throw new Error(`Source returned HTTP ${fetched.status}.`);
    const robotMetas = [...fetched.body.matchAll(/<meta\b[^>]*>/gi)].map(m=>attrs(m[0]))
      .filter(a=>["robots",BOT.toLowerCase()].includes((a.name || "").toLowerCase()));
    const noindex = fetched.noindex || robotMetas.some(a=>/\b(noindex|none)\b/i.test(a.content || ""));
    if (noindex) throw new CrawlSkipped("Source requests no indexing; metadata was not saved.");
    await stageStatement(db,user,id,"extract",fetched.metadataSource?`Preparing provider metadata for ${fetched.url}; PDF text is not extracted.`:`Reading metadata and links from ${fetched.url}`,fetched.url).run();
    const extracted:Extracted=fetched.metadataSource?{title:fetched.metadataSource.title||fetched.metadataSource.name,description:fetched.metadataSource.description||"",canonicalUrl:fetched.url,links:[],linkDetails:[],feedEntries:[],tags:[]} : extractDocument(fetched.body,fetched.url,fetched.contentType,String(job.query));
    await stageStatement(db,user,id,"review",`Checking relevance, access rules and metadata quality for ${extracted.canonicalUrl}`,extracted.canonicalUrl).run();
    const provenance=sourceForUrl(extracted.canonicalUrl,catalog) as CatalogSource|undefined;
    const validatedFiling=provenance?.exact===true&&provenance.provider==="SEC EDGAR"&&[provenance.query,...(provenance.queryHistory||[])].some(query=>typeof query==="string"&&query.trim().toLowerCase()===String(job.query).trim().toLowerCase());
    candidateReview=await reviewCrawlCandidate({url:extracted.canonicalUrl,title:extracted.title,description:extracted.description,query:String(job.query),access:classifyPageAccess({url:extracted.canonicalUrl},catalog),validatedFiling});
    const review=candidateReview,quality=review.quality,storeMetadata=review.storeMetadata;
    if(!review.allowDiscovery)throw new CrawlSkipped(`${fetchSummary} · ${review.reason}; not indexed.`);
    const source:CatalogSource = {id:String(item.source_id),name:"",url:String(item.url),domain:String(item.domain),category:String(item.category)};
    const existing = storeMetadata?await first(db,"SELECT * FROM atlas_pages WHERE user_id=? AND job_id=? AND url=?",user,id,extracted.canonicalUrl):null;
    const pageId = existing?.id || uid();
    const fetchedAt=now();
    const page=existing || {id:pageId,url:extracted.canonicalUrl,title:extracted.title,description:extracted.description,domain:item.domain,category:item.category,source_id:item.source_id,job_id:id,tags:JSON.stringify(extracted.tags),depth:item.depth,parent_url:item.parent_url,fetched_at:fetchedAt,status:"indexed"};
    const commands:D1PreparedStatement[] = [];
    if (storeMetadata&&!existing) commands.push(statement(db,"INSERT INTO atlas_pages(id,user_id,job_id,source_id,url,title,description,domain,category,tags,depth,parent_url,fetched_at,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'indexed')",pageId,user,id,item.source_id,extracted.canonicalUrl,extracted.title,extracted.description,item.domain,item.category,JSON.stringify(extracted.tags),item.depth,item.parent_url,fetchedAt));
    const depth = Number(item.depth)+1;
    const nofollow = fetched.nofollow || robotMetas.some(a=>/\b(nofollow|none)\b/i.test(a.content || ""));
    if (review.allowDiscovery&&!nofollow && depth <= Number(job.max_depth) && extracted.links.length) {
      const queueSize = await first(db,"SELECT count(*) AS total FROM atlas_queue WHERE job_id=?",id);
      let remaining = Math.max(0,MAX_QUEUE-Number(queueSize?.total || 0));
      for (const link of extracted.links) {
      if (!remaining) break;
      if (!inScope(link,JSON.parse(String(job.seed_hosts)),String(job.scope))) continue;
      const detail=extracted.linkDetails.find(item=>item.url===link)||{url:link};
      if(linkPriority(detail,String(job.query))<0||((quality.reason==="off-topic"||quality.reason==="insufficient-content")&&queryTerms(String(job.query)).length&&linkPriority(detail,String(job.query))<10))continue;
      remaining--;
      commands.push(queueStatement(db,user,id,source,link,depth,extracted.canonicalUrl));
      commands.push(statement(db,"INSERT OR IGNORE INTO atlas_edges(id,user_id,job_id,source,target) VALUES(?,?,?,?,?)",uid(),user,id,extracted.canonicalUrl,link));
      }
    }
    commands.push(statement(db,"UPDATE atlas_queue SET status='done' WHERE id=?",item.id));
    commands.push(statement(db,"UPDATE atlas_jobs SET processed=processed+1,indexed=indexed+?,updated_at=? WHERE id=?",storeMetadata&&!existing?1:0,now(),id));
    const outcome=!storeMetadata?`Discovery only (${quality.reason}); not indexed: ${extracted.title}`:existing?"Duplicate canonical URL skipped.":fetched.metadataSource?`Indexed provider metadata: ${extracted.title}; PDF full text was not extracted.`:`Indexed metadata: ${extracted.title}`;
    await stageStatement(db,user,id,"save",`Persisting queue, links and eligible metadata for ${extracted.canonicalUrl}`,extracted.canonicalUrl).run();
    commands.push(agentReviewStatement(db,user,id,review));
    commands.push(eventStatement(db,user,id,storeMetadata?"success":"info",`${fetchSummary} · ${outcome}`,String(item.url)));
    // Keep individual D1 batches comfortably below statement limits.
    for (let i=0;i<commands.length;i+=70) await db.batch(commands.slice(i,i+70));
    const updatedJob=await completeIfDone(db,user,id);
    return {job:publicJob(updatedJob),...(storeMetadata?{page:publicPage(page)}:{quality})};
  } catch(error) {
    if (item && error instanceof WaitForHost) {
      await db.batch([statement(db,"UPDATE atlas_queue SET status='queued' WHERE id=? AND user_id=?",item.id,user),eventStatement(db,user,id,"info",error.message,currentUrl||String(item.url))]);
      return {job:publicJob(await getJob(db,user,id)),waiting:true};
    }
    if (item) {
      const status = error instanceof CrawlBlocked ? "blocked" : error instanceof CrawlSkipped ? "skipped" : "error";
      const message = error instanceof Error ? error.message : "The source could not be fetched.";
      await db.batch([
        statement(db,"UPDATE atlas_queue SET status=? WHERE id=?",status,item.id),
        statement(db,"UPDATE atlas_jobs SET processed=processed+1,errors=errors+1,updated_at=? WHERE id=?",now(),id),
        agentReviewStatement(db,user,id,candidateReview||reviewCrawlFailure(currentUrl||String(item.url),String(job.query),message)),
        eventStatement(db,user,id,status,message,currentUrl||String(item.url)),
      ]);
      return {job:publicJob(await completeIfDone(db,user,id))};
    }
    throw error;
  } finally { await statement(db,"UPDATE atlas_jobs SET lease_until=0 WHERE id=? AND user_id=?",id,user).run(); }
}

async function completeIfDone(db:DB,user:string,id:string) {
  const job = await getJob(db,user,id);
  const message=Number(job.processed)>=Number(job.max_pages) ? "Page limit reached; remaining discoveries were skipped." : !Number(job.queued) ? "All discovered URLs have been processed." : "";
  if(message){
    const finishedAt=await finishJob(db,user,id,message);
    return {...job,status:"completed",queued:0,updated_at:finishedAt};
  }
  return job;
}
async function finishJob(db:DB,user:string,id:string,message:string) {
  const finishedAt=now();
  await db.batch([
    statement(db,"UPDATE atlas_jobs SET status='completed',updated_at=? WHERE id=? AND user_id=?",finishedAt,id,user),
    statement(db,"UPDATE atlas_queue SET status='skipped' WHERE job_id=? AND user_id=? AND status='queued'",id,user),
    eventStatement(db,user,id,"info",message),
    stageStatement(db,user,id,"complete",message),
  ]);
  return finishedAt;
}
export async function controlJob(db:DB,user:string,id:string,action:unknown) {
  const job = await getJob(db,user,id);
  if (action !== "pause" && action !== "resume") throw new ApiError("Choose pause or resume.");
  if (job.status === "completed") throw new ApiError("This crawl is complete. Start a new crawl to revisit the sources.");
  const status = action === "pause" ? "paused" : "running";
  await db.batch([
    statement(db,"UPDATE atlas_jobs SET status=?,updated_at=? WHERE id=? AND user_id=?",status,now(),id,user),
    eventStatement(db,user,id,"info",action === "pause" ? "Crawl paused. An in-flight fetch may finish." : "Crawl resumed."),
  ]);
  return {job:publicJob(await getJob(db,user,id))};
}
export async function addSource(db:DB,user:string,input:Row) {
  const name = typeof input.name === "string" ? input.name.trim().slice(0,150) : "";
  const domain = researchDomain(input.domain,name);
  if (!name) throw new ApiError("Give this source a name.");
  const url = safeUrl(input.url);
  const existing = await first(db,"SELECT * FROM atlas_sources WHERE user_id=? AND url=?",user,url);
  if (existing) return {source:customSource(existing)};
  const id = "custom-"+uid(),createdAt=now();
  await statement(db,"INSERT INTO atlas_sources(id,user_id,name,url,domain,created_at) VALUES(?,?,?,?,?,?)",id,user,name,url,domain,createdAt).run();
  return {source:customSource({id,name,url,domain,created_at:createdAt})};
}
export async function setBookmark(db:DB,user:string,input:Row) {
  if (typeof input.id !== "string" || input.id.length > 250 || typeof input.saved !== "boolean") throw new ApiError("Bookmark request is invalid.");
  if (input.saved) await statement(db,"INSERT OR IGNORE INTO atlas_bookmarks(user_id,resource_id) VALUES(?,?)",user,input.id).run();
  else await statement(db,"DELETE FROM atlas_bookmarks WHERE user_id=? AND resource_id=?",user,input.id).run();
  return {id:input.id,saved:input.saved};
}
