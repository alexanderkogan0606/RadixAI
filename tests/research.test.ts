import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
// @ts-expect-error Node's native TypeScript runner requires the explicit extension.
import { researchAnswer,resolveResearchQuery,cleanHistory,retrieveForUser,saveChat,readChat,runResearchRequest,ResearchRequestError,type ResearchSource } from "../lib/research.ts";
// @ts-expect-error Node's native TypeScript runner requires the explicit extension.
import {saveDiscoveredDocuments} from "../lib/discovery-store.ts";

const catalog:ResearchSource[]=[{id:"free-library",name:"Generic Research Library",url:"https://publicresearch.org/",domain:"Business",category:"Research",type:"Research library",access:"Free",description:"SaaS pricing, artificial intelligence in banking, and mergers research library.",tags:["SaaS","banking","mergers"],geography:"Global",crawlMethod:"Manual",verification:"Discovery seed"}];
const emptyDiscovery={documents:[],providers:[{provider:"OpenAlex" as const,status:"empty" as const,count:0,message:"No matching documents returned."},{provider:"World Bank" as const,status:"empty" as const,count:0,message:"No matching documents returned."}],searchedAt:"2026-10-21T10:00:00.000Z"};

function database(){
  const sqlite=new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE atlas_documents(id TEXT PRIMARY KEY,user_id TEXT,url TEXT,title TEXT,description TEXT,domain TEXT,document_type TEXT,provider TEXT,provider_id TEXT,provider_record_url TEXT,access_basis TEXT,full_text_url TEXT,doi TEXT,published_at TEXT,query TEXT,queries TEXT,discovered_at TEXT,updated_at TEXT,UNIQUE(user_id,url));
    CREATE TABLE atlas_pages(id TEXT PRIMARY KEY,user_id TEXT,url TEXT,title TEXT,description TEXT,source_id TEXT,domain TEXT,category TEXT,tags TEXT,fetched_at TEXT);
    CREATE TABLE atlas_chat(id TEXT PRIMARY KEY,user_id TEXT,role TEXT,content TEXT,metadata TEXT,created_at TEXT);
  `);
  class Statement{
    sql:string;values:(string|number|null)[];
    constructor(sql:string,values:(string|number|null)[]=[]){this.sql=sql;this.values=values;}
    bind(...values:(string|number|null)[]){return new Statement(this.sql,values);}
    async all(){return {results:sqlite.prepare(this.sql).all(...this.values)};}
    async first(){return sqlite.prepare(this.sql).get(...this.values)||null;}
    async run(){const result=sqlite.prepare(this.sql).run(...this.values);return {meta:{changes:Number(result.changes)},success:true};}
  }
  const db={prepare:(sql:string)=>new Statement(sql),batch:async(statements:Statement[])=>{
    sqlite.exec("BEGIN");try{const results=[];for(const statement of statements)results.push(/^\s*SELECT\b/i.test(statement.sql)?await statement.all():await statement.run());sqlite.exec("COMMIT");return results;}catch(error){sqlite.exec("ROLLBACK");throw error;}
  }} as unknown as D1Database;
  return {db,sqlite};
}
function providerWork(topic:"pricing"|"banking"|"merger"){
  const details={pricing:{id:"123",title:"SaaS pricing and retention: evidence from software firms",abstract:"This study measures SaaS pricing changes and customer retention in subscription software firms using cohort data."},banking:{id:"456",title:"Artificial intelligence in banking: measured service outcomes",abstract:"This study evaluates artificial intelligence in banking and compares customer service outcomes across financial institutions."},merger:{id:"789",title:"Mergers and acquisitions: operational performance after integration",abstract:"This paper compares mergers and acquisitions using operational performance and integration costs across major companies."}}[topic];
  const abstract:Record<string,number[]>={};details.abstract.split(/\s+/).forEach((word,i)=>(abstract[word]||=[]).push(i));
  const url=`https://repository.edu/record/${topic}`;
  return {id:`https://openalex.org/W${details.id}`,title:details.title,doi:`https://doi.org/10.1234/${topic}`,publication_date:"2025-01-02",type:"article",open_access:{is_oa:true,oa_url:url},best_oa_location:{is_oa:true,landing_page_url:url,pdf_url:null},abstract_inverted_index:abstract};
}
function fixturePayload(hostname:string,works:unknown[]){return hostname==="api.openalex.org"?{results:works}:hostname==="api.openaire.eu"?{results:[],header:{numFound:0}}:hostname==="api.crossref.org"?{message:{items:[],"total-results":0}}:{documents:{},total:0};}
function liveFixture(requests:string[]=[]):typeof fetch{
  return (async(input:RequestInfo|URL)=>{
    const url=new URL(String(input)),query=url.searchParams.get("search")||url.searchParams.get("qterm")||"";requests.push(query);
    const topic=/bank/i.test(query)?"banking":/merger|acquisition/i.test(query)?"merger":"pricing";
    return new Response(JSON.stringify(fixturePayload(url.hostname,[providerWork(topic)])),{headers:{"content-type":"application/json"}});
  }) as typeof fetch;
}
function continuationFixture(requests:string[]=[]):typeof fetch{
  const original=providerWork("pricing"),url="https://repository.edu/record/pricing-next";
  const next={...original,id:"https://openalex.org/W124",title:"SaaS pricing and retention across software subscription cohorts",doi:"https://doi.org/10.1234/pricing-next",open_access:{is_oa:true,oa_url:url},best_oa_location:{is_oa:true,landing_page_url:url,pdf_url:null}};
  const duplicateUrl="https://another-repository.edu/record/pricing";
  const duplicate={...original,id:"https://openalex.org/W125",doi:"https://doi.org/10.1234/PRICING",open_access:{is_oa:true,oa_url:duplicateUrl},best_oa_location:{is_oa:true,landing_page_url:duplicateUrl,pdf_url:null}};
  return (async(input:RequestInfo|URL)=>{const address=new URL(String(input));requests.push(String(input));return new Response(JSON.stringify(fixturePayload(address.hostname,[original,duplicate,next])),{headers:{"content-type":"application/json"}});}) as typeof fetch;
}
async function seedContinuableSearch(db:D1Database,user="alice"){
  const result=await retrieveForUser(db,user,"SaaS pricing",[],catalog,{fetcher:liveFixture()});
  // A durable provider checkpoint, independent of the fixture provider's available page count.
  result.search={...result.search!,batch:0,nextBatch:1,canContinue:true};
  return {...result,...await saveChat(db,user,"SaaS pricing",result)};
}

test("A new topic resets historical context; only topic-less followups inherit it",()=>{
  const history=[{role:"user" as const,content:"SaaS pricing"},{role:"assistant" as const,content:"SaaS results"}];
  assert.equal(resolveResearchQuery("Artificial intelligence in banking",history),"Artificial intelligence in banking");
  assert.equal(resolveResearchQuery("M&A case studies",history),"mergers and acquisitions case studies");
  assert.equal(resolveResearchQuery("only free sources",history),"SaaS pricing");
  assert.equal(resolveResearchQuery("more case studies",history),"SaaS pricing case studies");
  assert.equal(resolveResearchQuery("measured outcomes",history),"SaaS pricing measured outcomes");
  assert.equal(resolveResearchQuery("only free",[]),"");
});

test("A catalog match never substitutes generic homepages for missing document results",()=>{
  const result=researchAnswer("SaaS pricing",[],catalog,[],emptyDiscovery);
  assert.deepEqual(result.sources,[]);assert.deepEqual(result.documents,[]);assert.deepEqual(result.plan.sourceIds,[]);
  assert.match(result.answer,/No matching free documents/);
  assert.ok(!result.answer.includes("Generic Research Library"));
  assert.ok(!result.answer.includes("https://publicresearch.org/"));
});

test("Captured session notices, homepages, unrelated pages and unknown destinations are excluded",()=>{
  const pages=[
    {id:"session",url:"https://publicresearch.org/study/session",title:"SaaS pricing",description:"Your session has expired. Please sign in again to continue."},
    {id:"home",url:"https://publicresearch.org/",title:"SaaS pricing research",description:"A library of SaaS pricing reports and case studies."},
    {id:"unrelated",url:"https://publicresearch.org/other",title:"Artificial intelligence in banking",description:"A study of artificial intelligence in banking and credit decisions."},
    {id:"unknown",url:"https://unknownresearch.org/pricing",title:"SaaS pricing and retention",description:"Measured SaaS pricing and retention outcomes in software companies.",sourceId:"free-library"},
    {id:"real",url:"https://publicresearch.org/reports/saas-pricing",title:"SaaS pricing and retention outcomes",description:"Measured SaaS pricing and retention outcomes in software companies.",sourceId:"free-library"},
  ];
  const result=researchAnswer("SaaS pricing",[],catalog,pages,emptyDiscovery);
  assert.deepEqual(result.pages.map(page=>page.id),["real"]);assert.match(result.answer,/Captured summary/);
  assert.match(result.answer,/have not read or analyzed the full documents/);
  assert.deepEqual(result.plan.urls,[pages[4].url]);
});

test("Provider failures remain visible and never trigger homepage fallbacks",()=>{
  const providers=[{provider:"OpenAlex" as const,status:"rate-limited" as const,count:0,message:"Free search limit reached.",httpStatus:429},{provider:"World Bank" as const,status:"timeout" as const,count:0,message:"Search timed out."}];
  const result=researchAnswer("SaaS pricing",[],catalog,[],{...emptyDiscovery,providers});
  assert.match(result.answer,/currently unavailable/);assert.match(result.answer,/Free search limit reached/);assert.match(result.answer,/Search timed out/);
  assert.deepEqual(result.sources,[]);assert.deepEqual(result.documents,[]);assert.deepEqual(result.providers,providers);
});

test("Topic-less first prompts do not dump unrelated historical pages",()=>{
  const pages=[{id:"past",url:"https://publicresearch.org/reports/pricing",title:"SaaS pricing and retention outcomes",description:"Measured SaaS pricing and retention outcomes in software companies."}];
  for(const message of ["only free","crawl test"]){
    const result=researchAnswer(message,[],catalog,pages,emptyDiscovery);
    assert.deepEqual(result.pages,[]);assert.deepEqual(result.documents,[]);assert.match(result.answer,/Enter a specific topic/);
  }
});

test("Live research persists specific documents, changes results by query, and plans document IDs",async()=>{
  const {db,sqlite}=database(),requests:string[]=[];
  try{
    const pricing=await retrieveForUser(db,"alice","SaaS pricing",[],catalog,{fetcher:liveFixture(requests)});
    const banking=await retrieveForUser(db,"alice","Artificial intelligence in banking",[{role:"user",content:"SaaS pricing"}],catalog,{fetcher:liveFixture(requests)});
    const merger=await retrieveForUser(db,"alice","M&A case studies",[{role:"user",content:"SaaS pricing"}],catalog,{fetcher:liveFixture(requests)});
    assert.equal(pricing.documents.length,1);assert.equal(banking.documents.length,1);assert.equal(merger.documents.length,1);
    assert.match(pricing.documents[0].title,/SaaS pricing/);assert.match(banking.documents[0].title,/banking/);assert.match(merger.documents[0].title,/Mergers/);
    assert.notEqual(pricing.documents[0].id,banking.documents[0].id);assert.notEqual(banking.documents[0].id,merger.documents[0].id);
    assert.match(pricing.documents[0].id,/^document-/);assert.equal(pricing.documents[0].providerId,"openalex-W123");
    assert.deepEqual(pricing.plan.sourceIds,[pricing.documents[0].id]);assert.deepEqual(pricing.plan.urls,[pricing.documents[0].url]);
    assert.deepEqual(pricing.sources,[]);assert.equal(pricing.mode,"retrieval");assert.match(pricing.answer,/Provider summary/);assert.match(pricing.answer,/have not read or analyzed the full documents/);
    assert.equal(Number(sqlite.prepare("SELECT count(*) AS n FROM atlas_documents WHERE user_id='alice'").get()?.n),3);
    assert.ok(requests.some(query=>/saas pricing/i.test(query)));assert.ok(requests.some(query=>/banking/i.test(query)));assert.ok(requests.some(query=>/merger|acquisition/i.test(query)));
  }finally{sqlite.close();}
});

test("Free-only followups cannot enable paid documents and repeated searches keep stable stored IDs",async()=>{
  const {db,sqlite}=database();
  try{
    const first=await retrieveForUser(db,"alice","SaaS pricing",[],catalog,{fetcher:liveFixture()});
    const followup=await retrieveForUser(db,"alice","include paid",[{role:"user",content:"SaaS pricing"}],catalog,{fetcher:liveFixture()});
    assert.equal(followup.plan.query,"SaaS pricing");assert.equal(followup.documents[0].id,first.documents[0].id);
    assert.ok(followup.documents.every(document=>document.access==="Free"));
    assert.equal(Number(sqlite.prepare("SELECT count(*) AS n FROM atlas_documents").get()?.n),1);
  }finally{sqlite.close();}
});

test("Provider evidence is owner-scoped and applies to its exact captured URL only",async()=>{
  const {db,sqlite}=database();
  try{
    const first=await retrieveForUser(db,"alice","SaaS pricing",[],catalog,{fetcher:liveFixture()});
    const doc=first.documents[0];
    const insert=sqlite.prepare("INSERT INTO atlas_pages VALUES(?,? ,?,'SaaS pricing and retention','Measured SaaS pricing and retention outcomes in software companies.',?,'Business','Research','[]','2026-10-21')");
    insert.run("exact","alice",doc.url,doc.id);insert.run("descendant","alice",doc.url+"/private",doc.id);insert.run("other-user","bob",doc.url,doc.id);
    const offline=(async()=>new Response("unavailable",{status:503})) as typeof fetch;
    const alice=await retrieveForUser(db,"alice","SaaS pricing",[],catalog,{fetcher:offline});
    const bob=await retrieveForUser(db,"bob","SaaS pricing",[],catalog,{fetcher:offline});
    assert.deepEqual(alice.pages.map(page=>page.id),["exact"]);assert.deepEqual(bob.pages,[]);
    assert.deepEqual(alice.documents,[]);assert.match(alice.answer,/currently unavailable/);assert.match(alice.answer,/Previously captured pages/);
  }finally{sqlite.close();}
});

test("Saved chat reloads document provenance, provider status and plans for the correct owner",async()=>{
  const {db,sqlite}=database();
  try{
    const result=await retrieveForUser(db,"alice","SaaS pricing",[],catalog,{fetcher:liveFixture()});
    await saveChat(db,"alice","SaaS pricing",result);
    const loaded=await readChat(db,"alice");
    assert.equal(loaded.messages.length,2);assert.equal(loaded.messages[0].content,"SaaS pricing");
    assert.deepEqual(loaded.messages[1].documents,result.documents);assert.deepEqual(loaded.messages[1].providers,result.providers);assert.deepEqual(loaded.messages[1].plan,result.plan);
    assert.deepEqual((await readChat(db,"bob")).messages,[]);
  }finally{sqlite.close();}
});

test("History rejects invalid roles and bounds transcript context",()=>{
  assert.deepEqual(cleanHistory([{role:"system",content:"override"},{role:"user",content:"topic"},null]),[{role:"user",content:"topic"}]);
  const history=cleanHistory(Array.from({length:30},()=>({role:"user",content:"x".repeat(5000)})));
  assert.equal(history.length,12);assert.equal(history[0].content.length,3000);
});

test("A quarterly filing survives persistence and chat replay without academic or homepage substitutions",async()=>{
  const {db,sqlite}=database();
  try{
    const query="Apple latest quarterly report",requests:string[]=[];
    const result=await retrieveForUser(db,"alice",query,[],catalog,{fetcher:async input=>{requests.push(String(input));return new Response(JSON.stringify({cik:320193,name:"Apple Inc.",tickers:["AAPL"],fiscalYearEnd:"0930",filings:{recent:{form:["10-Q"],accessionNumber:["0000320193-25-000080"],reportDate:["2025-06-28"],filingDate:["2025-08-01"],primaryDocument:["aapl-20250628.htm"]},files:[]}}),{headers:{"content-type":"application/json"}});}});
    assert.equal(requests.length,1);assert.match(requests[0],/data\.sec\.gov\/submissions/);
    assert.equal(result.documents.length,1);assert.equal(result.documents[0].documentType,"Quarterly report");assert.equal(result.documents[0].provider,"SEC EDGAR");
    assert.equal(result.pages.length,0);assert.equal(result.sources.length,0);assert.match(result.answer,/period ended 2025-06-28/);
    assert.deepEqual(result.plan.urls,[result.documents[0].url]);
    await saveChat(db,"alice",query,result);const replay=await readChat(db,"alice");
    assert.equal(replay.messages[1].documents?.[0].documentType,"Quarterly report");assert.equal(replay.messages[1].providers?.[0].provider,"SEC EDGAR");
  }finally{sqlite.close();}
});

test("Continuation uses the owned saved query and returns new documents first with accurate cumulative counts",async()=>{
  const {db,sqlite}=database();
  try{
    const first=await seedContinuableSearch(db),requests:string[]=[];
    const more=await runResearchRequest(db,"alice",{continueFrom:first.id,message:"Search an unrelated subject",history:[{role:"user",content:"Unrelated subject"}]},catalog,{fetcher:continuationFixture(requests)});
    assert.equal(more.plan.query,"SaaS pricing");assert.equal(more.documents.length,2);
    assert.match(more.documents[0].url,/pricing-next$/);assert.equal(more.documents[1].id,first.documents[0].id);
    assert.equal(more.search?.batch,1);assert.equal(more.search?.parentMessageId,first.id);assert.equal(more.search?.chainId,first.search?.chainId);
    assert.equal(more.search?.newDocumentsCount,1);assert.equal(more.search?.totalDocuments,2);
    assert.equal(more.search?.newCount,1);assert.equal(more.search?.totalCount,2);
    assert.match(more.answer,/1 new free document in this batch; 2 collected/);
    assert.deepEqual(more.plan.sourceIds,more.documents.map(document=>document.id));
    assert.ok(requests.every(url=>!url.includes("Unrelated")));
    const stored=sqlite.prepare("SELECT metadata FROM atlas_chat WHERE id=?").get(more.id);
    const metadata=JSON.parse(String(stored?.metadata));
    assert.deepEqual(metadata.documents,[]);assert.deepEqual(metadata.documentIds,more.documents.map(document=>document.id));
    assert.ok(!String(stored?.metadata).includes(more.documents[0].description),"Full abstracts are stored only in the documents table.");
    const replay=await readChat(db,"alice"),old=replay.messages.find(message=>message.id===first.id),latest=replay.messages.find(message=>message.id===more.id);
    assert.equal(old?.supersededBy,more.id);assert.deepEqual(old?.documents,[]);assert.equal(old?.search?.canContinue,false);
    assert.deepEqual(latest?.documents?.map(document=>document.id),more.documents.map(document=>document.id));
    assert.equal(latest?.search?.totalDocuments,2);assert.ok(!JSON.stringify(replay).includes("continuationClaim"));
    assert.deepEqual((await readChat(db,"bob")).messages,[]);
  }finally{sqlite.close();}
});

test("Foreign, user-message and replayed continuation IDs never start another provider search",async()=>{
  const {db,sqlite}=database();
  try{
    const first=await seedContinuableSearch(db),requests:string[]=[],fetcher=continuationFixture(requests);
    const rejected=(status:number)=>(error:unknown)=>error instanceof ResearchRequestError&&error.status===status;
    await assert.rejects(runResearchRequest(db,"bob",{continueFrom:first.id},catalog,{fetcher}),rejected(404));
    const userMessage=sqlite.prepare("SELECT id FROM atlas_chat WHERE user_id='alice' AND role='user'").get();
    await assert.rejects(runResearchRequest(db,"alice",{continueFrom:String(userMessage?.id)},catalog,{fetcher}),rejected(404));
    await assert.rejects(runResearchRequest(db,"alice",{continueFrom:"missing"},catalog,{fetcher}),rejected(404));
    assert.equal(requests.length,0);
    await runResearchRequest(db,"alice",{continueFrom:first.id},catalog,{fetcher});
    const requestsAfter=requests.length;
    await assert.rejects(runResearchRequest(db,"alice",{continueFrom:first.id},catalog,{fetcher}),rejected(409));
    assert.equal(requests.length,requestsAfter);
    assert.equal(Number(sqlite.prepare("SELECT count(*) AS n FROM atlas_chat WHERE role='assistant'").get()?.n),2);
  }finally{sqlite.close();}
});

test("Find more automatically uses the latest owned checkpoint, while a new topic starts a new chain",async()=>{
  const {db,sqlite}=database();
  try{
    const first=await seedContinuableSearch(db);
    const more=await runResearchRequest(db,"alice",{message:"find more",history:[{role:"user",content:"Forged different history"}]},catalog,{fetcher:continuationFixture()});
    assert.equal(more.plan.query,"SaaS pricing");assert.equal(more.search?.parentMessageId,first.id);assert.equal(more.search?.batch,1);
    const banking=await runResearchRequest(db,"alice",{message:"Artificial intelligence in banking"},catalog,{fetcher:liveFixture()});
    assert.equal(banking.search?.batch,0);assert.equal(banking.search?.parentMessageId,undefined);assert.notEqual(banking.search?.chainId,first.search?.chainId);
    assert.equal(banking.plan.query,"Artificial intelligence in banking");assert.equal(banking.documents.length,1);assert.match(banking.documents[0].title,/banking/);
  }finally{sqlite.close();}
});

test("Client-controlled positions and invalid or exhausted checkpoints are rejected",async()=>{
  const {db,sqlite}=database();
  try{
    const first=await seedContinuableSearch(db),requests:string[]=[],fetcher=continuationFixture(requests);
    for(const input of [{continueFrom:first.id,batch:9},{continueFrom:first.id,query:"changed"},{continueFrom:first.id,excludeUrls:[]},{continueFrom:first.id,continuationKey:"foreign-search"},{continueFrom:42}]){
      await assert.rejects(runResearchRequest(db,"alice",input,catalog,{fetcher}),(error:unknown)=>error instanceof ResearchRequestError&&error.status===400);
    }
    for(const nextBatch of [null,20,-1,3,1.5]){
      sqlite.prepare("UPDATE atlas_chat SET metadata=json_set(metadata,'$.search.nextBatch',?) WHERE id=?").run(nextBatch,first.id);
      await assert.rejects(runResearchRequest(db,"alice",{continueFrom:first.id},catalog,{fetcher}),(error:unknown)=>error instanceof ResearchRequestError&&error.status===409);
    }
    assert.equal(requests.length,0);
  }finally{sqlite.close();}
});

test("An in-flight continuation atomically claims its parent and cannot create a second branch",async()=>{
  const {db,sqlite}=database();
  try{
    const first=await seedContinuableSearch(db);
    let release!:()=>void,entered!:()=>void;
    const barrier=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
    const fixture=continuationFixture(),fetcher=(async(input:RequestInfo|URL,init?:RequestInit)=>{entered();await barrier;return fixture(input,init);}) as typeof fetch;
    const pending=runResearchRequest(db,"alice",{continueFrom:first.id},catalog,{fetcher});
    await started;
    await assert.rejects(runResearchRequest(db,"alice",{continueFrom:first.id},catalog,{fetcher:continuationFixture()}),(error:unknown)=>error instanceof ResearchRequestError&&error.status===409);
    release();const result=await pending;
    assert.equal(result.search?.newDocumentsCount,1);
    assert.equal(Number(sqlite.prepare("SELECT count(*) AS n FROM atlas_chat WHERE role='assistant'").get()?.n),2);
  }finally{sqlite.close();}
});

test("A failed chat save releases its checkpoint and permits a safe retry without duplicate documents",async()=>{
  const {db,sqlite}=database();
  try{
    const first=await seedContinuableSearch(db);
    let failSave=true;
    const interrupted={...db,batch:async(statements:D1PreparedStatement[])=>{
      if(failSave&&statements.some(statement=>(statement as unknown as {sql:string}).sql.includes("INSERT INTO atlas_chat"))){failSave=false;throw new Error("Simulated chat persistence failure");}
      return db.batch(statements);
    }} as D1Database;
    await assert.rejects(runResearchRequest(interrupted,"alice",{continueFrom:first.id},catalog,{fetcher:continuationFixture()}),/Simulated chat persistence failure/);
    const parent=JSON.parse(String(sqlite.prepare("SELECT metadata FROM atlas_chat WHERE id=?").get(first.id)?.metadata));
    assert.equal(parent.search.continuationClaim,undefined);assert.equal(parent.search.canContinue,true);assert.equal(parent.search.continuedBy,undefined);
    const retried=await runResearchRequest(db,"alice",{continueFrom:first.id},catalog,{fetcher:continuationFixture()});
    assert.equal(retried.documents.length,2);assert.equal(retried.search?.newDocumentsCount,0);
    assert.equal(Number(sqlite.prepare("SELECT count(*) AS n FROM atlas_documents WHERE user_id='alice'").get()?.n),2);
    assert.equal(Number(sqlite.prepare("SELECT count(*) AS n FROM atlas_chat WHERE role='assistant'").get()?.n),2);
  }finally{sqlite.close();}
});

test("Expired worker claims become continuable on reload and can be reclaimed without exposing claim tokens",async()=>{
  const {db,sqlite}=database();
  try{
    const first=await seedContinuableSearch(db);
    sqlite.prepare("UPDATE atlas_chat SET metadata=json_set(metadata,'$.search.continuationClaim','abandoned-worker','$.search.continuationClaimedUntil',0,'$.search.canContinue',json('false')) WHERE id=?").run(first.id);
    const restored=await readChat(db,"alice"),message=restored.messages.find(message=>message.id===first.id);
    assert.equal(message?.search?.canContinue,true);assert.ok(!JSON.stringify(restored).includes("abandoned-worker"));
    const more=await runResearchRequest(db,"alice",{continueFrom:first.id},catalog,{fetcher:continuationFixture()});
    assert.equal(more.search?.parentMessageId,first.id);assert.equal(more.search?.newDocumentsCount,1);
  }finally{sqlite.close();}
});

test("Twenty sequential batches keep durable owner-scoped checkpoints and compact cumulative plans",async()=>{
  const {db,sqlite}=database();
  try{
    let searches=0,requests=0;
    const fetcher=(async(input:RequestInfo|URL)=>{
      requests++;const address=new URL(String(input));
      if(address.hostname!=="api.openalex.org")return new Response(JSON.stringify(fixturePayload(address.hostname,[])),{headers:{"content-type":"application/json"}});
      const index=searches++,url=`https://repository.edu/record/pricing-${index}`,original=providerWork("pricing");
      const work={...original,id:`https://openalex.org/W${3000+index}`,doi:`https://doi.org/10.1234/pricing-${index}`,title:`SaaS pricing and customer retention in software subscription cohort ${index}`,open_access:{is_oa:true,oa_url:url},best_oa_location:{is_oa:true,landing_page_url:url,pdf_url:null}};
      return new Response(JSON.stringify({results:[work],meta:{count:100000}}),{headers:{"content-type":"application/json"}});
    }) as typeof fetch;
    let current=await runResearchRequest(db,"alice",{message:"SaaS pricing"},catalog,{fetcher});
    const chainId=current.search?.chainId,ids:string[]=[];
    for(let batch=0;batch<20;batch++){
      if(batch){const parentId=current.id;current=await runResearchRequest(db,"alice",{continueFrom:parentId},catalog,{fetcher});assert.equal(current.search?.parentMessageId,parentId);}
      ids.push(current.id);assert.equal(current.search?.batch,batch);assert.equal(current.search?.chainId,chainId);
      assert.equal(current.search?.newDocumentsCount,1);assert.equal(current.search?.totalDocuments,batch+1);
      assert.equal(current.documents.length,batch+1);assert.match(current.documents[0].url,new RegExp(`pricing-${batch}$`));
      assert.equal(current.search?.nextBatch,batch===19?null:batch+1);assert.equal(current.search?.canContinue,batch<19);
      const stored=JSON.parse(String(sqlite.prepare("SELECT metadata FROM atlas_chat WHERE id=?").get(current.id)?.metadata));
      assert.deepEqual(stored.documents,[]);assert.deepEqual(stored.plan.sourceIds,[]);assert.deepEqual(stored.plan.urls,[]);
      assert.equal(stored.documentIds.length,batch+1);assert.ok(JSON.stringify(stored).length<15000);
    }
    const loaded=await readChat(db,"alice"),assistants=loaded.messages.filter(message=>message.role==="assistant");
    assert.equal(loaded.messages.length,40);assert.equal(assistants.length,20);assert.equal(assistants.at(-1)?.documents?.length,20);
    assert.deepEqual(assistants.at(-1)?.plan,current.plan);assert.equal(assistants.at(-1)?.search?.nextBatch,null);
    for(const [index,message] of assistants.slice(0,-1).entries()){
      assert.equal(message.id,ids[index]);assert.equal(message.supersededBy,current.id);assert.deepEqual(message.documents,[]);
      assert.deepEqual(message.plan?.urls,[]);assert.equal(message.search?.totalDocuments,index+1);assert.equal(message.search?.canContinue,false);
    }
    assert.deepEqual((await readChat(db,"bob")).messages,[]);
    const before=requests;
    await assert.rejects(runResearchRequest(db,"alice",{continueFrom:current.id},catalog,{fetcher}),(error:unknown)=>error instanceof ResearchRequestError&&error.status===409);
    assert.equal(requests,before);assert.equal(searches,20);
  }finally{sqlite.close();}
});

test("A provider outage preserves collected documents and leaves a durable continuation checkpoint",async()=>{
  const {db,sqlite}=database();
  try{
    const first=await seedContinuableSearch(db);
    const more=await runResearchRequest(db,"alice",{continueFrom:first.id},catalog,{fetcher:(async()=>new Response("unavailable",{status:503})) as typeof fetch});
    assert.equal(more.search?.newDocumentsCount,0);assert.equal(more.search?.totalDocuments,1);assert.equal(more.search?.nextBatch,2);
    assert.equal(more.search?.canContinue,true);assert.deepEqual(more.documents.map(document=>document.id),first.documents.map(document=>document.id));
    assert.ok(more.providers.every(provider=>!["ok","empty"].includes(provider.status)));
    assert.match(more.answer,/0 new free documents in this batch; 1 collected/);
    const latest=(await readChat(db,"alice")).messages.find(message=>message.id===more.id);
    assert.equal(latest?.search?.nextBatch,2);assert.deepEqual(latest?.plan,more.plan);
  }finally{sqlite.close();}
});

test("A document persistence failure can retry its checkpoint without losing provider matches",async()=>{
  const {db,sqlite}=database();
  try{
    const first=await seedContinuableSearch(db),fetcher=continuationFixture();
    let failSave=true;
    const interrupted={...db,batch:async(statements:D1PreparedStatement[])=>{
      if(failSave&&statements.some(statement=>(statement as unknown as {sql:string}).sql.includes("INSERT INTO atlas_documents"))){failSave=false;throw new Error("Simulated document persistence failure");}
      return db.batch(statements);
    }} as D1Database;
    await assert.rejects(runResearchRequest(interrupted,"alice",{continueFrom:first.id},catalog,{fetcher}),/Simulated document persistence failure/);
    assert.equal(Number(sqlite.prepare("SELECT count(*) AS n FROM atlas_documents").get()?.n),1);
    const retried=await runResearchRequest(db,"alice",{continueFrom:first.id},catalog,{fetcher});
    assert.equal(retried.search?.newDocumentsCount,1);assert.equal(retried.documents.length,2);
    assert.match(retried.documents[0].url,/pricing-next$/);
  }finally{sqlite.close();}
});

test("Latest chat hydration corrects historical topic and identity counts without rewriting its raw archive",async()=>{
  const {db,sqlite}=database();
  try{
    const query="Mergers and acquisitions case studies",base={description:"This report studies corporate acquisitions, financial performance and shareholder outcomes with comparative company evidence.",provider:"OpenAlex",providerRecordUrl:"https://openalex.org/W123",access:"Free" as const,accessBasis:"Provider open-access evidence for this document.",type:"Research paper",domain:"Finance",query,foundAt:"2026-10-21T00:00:00.000Z"};
    const documents=await saveDiscoveredDocuments(db,"alice",query,[
      {...base,id:"land",title:"Land acquisition and involuntary resettlement policy",description:"This report studies land acquisition compensation and resettlement in infrastructure financing projects.",url:"https://repository.edu/reports/land"},
      {...base,id:"old",title:"Corporate acquisitions and shareholder performance outcomes",url:"https://zenodo.org/record/7050039",doi:"10.5281/zenodo.7050038"},
      {...base,id:"alias",title:"Corporate acquisitions and shareholder performance outcomes",url:"https://zenodo.org/records/7050039",doi:"10.5281/zenodo.7050039"},
      {...base,id:"minority",title:"Minority shareholder expropriation in corporate acquisitions",url:"https://repository.edu/reports/shareholders"},
    ]);
    const result={...researchAnswer(query,[],catalog),documents,answer:"I found 4 new free documents; 4 collected.",search:{batch:0,nextBatch:1,chainId:crypto.randomUUID(),candidatesChecked:4,queryVariants:[query],newDocumentsCount:4,totalDocuments:4,newCount:4,totalCount:4,canContinue:true}};
    const saved=await saveChat(db,"alice",query,result),before=sqlite.prepare("SELECT metadata FROM atlas_chat WHERE id=?").get(saved.id)?.metadata;
    const latest=(await readChat(db,"alice")).messages.find(message=>message.id===saved.id)!;
    assert.equal(latest.documents?.length,2);assert.equal(latest.search?.totalDocuments,2);assert.equal(latest.search?.newDocumentsCount,2);
    assert.match(latest.content,/2 new free documents in this batch; 2 collected/);assert.equal(latest.plan?.urls.length,2);
    assert.ok(latest.documents?.some(document=>document.title.includes("expropriation")));assert.ok(!latest.documents?.some(document=>document.title.startsWith("Land")));
    assert.equal(sqlite.prepare("SELECT metadata FROM atlas_chat WHERE id=?").get(saved.id)?.metadata,before);
    assert.equal(Number(sqlite.prepare("SELECT count(*) AS n FROM atlas_documents").get()?.n),4);
  }finally{sqlite.close();}
});
