import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
// Node's native TypeScript stripping runs these tests without the worker runtime.
// @ts-expect-error Node requires the TypeScript extension for direct execution.
import { safeUrl, inScope, extractDocument, robotsRules, researchDomain, createJob, stepJob, controlJob, readState, readRun, addSource, setBookmark, exportDataChunks } from "../lib/crawler.ts";
// @ts-expect-error Node requires the TypeScript extension for direct execution.
import {parseAgentReview} from "../lib/crawl-supervision.ts";
// @ts-expect-error Node requires the TypeScript extension for direct execution.
import {CRAWL_LIMITS,CRAWL_PRESETS} from "../lib/crawl-presets.ts";

test("URL validation rejects private and alternate encoded IP targets",()=>{
  for (const url of ["http://sec.gov/","https://127.0.0.1/","https://2130706433/","https://0x7f000001/","https://[::1]/","https://[::ffff:127.0.0.1]/","https://10.0.0.1/","https://169.254.169.254/","https://localhost/","https://service.internal/","https://localhost./","https://127.0.0.1.nip.io/","https://user:pass@sec.gov/","https://sec.gov:444/"]) {
    assert.throws(()=>safeUrl(url),url);
  }
});
test("URL normalization removes tracking, keeps semantic query and resolves safe links",()=>{
  assert.equal(safeUrl("https://SEC.gov/a?z=3&utm_source=x&a=1#part"),"https://sec.gov/a?a=1&z=3");
  assert.equal(safeUrl("../filing","https://sec.gov/path/page"),"https://sec.gov/filing");
});
test("Scope matches exact seed hosts with www equivalence, not lookalike or subdomains",()=>{
  assert.equal(inScope("https://www.sec.gov/a",["sec.gov"],"same-domain"),true);
  assert.equal(inScope("https://evilsec.gov/a",["sec.gov"],"same-domain"),false);
  assert.equal(inScope("https://other.sec.gov/a",["sec.gov"],"same-domain"),false);
  assert.equal(inScope("https://imf.org/a",["sec.gov"],"linked-domains"),true);
  assert.equal(inScope("https://localhost/a",["sec.gov"],"linked-domains"),false);
});
test("HTML metadata and canonical links are extracted without scripts",()=>{
  const doc = `<html><head><title>fallback</title><meta property='og:title' content='Bank &amp; credit'><meta content='Industry research.' name='description'><link rel='canonical' href='/article'></head><body><script>alert('bad')</script><a href='/next?utm_campaign=x'>Next</a><a href='https://127.0.0.1/'>No</a><a rel='nofollow' href='/private'>No</a></body></html>`;
  const result = extractDocument(doc,"https://research.org/item","text/html","bank credit technology");
  assert.equal(result.title,"Bank & credit");
  assert.equal(result.description,"Industry research.");
  assert.equal(result.canonicalUrl,"https://research.org/article");
  assert.deepEqual(result.tags,["bank","credit"]);
  assert.ok(result.links.includes("https://research.org/next"));
  assert.ok(!result.links.some((u:string)=>u.includes("private") || u.includes("127.0.0.1")));
});
test("RSS and Atom extract article URLs and summaries",()=>{
  const rss = extractDocument(`<rss><channel><title>News</title><item><title>A &amp; B</title><link>https://research.org/story</link><description><![CDATA[<p>Study result</p>]]></description></item></channel></rss>`,"https://research.org/feed","application/rss+xml");
  assert.equal(rss.feedEntries[0].url,"https://research.org/story");
  assert.equal(rss.feedEntries[0].description,"Study result");
  const atom = extractDocument(`<feed><title>Research</title><entry><title>Report</title><link rel="alternate" href="/report"/><summary>Evidence</summary></entry></feed>`,"https://research.org/feed","application/atom+xml");
  assert.equal(atom.feedEntries[0].url,"https://research.org/report");
});
test("Robots uses most specific agent groups and longest allow/disallow match",()=>{
  const rules = "User-agent: *\nDisallow: /\nUser-agent: RadixAIBot\nDisallow: /private\nAllow: /private/public\nCrawl-delay: 3";
  assert.deepEqual(robotsRules(rules,"/paper"),{allowed:true,delayMs:3000});
  assert.equal(robotsRules(rules,"/private/secret").allowed,false);
  assert.equal(robotsRules(rules,"/private/public/report").allowed,true);
  assert.equal(robotsRules("User-agent: *\nDisallow: /*.pdf$","/x.pdf").allowed,false);
  assert.equal(robotsRules("User-agent: *\nDisallow: /*.pdf$","/x.pdf/other").allowed,true);
  assert.equal(robotsRules("User-agent: *\nDisallow:","/anything").allowed,true);
  assert.equal(robotsRules("User-agent: Radix\nAllow: /secret\nUser-agent: RadixAIBot\nDisallow: /secret","/secret").allowed,false);
  assert.equal(robotsRules("User-agent: *\nDisallow: /\nUser-agent:\nAllow: /","/secret").allowed,false);
});

function testDatabase(latencyMs=0) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE atlas_sources(id TEXT PRIMARY KEY,user_id TEXT,name TEXT,url TEXT,domain TEXT,created_at TEXT,UNIQUE(user_id,url));
    CREATE TABLE atlas_jobs(id TEXT PRIMARY KEY,user_id TEXT,query TEXT,status TEXT,scope TEXT,max_pages INTEGER,max_depth INTEGER,processed INTEGER,indexed INTEGER,errors INTEGER,seed_hosts TEXT,created_at TEXT,updated_at TEXT,lease_until INTEGER);
    CREATE TABLE atlas_pages(id TEXT PRIMARY KEY,user_id TEXT,job_id TEXT,source_id TEXT,url TEXT,title TEXT,description TEXT,domain TEXT,category TEXT,tags TEXT,depth INTEGER,parent_url TEXT,fetched_at TEXT,status TEXT,UNIQUE(user_id,job_id,url));
    CREATE TABLE atlas_queue(id TEXT PRIMARY KEY,user_id TEXT,job_id TEXT,source_id TEXT,url TEXT,domain TEXT,category TEXT,depth INTEGER,parent_url TEXT,status TEXT,created_at TEXT,next_attempt_at INTEGER NOT NULL DEFAULT 0,fetch_state TEXT,UNIQUE(user_id,job_id,url));
    CREATE TABLE atlas_events(id TEXT PRIMARY KEY,user_id TEXT,job_id TEXT,time TEXT,level TEXT,message TEXT,url TEXT);
    CREATE TABLE atlas_edges(id TEXT PRIMARY KEY,user_id TEXT,job_id TEXT,source TEXT,target TEXT,UNIQUE(user_id,job_id,source,target));
    CREATE TABLE atlas_bookmarks(user_id TEXT,resource_id TEXT,UNIQUE(user_id,resource_id));
    CREATE TABLE atlas_hosts(host TEXT PRIMARY KEY,next_allowed_at INTEGER DEFAULT 0,robots_text TEXT,robots_status INTEGER,robots_fetched_at INTEGER,crawl_delay INTEGER DEFAULT 1000);
    CREATE TABLE atlas_chat(id TEXT PRIMARY KEY,user_id TEXT,role TEXT,content TEXT,metadata TEXT DEFAULT '{}',created_at TEXT);
    CREATE TABLE atlas_documents(id TEXT PRIMARY KEY,user_id TEXT,url TEXT,title TEXT,description TEXT,domain TEXT,document_type TEXT,provider TEXT,provider_id TEXT,provider_record_url TEXT,access_basis TEXT,full_text_url TEXT,doi TEXT,published_at TEXT,query TEXT,queries TEXT DEFAULT '[]',discovered_at TEXT,updated_at TEXT,UNIQUE(user_id,url));
  `);
  const metrics={calls:0,statements:0};
  let inBatch=false;
  const before=async()=>{metrics.statements++;if(!inBatch){metrics.calls++;if(latencyMs)await new Promise(resolve=>setTimeout(resolve,latencyMs));}};
  class Prepared {
    sql:string; params:(string|number|null)[];
    constructor(sql:string,params:(string|number|null)[]=[]){this.sql=sql;this.params=params;}
    bind(...params:(string|number|null)[]){return new Prepared(this.sql,params);}
    async all(){await before();return {results:sqlite.prepare(this.sql).all(...this.params)};}
    async first(){await before();return sqlite.prepare(this.sql).get(...this.params) || null;}
    async run(){await before();const result=sqlite.prepare(this.sql).run(...this.params);return {meta:{changes:Number(result.changes)},success:true};}
  }
  const db = {prepare:(sql:string)=>new Prepared(sql),batch:async(commands:Prepared[])=>{
    metrics.calls++;if(latencyMs)await new Promise(resolve=>setTimeout(resolve,latencyMs));
    sqlite.exec("BEGIN");inBatch=true;
    try {const results=[];for(const command of commands)results.push(/^\s*(SELECT|WITH)\b/i.test(command.sql)?await command.all():await command.run());sqlite.exec("COMMIT");return results;}
    catch(error){sqlite.exec("ROLLBACK");throw error;}finally{inBatch=false;}
  }} as unknown as D1Database;
  const cacheRobots = (host:string,text="") => sqlite.prepare("INSERT OR REPLACE INTO atlas_hosts(host,next_allowed_at,robots_text,robots_status,robots_fetched_at,crawl_delay) VALUES(?,0,?,200,?,1000)").run(host,text,Date.now());
  return {db,sqlite,cacheRobots,metrics};
}

test("D1 integration: feed discovery, persistent queue, pause/resume, ownership, counters and dedup",async()=>{
  const {db,sqlite,cacheRobots} = testDatabase();
  const originalFetch = globalThis.fetch;
  const requested:string[] = [];
  cacheRobots("feeds.publicresearch.org");
  cacheRobots("publicresearch.org","User-agent: *\nDisallow: /b");
  globalThis.fetch = (async(input:RequestInfo|URL)=>{
    const url=String(input);requested.push(url);
    if(url.includes("/rss"))return new Response(`<rss><channel><title>Research feed</title><item><title>A</title><link>https://publicresearch.org/a</link></item><item><title>Duplicate</title><link>https://publicresearch.org/a?utm_source=x</link></item><item><title>B</title><link>https://publicresearch.org/b</link></item></channel></rss>`,{headers:{"content-type":"application/rss+xml"}});
    return new Response(`<title>Banking paper</title><meta name="description" content="Evidence on banking competition and lending outcomes across several countries."><a href="/a">Self</a>`,{headers:{"content-type":"text/html"}});
  }) as typeof fetch;
  try {
    const created=await createJob(db,"alice",{query:"Banking",sourceIds:["feed"],maxPages:5,maxDepth:1,scope:"same-domain"},[{id:"feed",name:"Feed",url:"https://publicresearch.org/",feedUrl:"https://feeds.publicresearch.org/rss",domain:"Finance",category:"Academic research",access:"Free"}]);
    const id=String(created.job.id);
    assert.equal(created.job.queued,1);
    await assert.rejects(()=>stepJob(db,"bob",id),/not found/);
    const first=await stepJob(db,"alice",id);
    assert.equal(first.job.indexed,0,"A feed discovers articles but is not itself indexed research.");
    assert.equal(first.job.queued,2,"Feed and original source hosts must both remain in scope; duplicate URLs are removed.");
    await controlJob(db,"alice",id,"pause");
    assert.equal((await stepJob(db,"alice",id)).job.processed,1);
    assert.equal((await readState(db,"alice")).jobs[0].status,"paused");
    await controlJob(db,"alice",id,"resume");
    await stepJob(db,"alice",id);
    sqlite.exec("UPDATE atlas_hosts SET next_allowed_at=0");
    const last=await stepJob(db,"alice",id);
    assert.equal(last.job.status,"completed");
    assert.equal(last.job.processed,3);
    assert.equal(last.job.indexed,1);
    assert.equal(last.job.errors,1,"Robots-blocked URLs count in failed/blocked totals.");
    assert.equal(last.job.queued,0);
    assert.equal(requested.length,2,"A robots-blocked article must never be fetched.");
    const state=await readState(db,"alice");
    assert.equal(state.pages.length,1);
    assert.equal(state.edges.length,2);
    assert.equal(state.frontier.length,3);
    assert.ok(state.frontier.some(item=>item.parentUrl === 'https://feeds.publicresearch.org/rss' && item.status === 'blocked'));
    assert.ok(state.events.some(e=>e.level==="blocked"));
    assert.deepEqual((await readState(db,"bob")).pages,[]);
    assert.deepEqual((await readState(db,"bob")).frontier,[]);
    await setBookmark(db,"alice",{id:"feed",saved:true});
    assert.deepEqual((await readState(db,"alice")).bookmarks,["feed"]);
    assert.deepEqual((await readState(db,"bob")).bookmarks,[]);
    await setBookmark(db,"alice",{id:"feed",saved:false});
    assert.deepEqual((await readState(db,"alice")).bookmarks,[]);
    await addSource(db,"alice",{name:"AI reports",url:"https://research.org/",domain:"unsupported"});
    assert.equal((await readState(db,"alice")).customSources[0].domain,"Technology");
    assert.equal((await readState(db,"alice")).customSources[0].access,"Unknown");
    assert.deepEqual((await readState(db,"bob")).customSources,[]);
  } finally {globalThis.fetch=originalFetch;sqlite.close();}
});

test("D1 integration: X-Robots-Tag nofollow prevents queue expansion and custom URLs have supported domains",async()=>{
  const {db,sqlite,cacheRobots}=testDatabase();
  const originalFetch=globalThis.fetch;
  cacheRobots("publicresearch.org");
  globalThis.fetch=(async()=>new Response(`<title>AI research</title><p>Evidence on artificial intelligence evaluation and model deployment in production.</p><a href="/child">child</a>`,{headers:{"content-type":"text/html","x-robots-tag":"nofollow"}})) as typeof fetch;
  try {
    const created=await createJob(db,"alice",{query:"AI research",urls:["https://publicresearch.org/article"],maxPages:5,maxDepth:2},[]);
    const result=await stepJob(db,"alice",String(created.job.id));
    assert.equal(result.job.status,"completed");
    const state=await readState(db,"alice");
    assert.equal(state.pages[0].domain,"Technology");
    assert.equal(state.pages[0].access,"Unknown","A successful custom-URL fetch must not imply verified free access.");
    assert.equal(state.edges.length,0);
    assert.equal(researchDomain(undefined,"Case studies on banks"),"Case studies");
  } finally {globalThis.fetch=originalFetch;sqlite.close();}
});

test("New crawls reject non-free catalog IDs and paid URLs, including saved custom aliases",async()=>{
  const {db,sqlite}=testDatabase();
  const catalog=[
    ...["Paid","Mixed","Freemium",undefined].map((access,i)=>({id:`restricted-${i}`,name:`Restricted ${i}`,url:`https://restricted${i}.org/`,domain:"Business",access})),
    {id:"free",name:"Open reports",url:"https://restricted0.org/open",domain:"Business",access:"Free"},
  ];
  try{
    for(const source of catalog.slice(0,4))await assert.rejects(()=>createJob(db,"alice",{sourceIds:[source.id]},catalog),/not listed as Free/);
    for(const host of ["restricted0.org","www.restricted1.org","restricted2.org"])await assert.rejects(()=>createJob(db,"alice",{urls:[`https://${host}/article`]},catalog),/paid or mixed-access/);
    const alias=await addSource(db,"alice",{name:"Saved paid site",url:"https://restricted0.org/article"});
    await assert.rejects(()=>createJob(db,"alice",{sourceIds:[alias.source.id]},catalog),/paid or mixed access/);
    assert.equal(Number(sqlite.prepare("SELECT count(*) AS n FROM atlas_jobs").get()?.n),0,"Rejected starts must not create jobs or queues.");
    const free=await createJob(db,"alice",{sourceIds:["free"]},catalog);
    assert.equal(free.job.queued,1,"A known free subpath can be selected on a mixed-access host.");
    const custom=await addSource(db,"alice",{name:"Public custom resource",url:"https://publicresearch.org/"});
    assert.equal(custom.source.access,"Unknown");
    const unknown=await createJob(db,"alice",{sourceIds:[custom.source.id]},catalog);
    assert.equal(unknown.job.queued,1,"Unknown custom resources may be checked without claiming they are verified free.");
    const direct=await createJob(db,"alice",{urls:["https://publicresearch.org/report"]},catalog);
    assert.equal(direct.job.queued,1);
  }finally{sqlite.close();}
});

test("Crawler skips explicit paywalls before indexing or following their links",async()=>{
  const originalFetch=globalThis.fetch;
  const examples=[
    {status:402,body:"Payment required"},
    {status:401,body:"Sign in required"},
    {status:200,body:`<script type="application/ld+json">{"@type":"Article","isAccessibleForFree":false}</script>`},
    {status:200,body:"<h1>Subscribe to continue reading</h1>"},
    {status:200,body:"<h1>Report</h1><p>Sign in to read this article</p>"},
  ];
  try{
    for(const example of examples){
      const {db,sqlite,cacheRobots}=testDatabase();cacheRobots("publicresearch.org");
      globalThis.fetch=(async()=>new Response(example.body+`<a href="/next">Next</a>`,{status:example.status,headers:{"content-type":"text/html"}})) as typeof fetch;
      try{
        const created=await createJob(db,"alice",{urls:["https://publicresearch.org/"],maxPages:5,maxDepth:1},[]);
        const result=await stepJob(db,"alice",String(created.job.id));
        assert.equal(result.job.status,"completed");assert.equal(result.job.indexed,0);assert.equal(result.job.errors,1);
        const state=await readState(db,"alice");
        assert.equal(state.pages.length,0);assert.equal(state.edges.length,0);assert.equal(state.frontier[0].status,"skipped");
        assert.ok(state.events.some(event=>event.level==="skipped"&&/not indexed/i.test(String(event.message))));
      }finally{sqlite.close();}
    }
  }finally{globalThis.fetch=originalFetch;}
});

test("Public articles with newsletter subscriptions and ordinary sign-in links remain crawlable",async()=>{
  const {db,sqlite,cacheRobots}=testDatabase(),originalFetch=globalThis.fetch;
  cacheRobots("publicresearch.org");
  globalThis.fetch=(async()=>new Response(`<h1>Open research</h1><p>A public report comparing bank lending performance across several regions.</p><aside>Subscribe to our newsletter</aside><a href="/login">Sign in</a>`,{headers:{"content-type":"text/html"}})) as typeof fetch;
  try{
    const created=await createJob(db,"alice",{urls:["https://publicresearch.org/report"],maxDepth:0},[]);
    const result=await stepJob(db,"alice",String(created.job.id));
    assert.equal(result.job.indexed,1);assert.equal(result.job.errors,0);
  }finally{globalThis.fetch=originalFetch;sqlite.close();}
});

test("Session-expiry captures are skipped without indexing or following account-page links",async()=>{
  const {db,sqlite,cacheRobots}=testDatabase(),originalFetch=globalThis.fetch;cacheRobots("publicresearch.org");
  globalThis.fetch=(async()=>new Response(`<title>EMMA</title><p>Your session is about to expire due to inactivity.</p><a href="/bank-mergers">Bank mergers</a>`,{headers:{"content-type":"text/html"}})) as typeof fetch;
  try{
    const created=await createJob(db,"alice",{query:"M&A banking",urls:["https://publicresearch.org/session-notice"],maxDepth:1},[]);
    const result=await stepJob(db,"alice",String(created.job.id));
    assert.equal(result.job.indexed,0);assert.equal(result.job.errors,1);
    const state=await readState(db,"alice");assert.equal(state.pages.length,0);assert.equal(state.edges.length,0);
    assert.ok(state.events.some(event=>String(event.message).startsWith("Fetching ")));
    assert.ok(state.events.some(event=>/HTTP 200.*\d+ ms.*not indexed/.test(String(event.message))));
  }finally{globalThis.fetch=originalFetch;sqlite.close();}
});

test("Navigation discovers prioritized topical articles without indexing itself or footer links",async()=>{
  const {db,sqlite,cacheRobots}=testDatabase(),originalFetch=globalThis.fetch;cacheRobots("publicresearch.org");
  const requested:string[]=[];
  globalThis.fetch=(async(input:RequestInfo|URL)=>{
    const url=String(input);requested.push(url);
    return new Response(url.endsWith("/")?`<title>Research library</title><p>Browse our public research reports and updates.</p><a href="/office-updates">Office updates</a><a href="/login">Sign in</a><a href="/privacy">Privacy</a><a href="/bank-acquisition">Bank merger evidence</a>`:`<title>Bank acquisitions and lending</title><p>We compare lending and operating costs after bank mergers across several countries.</p>`,{headers:{"content-type":"text/html"}});
  }) as typeof fetch;
  try{
    const created=await createJob(db,"alice",{query:"M&A banking",urls:["https://publicresearch.org/"],maxDepth:1},[]),id=String(created.job.id);
    const first=await stepJob(db,"alice",id);assert.equal(first.job.indexed,0);assert.equal(first.job.processed,1);assert.equal(first.job.errors,0);
    sqlite.exec("UPDATE atlas_hosts SET next_allowed_at=0");
    const second=await stepJob(db,"alice",id);assert.equal(second.job.indexed,1);
    assert.deepEqual(requested,["https://publicresearch.org/","https://publicresearch.org/bank-acquisition"]);
    const state=await readState(db,"alice");assert.equal(state.pages.length,1);assert.equal(state.edges.length,2);
    assert.ok(state.frontier.every(item=>!String(item.url).includes("login")&&!String(item.url).includes("privacy")));
    assert.ok(state.events.some(event=>String(event.message).includes("Discovery only (navigation)")));
  }finally{globalThis.fetch=originalFetch;sqlite.close();}
});

test("Content extraction prefers article paragraphs over session notices and prioritizes anchor text",()=>{
  const doc=`<title>Bank mergers and lending</title><p>Your session is about to expire due to inactivity.</p><main><p>Bank mergers change lending competition across regions and customer segments.</p><a href="/item?id=2">Office information</a><a href="/item?id=1">Bank acquisition evidence</a></main>`;
  const extracted=extractDocument(doc,"https://research.org/article","text/html","bank mergers");
  assert.match(extracted.description,/Bank mergers change lending/);
  assert.equal(extracted.links[0],"https://research.org/item?id=1");
});

test("Verified open PDF seeds retain provider metadata and never claim PDF text extraction",async()=>{
  const {db,sqlite,cacheRobots}=testDatabase(),originalFetch=globalThis.fetch;cacheRobots("publisher.org");
  const catalog=[{id:"publisher",name:"Publisher",url:"https://publisher.org/",domain:"Finance",access:"Mixed"},{id:"document",name:"Bank merger performance",url:"https://publisher.org/paper.pdf",description:"This study compares bank lending performance and operating costs after acquisitions.",domain:"Finance",access:"Free",exact:true}];
  globalThis.fetch=(async()=>new Response("%PDF-1.7 unseen document bytes",{headers:{"content-type":"application/pdf"}})) as typeof fetch;
  try{
    const created=await createJob(db,"alice",{query:"bank mergers",sourceIds:["document"],maxDepth:0},catalog);
    const result=await stepJob(db,"alice",String(created.job.id),catalog);assert.equal(result.job.indexed,1);
    const state=await readState(db,"alice");assert.equal(state.pages[0].title,"Bank merger performance");
    assert.equal(state.pages[0].description,catalog[1].description);
    assert.ok(state.events.some(event=>/PDF full text was not extracted/.test(String(event.message))));
    assert.ok(!JSON.stringify(state).includes("unseen document bytes"));
  }finally{globalThis.fetch=originalFetch;sqlite.close();}
});

test("Oversized provider-backed HTML cancels its response and retains the metadata-only crawl limit",async()=>{
  const {db,sqlite,cacheRobots}=testDatabase(),originalFetch=globalThis.fetch;cacheRobots("www.sec.gov");
  const url="https://www.sec.gov/Archives/edgar/data/320193/000032019325000080/aapl-20250628.htm";
  const catalog=[{id:"filing",name:"Apple Inc. quarterly report",url,description:"Apple filed its quarterly report on Form 10-Q with the Securities and Exchange Commission.",domain:"Finance",access:"Free",exact:true}];
  let cancelled=false;
  globalThis.fetch=(async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{"content-type":"text/html","content-length":"1018325"}})) as typeof fetch;
  try{
    const created=await createJob(db,"alice",{query:"Apple quarterly report",sourceIds:["filing"],maxDepth:0},catalog);
    const result=await stepJob(db,"alice",String(created.job.id),catalog);
    assert.equal(cancelled,true,"Rejecting the Content-Length header must also stop downloading the response.");
    assert.equal(result.job.indexed,0);assert.equal(result.job.processed,1);
    const state=await readState(db,"alice");assert.equal(state.pages.length,0);
    assert.ok(state.events.some(event=>/1 MB metadata-fetch limit/.test(String(event.message))));
    assert.equal(sqlite.prepare("SELECT status FROM atlas_queue WHERE job_id=?").get(String(created.job.id))?.status,"skipped");
  }finally{globalThis.fetch=originalFetch;sqlite.close();}
});

test("Known paid redirect destinations and linked pages are never fetched",async()=>{
  const originalFetch=globalThis.fetch;
  const catalog=[{id:"paid",name:"Paid publisher",url:"https://paidresearch.org/",domain:"Finance",access:"Paid"}];
  try{
    for(const redirect of [true,false]){
      const {db,sqlite,cacheRobots}=testDatabase();cacheRobots("publicresearch.org");
      const requested:string[]=[];
      globalThis.fetch=(async(input:RequestInfo|URL)=>{
        requested.push(String(input));
        return redirect?new Response(null,{status:302,headers:{location:"https://paidresearch.org/article"}}):new Response(`<h1>Public study</h1><p>Evidence on bank lending outcomes and financial performance across regions.</p><a href="https://paidresearch.org/article">Paid report</a>`,{headers:{"content-type":"text/html"}});
      }) as typeof fetch;
      try{
        const created=await createJob(db,"alice",{urls:["https://publicresearch.org/report"],maxPages:5,maxDepth:1,scope:"linked-domains"},catalog);
        await stepJob(db,"alice",String(created.job.id),catalog);
        if(!redirect)await stepJob(db,"alice",String(created.job.id),catalog);
        assert.deepEqual(requested,["https://publicresearch.org/report"]);
        const state=await readState(db,"alice");
        assert.equal(state.pages.length,redirect?0:1);
        assert.ok(state.events.some(event=>event.level==="skipped"&&/paid or mixed-access/.test(String(event.message))));
      }finally{sqlite.close();}
    }
  }finally{globalThis.fetch=originalFetch;}
});

test("Full export crosses keyset batches, excludes other users, and counts and saved pages exceed UI caps",async()=>{
  const {db,sqlite}=testDatabase();
  try {
    const jobInsert=sqlite.prepare("INSERT INTO atlas_jobs VALUES(?,'alice','query','completed','same-domain',300,1,20,19,1,'[]','2026-01-01','2026-01-01',0)");
    for(let i=0;i<105;i++)jobInsert.run(`job-${String(i).padStart(4,'0')}`);
    const pageInsert=sqlite.prepare("INSERT INTO atlas_pages VALUES(?,?,'job-0000','source',?,'Title','Description','Finance','Research','[]',0,NULL,?,'indexed')");
    for(let i=0;i<2020;i++)pageInsert.run(`page-${String(i).padStart(4,'0')}`,'alice',`https://research.org/${i}`,i===0?'2020-01-01':'2026-01-01');
    pageInsert.run('bob-secret-page','bob','https://other.org/secret','2026-01-01');
    const sourceInsert=sqlite.prepare("INSERT INTO atlas_sources VALUES(?,'alice','Custom',?,'Finance','2026-01-01')");
    for(let i=0;i<251;i++)sourceInsert.run(`custom-${i}`,`https://research${i}.org/`);
    const eventInsert=sqlite.prepare("INSERT INTO atlas_events VALUES(?,'alice','job-0000','2026-01-01','info','Saved',NULL)");
    for(let i=0;i<510;i++)eventInsert.run(`event-${i}`);
    const chatInsert=sqlite.prepare("INSERT INTO atlas_chat VALUES(?,'alice','user','hello','{}','2026-01-01')");
    for(let i=0;i<260;i++)chatInsert.run(`message-${i}`);
    const documentInsert=sqlite.prepare("INSERT INTO atlas_documents(id,user_id,url,title,description,provider,query,queries) VALUES(?,?,?,'Provider title','Provider summary','OpenAlex','Bank mergers','[\"Bank mergers\"]')");
    for(let i=0;i<255;i++)documentInsert.run(`document-${String(i).padStart(4,'0')}`,'alice',`https://papers.org/${i}`);
    documentInsert.run('other-document','bob','https://papers.org/private');
    await setBookmark(db,'alice',{id:'page-0000',saved:true});
    await setBookmark(db,'alice',{id:'bob-secret-page',saved:true});
    const state=await readState(db,'alice');
    assert.equal(state.pages.length,2000);
    assert.equal(state.jobs.length,100);
    assert.equal(state.events.length,500);
    assert.equal(state.counts.pages,2020);
    assert.equal(state.counts.jobs,105);
    assert.equal(state.counts.processed,2100);
    assert.equal(state.counts.indexed,1995);
    assert.equal(state.counts.errors,105);
    assert.deepEqual(state.savedPages.map(p=>p.id),['page-0000']);
    let serialized='';
    for await(const chunk of exportDataChunks(db,'alice','workspace',[{id:'catalog',name:'Catalog',url:'https://catalog.org/',domain:'Business'}]))serialized+=chunk;
    const exported=JSON.parse(serialized);
    assert.equal(exported.pages.length,2020);
    assert.equal(exported.jobs.length,105);
    assert.equal(exported.events.length,510);
    assert.equal(exported.messages.length,260);
    assert.equal(exported.sources.length,252);
    assert.equal(exported.documents.length,255);
    assert.ok(!serialized.includes('https://papers.org/private'));
    assert.ok(!serialized.includes('"user_id"'));
    assert.ok(!serialized.includes('https://other.org/secret'));
    let onlyPages='';
    for await(const chunk of exportDataChunks(db,'alice','pages',[]))onlyPages+=chunk;
    assert.equal(JSON.parse(onlyPages).length,2020);
  } finally {sqlite.close();}
});

test("Backend database call budget for a cached-host leaf crawl and state snapshot",async(t)=>{
  const {db,sqlite,cacheRobots,metrics}=testDatabase(10);
  const originalFetch=globalThis.fetch;
  cacheRobots("publicresearch.org");
  globalThis.fetch=(async()=>new Response(`<title>Research</title>`,{headers:{"content-type":"text/html"}})) as typeof fetch;
  try{
    const created=await createJob(db,'alice',{urls:['https://publicresearch.org/'],maxPages:5,maxDepth:0},[]);
    metrics.calls=0;metrics.statements=0;
    const start=performance.now();
    await stepJob(db,'alice',String(created.job.id));
    t.diagnostic(`Cached-host leaf step: ${metrics.calls} D1 requests, ${metrics.statements} SQL statements, ${(performance.now()-start).toFixed(1)} ms with simulated 10 ms D1 latency`);
    assert.ok(metrics.calls<=15,'The 11-call leaf budget permits four explicit live stage writes; host, job and page reads must not be repeated.');
    metrics.calls=0;metrics.statements=0;
    await readState(db,'alice');
    t.diagnostic(`State snapshot: ${metrics.calls} D1 requests, ${metrics.statements} SQL statements`);
    assert.equal(metrics.calls,1,'All snapshot panels should share one D1 batch.');
  }finally{globalThis.fetch=originalFetch;sqlite.close();}
});

test("Real crawl stages persist in order and fetch events precede only the actual document requests",async()=>{
  const {db,sqlite,cacheRobots}=testDatabase(),originalFetch=globalThis.fetch;
  cacheRobots("publicresearch.org");cacheRobots("papers.org");
  const source="https://publicresearch.org/article",destination="https://papers.org/bank-mergers",requests:string[]=[];
  const stages=()=>sqlite.prepare("SELECT message,url FROM atlas_events WHERE user_id='alice' AND message LIKE 'Stage · %' ORDER BY time,id").all();
  globalThis.fetch=(async(input:RequestInfo|URL)=>{
    const url=String(input);requests.push(url);const latest=stages().at(-1);
    assert.match(String(latest?.message),/^Stage · fetch · Requesting document /);assert.equal(latest?.url,url);
    if(url===source)return new Response(null,{status:302,headers:{location:destination}});
    return new Response("<title>Bank merger operating outcomes</title><p>This study compares bank merger outcomes and operating costs across several financial institutions.</p>",{headers:{"content-type":"text/html"}});
  }) as typeof fetch;
  try{
    const created=await createJob(db,"alice",{query:"bank mergers",urls:[source],scope:"linked-domains",maxDepth:0},[]),id=String(created.job.id);
    assert.deepEqual(stages().map(event=>String(event.message).split(" · ")[1]),["objective","sources"]);
    const result=await stepJob(db,"alice",id,[]);assert.equal(result.job.indexed,1);
    assert.deepEqual(requests,[source,destination]);
    const events=stages();assert.deepEqual(events.map(event=>String(event.message).split(" · ")[1]),["objective","sources","access","fetch","access","fetch","extract","review","save","complete"]);
    assert.deepEqual(events.filter(event=>/^Stage · (?:access|fetch) · /.test(String(event.message))).map(event=>event.url),[source,source,destination,destination]);
    assert.ok(events.filter(event=>/^Stage · (?:extract|review|save) · /.test(String(event.message))).every(event=>event.url===destination));
    const state=await readState(db,"alice");assert.match(String(state.events[0].message),/^Stage · complete · /);
    assert.ok(state.events.some(event=>String(event.message)===`Fetching ${source}`));assert.ok(state.events.some(event=>/^HTTP 200 · \d+ ms · Indexed metadata:/.test(String(event.message))));
    assert.deepEqual((await readState(db,"bob")).events,[]);
  }finally{globalThis.fetch=originalFetch;sqlite.close();}
});

test("Robots and paywall skips never claim extraction, review or saved metadata",async()=>{
  const originalFetch=globalThis.fetch;
  try{
    for(const blockedBy of ["robots","paywall"]){
      const {db,sqlite,cacheRobots}=testDatabase();if(blockedBy==="paywall")cacheRobots("publicresearch.org");
      const requests:string[]=[];
      globalThis.fetch=(async(input:RequestInfo|URL)=>{const url=String(input);requests.push(url);
        if(blockedBy==="robots"){assert.equal(url,"https://publicresearch.org/robots.txt");return new Response("User-agent: *\nDisallow: /article",{headers:{"content-type":"text/plain"}});}
        return new Response("<title>Subscribe to continue reading</title>",{headers:{"content-type":"text/html"}});
      }) as typeof fetch;
      try{
        const created=await createJob(db,"alice",{query:"bank mergers",urls:["https://publicresearch.org/article"],maxDepth:0},[]);
        const result=await stepJob(db,"alice",String(created.job.id),[]);assert.equal(result.job.indexed,0);assert.equal(result.job.errors,1);
        const events=sqlite.prepare("SELECT message,url FROM atlas_events WHERE message LIKE 'Stage · %' ORDER BY time,id").all();
        assert.deepEqual(events.map(event=>String(event.message).split(" · ")[1]),blockedBy==="robots"?["objective","sources","access","complete"]:["objective","sources","access","fetch","complete"]);
        assert.equal(requests.length,1);assert.ok(!events.some(event=>String(event.url).endsWith("robots.txt")),"Robots network calls must not impersonate a document fetch stage.");
        const review=(await readState(db,"alice")).events.map(event=>parseAgentReview(String(event.message))).find(Boolean);
        assert.ok(review);assert.equal(review.decision,"reject");assert.equal(review.storeMetadata,false);assert.equal(review.agents.length,4);
      }finally{sqlite.close();}
    }
  }finally{globalThis.fetch=originalFetch;}
});

test("Waiting for host permission remains in access stage without inventing an HTTP request",async()=>{
  const {db,sqlite,cacheRobots}=testDatabase(),originalFetch=globalThis.fetch;cacheRobots("publicresearch.org");
  sqlite.prepare("UPDATE atlas_hosts SET next_allowed_at=?").run(Date.now()+10000);
  globalThis.fetch=(async()=>{throw new Error("A waiting source must not be fetched");}) as typeof fetch;
  try{
    const created=await createJob(db,"alice",{urls:["https://publicresearch.org/article"],maxDepth:0},[]);
    const result=await stepJob(db,"alice",String(created.job.id),[]);assert.equal(result.waiting,true);assert.equal(result.job.processed,0);
    const state=await readState(db,"alice"),stages=state.events.filter(event=>String(event.message).startsWith("Stage · "));
    assert.match(String(stages[0].message),/^Stage · access · /);assert.ok(!stages.some(event=>/Stage · (fetch|extract|review|save|complete) · /.test(String(event.message))));
    assert.ok(state.events.some(event=>/Waiting for the source's crawl delay/.test(String(event.message))));
    assert.ok(!state.events.some(event=>parseAgentReview(String(event.message))),"A scheduling wait is not a supervisor rejection.");
    assert.equal(state.frontier[0].status,"queued");
  }finally{globalThis.fetch=originalFetch;sqlite.close();}
});

test("Chief of Staff blocks incidental-subject indexing, preserves useful links and persists complete owner-scoped agent reports",async()=>{
  const {db,sqlite,cacheRobots}=testDatabase(),originalFetch=globalThis.fetch;cacheRobots("publicresearch.org");
  const catalog=[{id:"free",name:"Public reports",url:"https://publicresearch.org/",domain:"Finance",access:"Free"}];
  globalThis.fetch=(async(input:RequestInfo|URL)=>new Response(String(input).endsWith("/childcare")?
    `<title>Employee childcare benefits</title><p>The law firm specializes in bank mergers and corporate transactions. This report evaluates childcare benefits and employee work schedules.</p><a href="/bank-mergers">Bank merger operating outcomes</a>`:
    `<title>Bank merger operating outcomes</title><p>This study compares bank merger outcomes and operating costs across several financial institutions.</p>`,{headers:{"content-type":"text/html"}})) as typeof fetch;
  try{
    const created=await createJob(db,"alice",{query:"bank mergers",urls:["https://publicresearch.org/childcare"],maxDepth:1},catalog),id=String(created.job.id);
    const first=await stepJob(db,"alice",id,catalog);assert.equal(first.job.indexed,0);
    let state=await readState(db,"alice");assert.equal(state.pages.length,0);assert.equal(state.edges.length,1);
    const auditEvent=state.events.find(event=>String(event.message).startsWith("Agent review · "));assert.ok(auditEvent);
    assert.ok(String(auditEvent.message).length>900,"Structured reports must not be truncated by the ordinary event-message limit.");
    const initial=parseAgentReview(String(auditEvent.message));assert.ok(initial);
    assert.equal(initial.decision,"discover");assert.equal(initial.storeMetadata,false);assert.equal(initial.allowDiscovery,true);
    assert.equal(initial.agents.length,4);assert.equal(initial.agents.find(agent=>agent.id==="relevance-reviewer")?.verdict,"fail");
    assert.equal(initial.query,"bank mergers");assert.equal(initial.url,"https://publicresearch.org/childcare");
    sqlite.exec("UPDATE atlas_hosts SET next_allowed_at=0");
    const second=await stepJob(db,"alice",id,catalog);assert.equal(second.job.indexed,1);
    state=await readState(db,"alice");const audits=state.events.map(event=>parseAgentReview(String(event.message))).filter(Boolean);
    assert.equal(audits.length,2);assert.ok(audits.some(audit=>audit?.decision==="approve"&&audit.storeMetadata));
    assert.deepEqual(state.pages.map(page=>page.url),["https://publicresearch.org/bank-mergers"]);
    assert.deepEqual((await readState(db,"bob")).events,[]);await assert.rejects(()=>readRun(db,"bob",id),/not found/);
  }finally{globalThis.fetch=originalFetch;sqlite.close();}
});

test("Historical run graph loads outside the dashboard frontier window and enforces ownership",async()=>{
  const {db,sqlite}=testDatabase();
  try{
    const insertJob=sqlite.prepare("INSERT INTO atlas_jobs VALUES(?,'alice','query','completed','same-domain',5,1,1,1,0,'[]',?,'2026-01-01',0)");
    insertJob.run('old-run','2020-01-01');
    for(let i=0;i<4;i++)insertJob.run(`new-run-${i}`,`2026-01-0${i+1}`);
    sqlite.exec(`
      INSERT INTO atlas_pages VALUES('old-page','alice','old-run','source','https://research.org/old','Older research','Summary','Finance','Research','[]',0,NULL,'2020-01-01','indexed');
      INSERT INTO atlas_queue(id,user_id,job_id,source_id,url,domain,category,depth,parent_url,status,created_at) VALUES('old-root','alice','old-run','source','https://research.org/old','Finance','Research',0,NULL,'done','2020-01-01');
      INSERT INTO atlas_queue(id,user_id,job_id,source_id,url,domain,category,depth,parent_url,status,created_at) VALUES('old-child','alice','old-run','source','https://research.org/child','Finance','Research',1,'https://research.org/old','skipped','2020-01-01');
      INSERT INTO atlas_edges VALUES('old-edge','alice','old-run','https://research.org/old','https://research.org/child');
      INSERT INTO atlas_events VALUES('old-event','alice','old-run','2020-01-01','info','Completed',NULL);
    `);
    const state=await readState(db,'alice');
    assert.equal(state.frontier.length,0,'Old run falls outside the three-run dashboard frontier window.');
    const run=await readRun(db,'alice','old-run');
    assert.equal(run.job.id,'old-run');
    assert.equal(run.pages[0].id,'old-page');
    assert.equal(run.frontier.length,2);
    assert.equal(run.edges.length,1);
    assert.equal(run.events.length,1);
    assert.equal(run.counts.frontier,2);
    assert.deepEqual(run.truncated,{pages:false,edges:false,frontier:false,events:false});
    await assert.rejects(()=>readRun(db,'bob','old-run'),/not found/);
    await assert.rejects(()=>readRun(db,'alice','missing-run'),/not found/);
    const eventInsert=sqlite.prepare("INSERT INTO atlas_events VALUES(?,'alice','old-run','2020-01-01','info','Event',NULL)");
    for(let i=0;i<505;i++)eventInsert.run(`extra-event-${i}`);
    const bounded=await readRun(db,'alice','old-run');
    assert.equal(bounded.events.length,500);
    assert.equal(bounded.counts.events,506);
    assert.equal(bounded.truncated.events,true);
  }finally{sqlite.close();}
});

test("Crawl presets and custom budgets enforce server limits before writing jobs",async()=>{
  const {db,sqlite}=testDatabase(),urls=["https://publicresearch.org/report"];
  try{
    for(const input of [{maxPages:4},{maxPages:2001},{maxPages:5.5},{maxDepth:-1},{maxDepth:9},{maxDepth:1.5},{preset:"unlimited"},{urls:Array.from({length:61},(_,i)=>`https://publicresearch.org/${i}`)}]){
      await assert.rejects(()=>createJob(db,"alice",{urls,...input},[]));
    }
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM atlas_jobs").get()?.n,0);
    const defaults=await createJob(db,"alice",{urls},[]);
    assert.equal(defaults.job.maxPages,500);assert.equal(defaults.job.maxDepth,5);assert.equal(defaults.job.scope,"same-domain");
    for(const preset of CRAWL_PRESETS){
      const created=await createJob(db,"alice",{urls,preset:preset.id},[]);
      assert.equal(created.job.maxPages,preset.maxPages);assert.equal(created.job.maxDepth,preset.maxDepth);assert.equal(created.job.scope,preset.scope);
    }
    const many=await createJob(db,"alice",{urls:Array.from({length:60},(_,i)=>`https://publicresearch.org/${i}`),maxPages:2000,maxDepth:8},[]);
    assert.equal(many.job.queued,60);assert.equal(many.job.maxPages,CRAWL_LIMITS.maxPages);
  }finally{sqlite.close();}
});

test("Deep runs persist every hop, resume an interrupted queue item and stop at the requested depth",async()=>{
  const {db,sqlite,cacheRobots}=testDatabase(),originalFetch=globalThis.fetch,requests:string[]=[];
  cacheRobots("publicresearch.org");
  globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=String(input),depth=Number(new URL(url).pathname.split("/").pop());requests.push(url);
    assert.match(new Headers(init?.headers).get("user-agent")||"",/^RadixAIBot\/1\.0/);
    return new Response(`<title>Bank merger study ${depth}</title><p>Bank mergers change lending costs and competition among financial institutions.</p><a href="/depth/${depth+1}">Bank merger follow-up</a>`,{headers:{"content-type":"text/html"}});
  }) as typeof fetch;
  try{
    const created=await createJob(db,"alice",{query:"bank mergers",urls:["https://publicresearch.org/depth/0"],preset:"deep"},[]),id=String(created.job.id);
    for(let i=0;i<2;i++){sqlite.exec("UPDATE atlas_hosts SET next_allowed_at=0");const result=await stepJob(db,"alice",id);assert.equal(result.job.processed,i+1);}
    await controlJob(db,"alice",id,"pause");
    sqlite.prepare("UPDATE atlas_queue SET status='processing' WHERE job_id=? AND status='queued'").run(id);
    assert.equal((await stepJob(db,"alice",id)).job.processed,2);assert.equal(requests.length,2);
    await controlJob(db,"alice",id,"resume");
    for(let i=2;i<6;i++){sqlite.exec("UPDATE atlas_hosts SET next_allowed_at=0");const result=await stepJob(db,"alice",id);assert.equal(result.job.processed,i+1);assert.equal(requests.length,i+1,"Each step fetches just one document.");}
    const run=await readRun(db,"alice",id);
    assert.equal(run.job.status,"completed");assert.equal(run.job.processed,6);assert.equal(run.job.indexed,6);assert.equal(run.frontier.length,6);
    assert.equal(Math.max(...run.frontier.map(item=>Number(item.depth))),5);assert.equal(requests.at(-1),"https://publicresearch.org/depth/5");
    assert.ok(run.events.some(event=>String(event.message).includes("All discovered URLs have been processed")));
  }finally{globalThis.fetch=originalFetch;sqlite.close();}
});

test("A resumed deep run respects its persisted page budget and preserves unvisited discoveries",async()=>{
  const {db,sqlite,cacheRobots}=testDatabase(),originalFetch=globalThis.fetch;let requests=0;
  cacheRobots("publicresearch.org");
  globalThis.fetch=(async()=>{requests++;return new Response('<title>Bank merger outcomes</title><p>Bank mergers change operating costs and competition among financial institutions.</p><a href="/next">More bank merger evidence</a>',{headers:{"content-type":"text/html"}});}) as typeof fetch;
  try{
    const created=await createJob(db,"alice",{query:"bank mergers",urls:["https://publicresearch.org/article"],preset:"deep"},[]),id=String(created.job.id);
    sqlite.prepare("UPDATE atlas_jobs SET processed=499,indexed=499 WHERE id=?").run(id);
    await controlJob(db,"alice",id,"pause");await stepJob(db,"alice",id);assert.equal(requests,0);
    await assert.rejects(()=>controlJob(db,"bob",id,"resume"),/not found/);
    await controlJob(db,"alice",id,"resume");
    const last=await stepJob(db,"alice",id);assert.equal(last.job.status,"completed");assert.equal(last.job.processed,500);assert.equal(last.job.indexed,500);assert.equal(last.job.errors,0);
    await stepJob(db,"alice",id);assert.equal(requests,1,"Reopening a complete run cannot fetch past its budget.");
    const pending=sqlite.prepare("SELECT status FROM atlas_queue WHERE job_id=? AND url=?").get(id,"https://publicresearch.org/next");assert.equal(pending?.status,"skipped");
    assert.ok((await readRun(db,"alice",id)).events.some(event=>String(event.message).includes("Page limit reached")));
    await assert.rejects(()=>controlJob(db,"alice",id,"resume"),/complete/);
  }finally{globalThis.fetch=originalFetch;sqlite.close();}
});

test("Extensive discovery stops at ten thousand saved queue entries while run snapshots stay bounded",async()=>{
  const {db,sqlite,cacheRobots}=testDatabase(),originalFetch=globalThis.fetch;cacheRobots("publicresearch.org");
  globalThis.fetch=(async()=>new Response('<title>Bank merger evidence</title><p>Bank mergers change operating costs and competition among financial institutions.</p><a href="/new-1">Bank merger one</a><a href="/new-2">Bank merger two</a><a href="/new-3">Bank merger three</a>',{headers:{"content-type":"text/html"}})) as typeof fetch;
  try{
    const created=await createJob(db,"alice",{query:"bank mergers",urls:["https://publicresearch.org/article"],preset:"extensive"},[]),id=String(created.job.id);
    const queue=sqlite.prepare("INSERT INTO atlas_queue(id,user_id,job_id,source_id,url,domain,category,depth,parent_url,status,created_at) VALUES(?,'alice',?,'seed',?,'Finance','Research',1,'https://publicresearch.org/article','done','2026-01-01')");
    for(let i=0;i<CRAWL_LIMITS.maxQueue-2;i++)queue.run(`old-${i}`,id,`https://publicresearch.org/old-${i}`);
    await stepJob(db,"alice",id);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM atlas_queue WHERE job_id=?").get(id)?.n,10_000);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM atlas_queue WHERE job_id=? AND status='queued'").get(id)?.n,1);
    const pages=sqlite.prepare("INSERT INTO atlas_pages VALUES(?,'alice',?,'seed',?,'Bank merger study','Bank merger metadata','Finance','Research','[]',1,NULL,'2026-01-01','indexed')");
    for(let i=0;i<500;i++)pages.run(`saved-${i}`,id,`https://publicresearch.org/saved-${i}`);
    const edge=sqlite.prepare("INSERT INTO atlas_edges VALUES(?,'alice',?,'https://publicresearch.org/article',?)");
    for(let i=0;i<3010;i++)edge.run(`edge-${i}`,id,`https://publicresearch.org/edge-${i}`);
    const run=await readRun(db,"alice",id);
    assert.equal(run.pages.length,501,"Deep historical views are no longer cut to300pages.");
    assert.equal(run.frontier.length,2000);assert.equal(run.counts.frontier,10_000);assert.equal(run.truncated.frontier,true);
    assert.equal(run.edges.length,3000);assert.equal(run.counts.edges,3011);assert.equal(run.truncated.edges,true);
    const state=await readState(db,"alice");assert.equal(state.frontier.length,2000);assert.equal(state.edges.length,3000);assert.equal(state.counts.frontier,10_000);assert.equal(state.truncated.frontier,true);
  }finally{globalThis.fetch=originalFetch;sqlite.close();}
});

test("Bounded graph snapshots prioritize a running crawl over older completed edges",async()=>{
  const {db,sqlite}=testDatabase();
  try{
    sqlite.exec("INSERT INTO atlas_jobs VALUES('old','alice','query','completed','same-domain',500,5,1,1,0,'[]','2026-01-02','2026-01-02',0)");
    const edge=sqlite.prepare("INSERT INTO atlas_edges VALUES(?,'alice','old','https://old.org/root',?)");
    for(let i=0;i<3010;i++)edge.run(`old-edge-${i}`,`https://old.org/${i}`);
    sqlite.exec("INSERT INTO atlas_jobs VALUES('active','alice','query','running','same-domain',500,5,1,1,0,'[]','2026-01-01','2026-01-01',0); INSERT INTO atlas_edges VALUES('active-edge','alice','active','https://current.org/root','https://current.org/child')");
    const state=await readState(db,"alice");assert.equal(state.edges.length,3000);assert.equal(state.edges[0].jobId,"active");assert.equal(state.counts.edges,3011);assert.equal(state.truncated.edges,true);
    assert.deepEqual((await readState(db,"bob")).edges,[]);
  }finally{sqlite.close();}
});

test("Delayed redirects resume at the destination while other sources make progress",async()=>{
  const {db,sqlite,cacheRobots}=testDatabase(),originalFetch=globalThis.fetch,originalNow=Date.now;
  let clock=originalNow();Date.now=()=>clock;
  cacheRobots("publicresearch.org");cacheRobots("otherresearch.org");
  sqlite.exec("UPDATE atlas_hosts SET crawl_delay=10000 WHERE host='publicresearch.org'");
  const requests:string[]=[];
  globalThis.fetch=(async(input:RequestInfo|URL)=>{
    const url=String(input);requests.push(url);
    if(url.endsWith('/original'))return new Response(null,{status:302,headers:{location:'/article'}});
    return new Response('<title>Bank merger outcomes</title><p>This study examines bank merger performance and lending outcomes across financial institutions.</p>',{headers:{'content-type':'text/html'}});
  }) as typeof fetch;
  try{
    const created=await createJob(db,'alice',{query:'bank mergers',urls:['https://publicresearch.org/original'],maxDepth:0,scope:'linked-domains'},[]),id=String(created.job.id);
    const first=await stepJob(db,'alice',id,[]);
    assert.equal(first.waiting,true);assert.equal(first.job.processed,0);
    const queued=sqlite.prepare("SELECT * FROM atlas_queue WHERE job_id=?").get(id)!;
    assert.equal(JSON.parse(String(queued.fetch_state)).document.url,'https://publicresearch.org/article');
    assert.equal(queued.next_attempt_at,clock+10000);
    // Add a ready URL after the deferred item, proving the first item cannot starve it.
    sqlite.prepare("INSERT INTO atlas_queue(id,user_id,job_id,source_id,url,domain,category,depth,status,created_at) VALUES('ready','alice',?,'source','https://otherresearch.org/article','Finance','Research',1,'queued','2099-01-01')").run(id);
    const other=await stepJob(db,'alice',id,[]);assert.equal(other.job.processed,1);
    const eventCount=sqlite.prepare('SELECT count(*) AS n FROM atlas_events').get()!.n;
    const waiting=await stepJob(db,'alice',id,[]);assert.equal(waiting.waiting,true);assert.equal(waiting.job.status,'running');assert.equal(waiting.retryAt,clock+10000);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM atlas_events').get()!.n,eventCount,'Polling a deferred queue must not spam events or make requests');
    clock+=10001;
    const last=await stepJob(db,'alice',id,[]);assert.equal(last.job.processed,2);assert.equal(last.job.status,'completed');
    assert.deepEqual(requests,['https://publicresearch.org/original','https://otherresearch.org/article','https://publicresearch.org/article']);
    assert.equal(last.job.indexed,2);
  }finally{globalThis.fetch=originalFetch;Date.now=originalNow;sqlite.close();}
});

test("Robots redirects and long crawl delays survive separate step requests",async()=>{
  const {db,sqlite}=testDatabase(),originalFetch=globalThis.fetch,originalNow=Date.now;
  let clock=originalNow();Date.now=()=>clock;
  const requests:string[]=[];
  globalThis.fetch=(async(input:RequestInfo|URL)=>{
    const url=String(input);requests.push(url);
    if(url.endsWith('/robots.txt')){
      sqlite.prepare('UPDATE atlas_hosts SET next_allowed_at=?,crawl_delay=10000').run(clock+10000);
      return new Response(null,{status:302,headers:{location:'/robots-policy'}});
    }
    if(url.endsWith('/robots-policy'))return new Response('User-agent: *\nCrawl-delay: 10\nDisallow: /private',{headers:{'content-type':'text/plain'}});
    return new Response('<title>Bank mergers and lending</title><p>Research on bank merger performance and the effects of consolidation on lending outcomes.</p>',{headers:{'content-type':'text/html'}});
  }) as typeof fetch;
  try{
    const created=await createJob(db,'alice',{query:'bank mergers',urls:['https://publicresearch.org/article'],maxDepth:0},[]),id=String(created.job.id);
    assert.equal((await stepJob(db,'alice',id,[])).waiting,true);
    const saved=JSON.parse(String(sqlite.prepare('SELECT fetch_state FROM atlas_queue').get()!.fetch_state));
    assert.equal(saved.robots.url,'https://publicresearch.org/robots-policy');assert.equal(saved.robots.redirects,1);
    clock+=10001;assert.equal((await stepJob(db,'alice',id,[])).waiting,true);
    clock+=10001;const final=await stepJob(db,'alice',id,[]);assert.equal(final.job.processed,1);assert.equal(final.job.indexed,1);
    assert.deepEqual(requests,['https://publicresearch.org/robots.txt','https://publicresearch.org/robots-policy','https://publicresearch.org/article']);
  }finally{globalThis.fetch=originalFetch;Date.now=originalNow;sqlite.close();}
});

test("Redirect budget cannot reset across delayed retries",async()=>{
  const {db,sqlite,cacheRobots}=testDatabase(),originalFetch=globalThis.fetch,originalNow=Date.now;
  let clock=originalNow();Date.now=()=>clock;cacheRobots('publicresearch.org');sqlite.exec('UPDATE atlas_hosts SET crawl_delay=10000');
  const requests:string[]=[];
  globalThis.fetch=(async(input:RequestInfo|URL)=>{const url=String(input);requests.push(url);return new Response(null,{status:302,headers:{location:url+'/next'}})}) as typeof fetch;
  try{
    const created=await createJob(db,'alice',{urls:['https://publicresearch.org/start'],maxDepth:0},[]),id=String(created.job.id);
    for(let i=0;i<3;i++){assert.equal((await stepJob(db,'alice',id,[])).waiting,true);clock+=10001;}
    const final=await stepJob(db,'alice',id,[]);assert.equal(final.job.processed,1);assert.equal(final.job.status,'completed');assert.equal(requests.length,4);
    assert.ok((await readState(db,'alice')).events.some(event=>event.message==='Redirect limit reached.'));
  }finally{globalThis.fetch=originalFetch;Date.now=originalNow;sqlite.close();}
});

test("Eligible URLs are selected beyond the deferred candidate window",async()=>{
  const {db,sqlite,cacheRobots}=testDatabase(),originalFetch=globalThis.fetch;
  cacheRobots('publicresearch.org');let fetched=0;
  globalThis.fetch=(async()=>{fetched++;return new Response('<title>Research article</title><p>A detailed research report with public methodology and supporting evidence.</p>',{headers:{'content-type':'text/html'}})}) as typeof fetch;
  try{
    const created=await createJob(db,'alice',{urls:['https://publicresearch.org/article'],maxDepth:0},[]),id=String(created.job.id);
    sqlite.exec("UPDATE atlas_queue SET created_at='2099-01-01'");
    const insert=sqlite.prepare("INSERT INTO atlas_queue(id,user_id,job_id,source_id,url,domain,category,depth,status,created_at,next_attempt_at) VALUES(?,'alice',?,'source',?,'Finance','Research',0,'queued','2000-01-01',?)");
    for(let i=0;i<130;i++)insert.run(`delayed-${i}`,id,`https://publicresearch.org/delayed-${i}`,Date.now()+60000);
    const result=await stepJob(db,'alice',id,[]);assert.equal(result.job.processed,1);assert.equal(fetched,1);assert.equal(result.job.queued,130);
  }finally{globalThis.fetch=originalFetch;sqlite.close();}
});
