import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
// @ts-expect-error Node's native TypeScript runner requires the explicit extension.
import { researchAnswer,resolveResearchQuery,cleanHistory,retrieveForUser,saveChat,readChat,type ResearchSource } from "../lib/research.ts";

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
function liveFixture(requests:string[]=[]):typeof fetch{
  return (async(input:RequestInfo|URL)=>{
    const url=new URL(String(input)),query=url.searchParams.get("search")||url.searchParams.get("qterm")||"";requests.push(query);
    const topic=/bank/i.test(query)?"banking":/merger|acquisition/i.test(query)?"merger":"pricing";
    return new Response(JSON.stringify(url.hostname==="api.openalex.org"?{results:[providerWork(topic)]}:{documents:{}}),{headers:{"content-type":"application/json"}});
  }) as typeof fetch;
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
    assert.deepEqual(requests,["SaaS pricing","SaaS pricing","Artificial intelligence in banking","Artificial intelligence in banking","mergers and acquisitions case studies","mergers and acquisitions case studies"]);
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
