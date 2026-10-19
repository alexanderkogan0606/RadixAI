import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
// Node's native TypeScript stripping runs these tests without the worker runtime.
// @ts-expect-error Node requires the TypeScript extension for direct execution.
import { safeUrl, inScope, extractDocument, robotsRules, researchDomain, createJob, stepJob, controlJob, readState, readRun, addSource, setBookmark, exportDataChunks } from "../lib/crawler.ts";

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
  const rules = "User-agent: *\nDisallow: /\nUser-agent: ResearchAtlasBot\nDisallow: /private\nAllow: /private/public\nCrawl-delay: 3";
  assert.deepEqual(robotsRules(rules,"/paper"),{allowed:true,delayMs:3000});
  assert.equal(robotsRules(rules,"/private/secret").allowed,false);
  assert.equal(robotsRules(rules,"/private/public/report").allowed,true);
  assert.equal(robotsRules("User-agent: *\nDisallow: /*.pdf$","/x.pdf").allowed,false);
  assert.equal(robotsRules("User-agent: *\nDisallow: /*.pdf$","/x.pdf/other").allowed,true);
  assert.equal(robotsRules("User-agent: *\nDisallow:","/anything").allowed,true);
  assert.equal(robotsRules("User-agent: Research\nAllow: /secret\nUser-agent: ResearchAtlasBot\nDisallow: /secret","/secret").allowed,false);
  assert.equal(robotsRules("User-agent: *\nDisallow: /\nUser-agent:\nAllow: /","/secret").allowed,false);
});

function testDatabase(latencyMs=0) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE atlas_sources(id TEXT PRIMARY KEY,user_id TEXT,name TEXT,url TEXT,domain TEXT,created_at TEXT,UNIQUE(user_id,url));
    CREATE TABLE atlas_jobs(id TEXT PRIMARY KEY,user_id TEXT,query TEXT,status TEXT,scope TEXT,max_pages INTEGER,max_depth INTEGER,processed INTEGER,indexed INTEGER,errors INTEGER,seed_hosts TEXT,created_at TEXT,updated_at TEXT,lease_until INTEGER);
    CREATE TABLE atlas_pages(id TEXT PRIMARY KEY,user_id TEXT,job_id TEXT,source_id TEXT,url TEXT,title TEXT,description TEXT,domain TEXT,category TEXT,tags TEXT,depth INTEGER,parent_url TEXT,fetched_at TEXT,status TEXT,UNIQUE(user_id,job_id,url));
    CREATE TABLE atlas_queue(id TEXT PRIMARY KEY,user_id TEXT,job_id TEXT,source_id TEXT,url TEXT,domain TEXT,category TEXT,depth INTEGER,parent_url TEXT,status TEXT,created_at TEXT,UNIQUE(user_id,job_id,url));
    CREATE TABLE atlas_events(id TEXT PRIMARY KEY,user_id TEXT,job_id TEXT,time TEXT,level TEXT,message TEXT,url TEXT);
    CREATE TABLE atlas_edges(id TEXT PRIMARY KEY,user_id TEXT,job_id TEXT,source TEXT,target TEXT,UNIQUE(user_id,job_id,source,target));
    CREATE TABLE atlas_bookmarks(user_id TEXT,resource_id TEXT,UNIQUE(user_id,resource_id));
    CREATE TABLE atlas_hosts(host TEXT PRIMARY KEY,next_allowed_at INTEGER DEFAULT 0,robots_text TEXT,robots_status INTEGER,robots_fetched_at INTEGER,crawl_delay INTEGER DEFAULT 1000);
    CREATE TABLE atlas_chat(id TEXT PRIMARY KEY,user_id TEXT,role TEXT,content TEXT,metadata TEXT DEFAULT '{}',created_at TEXT);
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
    return new Response(`<title>Banking paper</title><meta name="description" content="Evidence on banking"><a href="/a">Self</a>`,{headers:{"content-type":"text/html"}});
  }) as typeof fetch;
  try {
    const created=await createJob(db,"alice",{query:"Banking",sourceIds:["feed"],maxPages:5,maxDepth:1,scope:"same-domain"},[{id:"feed",name:"Feed",url:"https://publicresearch.org/",feedUrl:"https://feeds.publicresearch.org/rss",domain:"Finance",category:"Academic research"}]);
    const id=String(created.job.id);
    assert.equal(created.job.queued,1);
    await assert.rejects(()=>stepJob(db,"bob",id),/not found/);
    const first=await stepJob(db,"alice",id);
    assert.equal(first.job.indexed,1);
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
    assert.equal(last.job.indexed,2);
    assert.equal(last.job.errors,1,"Robots-blocked URLs count in failed/blocked totals.");
    assert.equal(last.job.queued,0);
    assert.equal(requested.length,2,"A robots-blocked article must never be fetched.");
    const state=await readState(db,"alice");
    assert.equal(state.pages.length,2);
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
    assert.deepEqual((await readState(db,"bob")).customSources,[]);
  } finally {globalThis.fetch=originalFetch;sqlite.close();}
});

test("D1 integration: X-Robots-Tag nofollow prevents queue expansion and custom URLs have supported domains",async()=>{
  const {db,sqlite,cacheRobots}=testDatabase();
  const originalFetch=globalThis.fetch;
  cacheRobots("publicresearch.org");
  globalThis.fetch=(async()=>new Response(`<title>AI research</title><a href="/child">child</a>`,{headers:{"content-type":"text/html","x-robots-tag":"nofollow"}})) as typeof fetch;
  try {
    const created=await createJob(db,"alice",{query:"AI research",urls:["https://publicresearch.org/"],maxPages:5,maxDepth:2},[]);
    const result=await stepJob(db,"alice",String(created.job.id));
    assert.equal(result.job.status,"completed");
    const state=await readState(db,"alice");
    assert.equal(state.pages[0].domain,"Technology");
    assert.equal(state.edges.length,0);
    assert.equal(researchDomain(undefined,"Case studies on banks"),"Case studies");
  } finally {globalThis.fetch=originalFetch;sqlite.close();}
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
    assert.ok(metrics.calls<=11,'A leaf crawl should not re-read host, job, or page state unnecessarily.');
    metrics.calls=0;metrics.statements=0;
    await readState(db,'alice');
    t.diagnostic(`State snapshot: ${metrics.calls} D1 requests, ${metrics.statements} SQL statements`);
    assert.equal(metrics.calls,1,'All snapshot panels should share one D1 batch.');
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
      INSERT INTO atlas_queue VALUES('old-root','alice','old-run','source','https://research.org/old','Finance','Research',0,NULL,'done','2020-01-01');
      INSERT INTO atlas_queue VALUES('old-child','alice','old-run','source','https://research.org/child','Finance','Research',1,'https://research.org/old','skipped','2020-01-01');
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
