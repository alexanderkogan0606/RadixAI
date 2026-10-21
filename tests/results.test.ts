import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync,readdirSync } from "node:fs";
// @ts-expect-error Node's native TypeScript runner needs the explicit extension.
import { readResults,ResultsError } from "../lib/results.ts";
// @ts-expect-error Node's native TypeScript runner needs the explicit extension.
import { classifyPageAccess } from "../lib/free-access.ts";
// @ts-expect-error Node's native TypeScript runner needs the explicit extension.
import { assessResource } from "../lib/resource-quality.ts";
// @ts-expect-error Node's native TypeScript runner needs the explicit extension.
import { saveDiscoveredDocuments } from "../lib/discovery-store.ts";

const sources=[
  {id:"free",url:"https://public.example/research",access:"Free"},
  {id:"premium",url:"https://public.example/research/premium",access:"Paid"},
  {id:"paid",url:"https://paid.example/",access:"Paid"},
  {id:"mixed",url:"https://mixed.example/",access:"Mixed"},
  {id:"freemium",url:"https://freemium.example/",access:"Freemium"},
];
const classify=(page:{url:string;sourceId?:string})=>classifyPageAccess(page,sources);
function database(){
  const sqlite=new DatabaseSync(":memory:");
  for(const name of readdirSync(new URL("../drizzle/",import.meta.url)).filter(name=>name.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../drizzle/${name}`,import.meta.url),"utf8"));
  class Prepared{
    sql:string;params:(string|number|null)[];
    constructor(sql:string,params:(string|number|null)[]=[]){this.sql=sql;this.params=params;}
    bind(...params:(string|number|null)[]){return new Prepared(this.sql,params);}
    async all(){return {results:sqlite.prepare(this.sql).all(...this.params),success:true};}
    async run(){const result=sqlite.prepare(this.sql).run(...this.params);return {meta:{changes:Number(result.changes)},success:true};}
  }
  const db={prepare:(sql:string)=>new Prepared(sql),batch:(commands:Prepared[])=>Promise.all(commands.map(command=>/^\s*(SELECT|WITH)\b/i.test(command.sql)?command.all():command.run()))} as unknown as D1Database;
  const job=(id:string,user="alice",query="Banking research question")=>sqlite.prepare("INSERT INTO atlas_jobs(id,user_id,query,status,scope,max_pages,max_depth,seed_hosts,created_at,updated_at) VALUES(?,?,?,'completed','same-domain',300,1,'[]','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z')").run(id,user,query);
  const page=(id:string,options:{user?:string;job?:string;url?:string;sourceId?:string;title?:string;description?:string;tags?:string[];time?:string}={})=>sqlite.prepare("INSERT INTO atlas_pages VALUES(?,?,?,?,?,?,?,'Finance','Research',?,1,'https://public.example/research',?,'indexed')").run(id,options.user??"alice",options.job??"run",options.sourceId??"free",options.url??`https://public.example/research/${id}`,options.title??`Report ${id}`,options.description??"Collected summary",JSON.stringify(options.tags??["banking"]),options.time??"2026-10-18T12:00:00.000Z");
  const read=(params:Record<string,string>={},user="alice")=>readResults(db,user,new URLSearchParams(params),classify,()=>({eligible:true,reason:null,matchedTerms:[],score:0}));
  return {db,sqlite,job,page,read};
}

test("Results paginate every run with stable equal-time ordering and full provenance",async()=>{
  const {sqlite,job,page,read}=database();
  try{
    job("run");job("older","alice","Earlier semiconductor question");
    for(let i=0;i<95;i++)page(`page-${String(i).padStart(3,"0")}`,{job:i%2?"run":"older"});
    const first=await read();
    assert.equal(first.pages.length,40);assert.equal(first.total,95);assert.equal(first.filteredTotal,95);assert.equal(first.excludedAccessCount,0);
    assert.equal(first.pages[0].id,"page-094");
    assert.equal(first.pages[0].query,"Earlier semiconductor question");
    assert.equal(first.pages[0].collectedAt,first.pages[0].fetchedAt);
    assert.equal(first.pages[0].sourceAccess,"Free");
    assert.equal(first.pages[0].validation,"Captured public metadata; full article not verified");
    assert.ok(first.nextCursor);
    page("new-arrival",{time:"2026-10-19T00:00:00.000Z"});
    const second=await read({cursor:first.nextCursor!});
    assert.equal(second.pages.length,40);assert.equal(second.pages[0].id,"page-054");assert.equal(second.total,96);
    const third=await read({cursor:second.nextCursor!});
    assert.equal(third.pages.length,15);assert.equal(third.nextCursor,null);
    const ids=[...first.pages,...second.pages,...third.pages].map(p=>p.id);
    assert.equal(new Set(ids).size,95);assert.ok(!ids.includes("new-arrival"));
    assert.deepEqual(ids,[...ids].sort().reverse());
    assert.ok(!JSON.stringify(first).includes("user_id"));
  }finally{sqlite.close();}
});

test("Results hide corporate-M&A land false positives, merge exact aliases, and retain the document's original objective",async()=>{
  const {db,sqlite}=database();
  try{
    const query="Mergers and acquisitions case studies",base={description:"This report studies corporate acquisitions, financial performance and shareholder outcomes with comparative company evidence.",provider:"OpenAlex",providerRecordUrl:"https://openalex.org/W123",access:"Free" as const,accessBasis:"Provider open-access evidence for this document.",type:"Research paper",domain:"Finance",query,foundAt:"2026-10-21T00:00:00.000Z"};
    await saveDiscoveredDocuments(db,"alice",query,[
      {...base,id:"land",title:"Land acquisition and involuntary resettlement policy",description:"This report studies land acquisition compensation and resettlement in infrastructure financing projects.",url:"https://repository.edu/reports/land"},
      {...base,id:"old",title:"Corporate acquisitions and shareholder performance outcomes",url:"https://zenodo.org/record/7050039",doi:"10.5281/zenodo.7050038"},
      {...base,id:"alias",title:"Corporate acquisitions and shareholder performance outcomes",url:"https://zenodo.org/records/7050039",doi:"10.5281/zenodo.7050039"},
    ]);
    await saveDiscoveredDocuments(db,"alice","land acquisition resettlement",[{...base,id:"actual-land",title:"Land acquisition and involuntary resettlement policy",description:"This report studies land acquisition compensation and resettlement in infrastructure financing projects.",url:"https://repository.edu/reports/land-objective"}]);
    const result=await readResults(db,"alice",new URLSearchParams(),()=>"Free");
    assert.equal(result.rawTotal,4);assert.equal(result.duplicateCount,1);assert.equal(result.excludedQualityCount,1);assert.equal(result.filteredTotal,2);
    assert.ok(result.pages.some(page=>page.query==="land acquisition resettlement"));
    const searched=await readResults(db,"alice",new URLSearchParams({q:"land"}),()=>"Free");
    assert.equal(searched.filteredTotal,1);assert.equal(searched.pages[0].query,"land acquisition resettlement");
    const archive=await readResults(db,"alice",new URLSearchParams({access:"all"}),()=>"Free");
    assert.equal(archive.filteredTotal,3);assert.equal(Number(sqlite.prepare("SELECT count(*) AS n FROM atlas_documents").get()?.n),4);
    assert.deepEqual((await readResults(db,"bob",new URLSearchParams(),()=>"Free")).pages,[]);
  }finally{sqlite.close();}
});

test("Discovered documents merge with captures, remove generic failures, retain query provenance and deduplicate URLs",async()=>{
  const {sqlite,db,job,page}=database();
  try{
    job("run","alice","bank merger acquisition integration");
    page("useful",{title:"Bank merger integration and acquisition outcomes",description:"This empirical study compares bank merger integration and acquisition outcomes across institutions using measured profitability and cost data."});
    page("gate",{title:"Your session has expired",description:"Please sign in to continue your research session."});
    page("homepage",{url:"https://public.example/",title:"Public Research",description:"Find all research and resources on our homepage."});
    page("offtopic",{title:"Nuclear reactor cooling system design",description:"Engineering analysis of reactor cooling systems and thermal performance for new nuclear power stations."});
    page("duplicate",{url:"https://papers.example/merger-study",title:"Bank merger integration and acquisition outcomes",description:"This empirical study compares bank merger integration and acquisition outcomes across institutions using measured profitability and cost data."});
    const [document]=await saveDiscoveredDocuments(db,"alice","bank merger acquisition integration",[{id:"W123",title:"Bank merger integration and acquisition outcomes",url:"https://papers.example/merger-study",description:"This empirical study compares bank merger integration and acquisition outcomes across institutions using measured profitability and cost data.",provider:"OpenAlex",providerRecordUrl:"https://openalex.org/W123",access:"Free",accessBasis:"OpenAlex reports an open-access repository location; destination not independently fetched.",type:"Research paper",domain:"Finance",query:"bank merger acquisition integration",foundAt:"2026-10-19T00:00:00.000Z"}]);
    const freeAll=()=>readResults(db,"alice",new URLSearchParams(),()=>"Free",assessResource);
    const results=await freeAll();
    assert.equal(results.rawTotal,6);assert.equal(results.total,5);assert.equal(results.crawlTotal,5);assert.equal(results.discoveryTotal,1);assert.equal(results.duplicateCount,1);
    assert.equal(results.filteredTotal,2);assert.equal(results.excludedQualityCount,3);
    assert.deepEqual(new Set(results.pages.map(p=>p.id)),new Set([document.id,"useful"]));
    const found=results.pages.find(p=>p.id===document.id)!;
    assert.equal(found.origin,"discovery");assert.equal(found.type,"Discovered document");assert.equal(found.provider,"OpenAlex");assert.equal(found.query,"bank merger acquisition integration");assert.ok(found.accessBasis.includes("OpenAlex"));assert.ok(found.validation.includes("not independently fetched"));
    const archive=await readResults(db,"alice",new URLSearchParams({access:"all"}),()=>"Free",assessResource);
    assert.equal(archive.filteredTotal,5);assert.ok(archive.pages.some(p=>p.id==="gate"));assert.equal(archive.excludedQualityCount,0);
    const run=await readResults(db,"alice",new URLSearchParams({jobId:"run"}),classify,assessResource);
    assert.ok(run.pages.every(p=>p.origin==="crawl"));assert.ok(run.pages.some(p=>p.id==="duplicate"&&p.access==="Free"),"Exact discovered URL evidence can qualify its crawl without qualifying an entire host.");
    sqlite.prepare("INSERT INTO atlas_bookmarks VALUES('alice',?)").run("duplicate");
    sqlite.prepare("INSERT INTO atlas_bookmarks VALUES('bob',?)").run(document.id);
    const saved=await readResults(db,"alice",new URLSearchParams({saved:"true"}),classify,assessResource);
    assert.deepEqual(saved.pages.map(p=>p.id),["duplicate"]);assert.equal(saved.pages[0].saved,true);
    const bob=await readResults(db,"bob",new URLSearchParams({saved:"true"}),classify,assessResource);
    assert.equal(bob.total,0);assert.deepEqual(bob.pages,[]);
  }finally{sqlite.close();}
});

test("Stable pagination crosses discovered documents and captured pages without leaking another owner's documents",async()=>{
  const {sqlite,db,job,page}=database();
  try{
    job("run","alice","bank merger outcomes");
    for(let i=0;i<7;i++)page(`capture-${i}`,{title:"Bank merger outcomes and profitability",description:"This empirical report examines bank merger outcomes and profitability using comparative evidence from financial institutions."});
    const input=Array.from({length:55},(_,i)=>({id:`W${i}`,title:`Bank merger outcomes and profitability study ${i}`,url:`https://papers.example/merger-${i}`,description:"This empirical study compares bank merger outcomes and profitability across financial institutions using measured data.",provider:"OpenAlex",providerRecordUrl:`https://openalex.org/W${i}`,access:"Free" as const,accessBasis:"OpenAlex reports an open-access repository location.",type:"Research paper",domain:"Finance",query:"bank merger outcomes",foundAt:"2026-10-19T00:00:00.000Z"}));
    await saveDiscoveredDocuments(db,"alice","bank merger outcomes",input);
    await saveDiscoveredDocuments(db,"bob","private merger research",[{...input[0],url:"https://papers.example/bob-secret"}]);
    const first=await readResults(db,"alice",new URLSearchParams(),classify);
    assert.equal(first.pages.length,40);assert.equal(first.filteredTotal,62);assert.equal(first.total,62);assert.ok(first.pages.every(p=>p.origin==="discovery"));
    const second=await readResults(db,"alice",new URLSearchParams({cursor:first.nextCursor!}),classify);
    assert.equal(second.pages.length,22);assert.equal(second.nextCursor,null);assert.equal(second.pages.filter(p=>p.origin==="crawl").length,7);
    const all=[...first.pages,...second.pages];assert.equal(new Set(all.map(p=>p.id)).size,62);assert.ok(!all.some(p=>p.url.includes("bob-secret")));
  }finally{sqlite.close();}
});

test("World Bank curated and canonical captures share exact evidence and one result without losing saved IDs",async()=>{
  const {sqlite,db,job,page}=database(),curated="https://documents.worldbank.org/curated/en/839461489553413671",canonical="https://documents.worldbank.org/en/publication/documents-reports/documentdetail/839461489553413671";
  try{
    job("run","alice","bank merger outcomes");
    const title="Bank merger outcomes and competition",description="This report compares bank merger outcomes and lending competition across financial institutions.";
    const [document]=await saveDiscoveredDocuments(db,"alice","bank merger outcomes",[{id:"worldbank-839461489553413671",title,url:curated,description,provider:"World Bank",providerRecordUrl:curated,access:"Free",accessBasis:"World Bank public document record and PDF evidence.",type:"Report",domain:"Finance",query:"bank merger outcomes",foundAt:"2026-10-19T00:00:00.000Z"}]);
    page("canonical-capture",{url:canonical,title,description});
    page("other-record",{url:canonical.replace(/671$/,"672"),title,description});
    page("extra-path",{url:canonical+"/appendix",title,description});
    page("extra-query",{url:canonical+"?edition=paid",title,description});
    const all=await readResults(db,"alice",new URLSearchParams(),()=>"Unknown");
    assert.equal(all.rawTotal,5);assert.equal(all.total,4);assert.equal(all.duplicateCount,1);assert.equal(all.filteredTotal,1);assert.equal(all.excludedAccessCount,3);
    assert.equal(all.pages[0].id,document.id);assert.equal(all.pages[0].url,curated);
    const run=await readResults(db,"alice",new URLSearchParams({jobId:"run"}),()=>"Unknown");
    assert.deepEqual(run.pages.map(item=>item.id),["canonical-capture"]);assert.equal(run.pages[0].access,"Free");assert.equal(run.pages[0].provider,"World Bank");assert.equal(run.pages[0].providerRecordUrl,curated);
    sqlite.prepare("INSERT INTO atlas_bookmarks VALUES('alice',?)").run(document.id);
    assert.deepEqual((await readResults(db,"alice",new URLSearchParams({saved:"true"}),()=>"Unknown")).pages.map(item=>item.id),[document.id]);
    assert.equal(sqlite.prepare("SELECT url FROM atlas_documents WHERE id=?").get(document.id)?.url,curated);
    const archive=await readResults(db,"alice",new URLSearchParams({access:"all",jobId:"run"}),()=>"Unknown");
    assert.equal(archive.pages.find(item=>item.id==="other-record")?.access,"Unknown");
    assert.deepEqual((await readResults(db,"bob",new URLSearchParams(),()=>"Unknown")).pages,[]);
  }finally{sqlite.close();}
});

for(const query of ["Apple latest earnings report","AAPL Q1 FY2025"]){
  test(`SEC-validated ${query} survives Results without relaxing unrelated crawl relevance`,async()=>{
    const {sqlite,db,job,page}=database();
    const url="https://www.sec.gov/Archives/edgar/data/320193/000032019325000010/aapl-20241228.htm";
    const title="Apple Inc. (AAPL) — Quarterly report, 10-Q, period ended 2024-12-28";
    const description="Apple Inc. (AAPL) filed this quarterly report on Form 10-Q with the U.S. Securities and Exchange Commission. Reporting period ended 2024-12-28; filed 2025-01-31. Accession 0000320193-25-000010. This is filing metadata; the document's financial results have not been read or analyzed.";
    try{
      assert.equal(assessResource({url,title,description},query).reason,"off-topic","The request wording is absent from factual filing metadata.");
      const [document]=await saveDiscoveredDocuments(db,"alice",query,[{id:"sec-320193-0000320193-25-000010",url,title,description,provider:"SEC EDGAR",providerRecordUrl:url.replace("aapl-20241228.htm","0000320193-25-000010-index.html"),access:"Free",accessBasis:"SEC submissions validates this company's CIK, form, accession and reporting period.",fullTextUrl:url,type:"Quarterly report",domain:"Finance",query,foundAt:"2026-10-19T00:00:00.000Z"}]);
      job("run","alice",query);job("gate","alice",query);job("unrelated","alice","bank merger outcomes");
      page("exact-capture",{url,title,description});
      page("unbacked-capture",{url:url.replace("aapl-20241228.htm","other-filing.htm"),title,description});
      page("gate-capture",{job:"gate",url,title:"Your session has expired",description:"Please sign in to continue your research session."});
      page("unrelated-capture",{job:"unrelated",url,title,description});
      const all=await readResults(db,"alice",new URLSearchParams(),()=>"Free");
      assert.deepEqual(all.pages.map(item=>item.id),[document.id]);
      const run=await readResults(db,"alice",new URLSearchParams({jobId:"run"}),()=>"Free");
      assert.deepEqual(run.pages.map(item=>item.id),["exact-capture"]);
      assert.equal(run.pages[0].provider,"SEC EDGAR");assert.equal(run.pages[0].quality.eligible,true);
      assert.ok(run.pages[0].quality.matchedTerms.length>0,"Preserve actual keyword matches rather than claiming every query term matched.");
      assert.equal(run.excludedQualityCount,1,"A different SEC URL gains no relevance exception from its host.");
      const gate=await readResults(db,"alice",new URLSearchParams({jobId:"gate"}),()=>"Free");
      assert.equal(gate.filteredTotal,0);assert.equal(gate.excludedQualityCount,1,"Provider evidence must not hide a captured access gate.");
      const unrelated=await readResults(db,"alice",new URLSearchParams({jobId:"unrelated"}),()=>"Free");
      assert.equal(unrelated.filteredTotal,0,"The same URL is not automatically relevant to a different, unvalidated question.");
    }finally{sqlite.close();}
  });
}

test("Default free results classify the destination path rather than originating source IDs",async()=>{
  const {sqlite,job,page,read}=database();
  try{
    job("run");
    page("public",{sourceId:"unknown-seed"});
    page("www",{url:"https://www.public.example/research/paper"});
    page("paid-linked",{url:"https://paid.example/paper",sourceId:"free"});
    page("mixed",{url:"https://mixed.example/paper"});
    page("freemium",{url:"https://freemium.example/paper"});
    page("unverified",{url:"https://unknown.example/paper"});
    page("outside-path",{url:"https://public.example/research-other/paper"});
    page("subdomain",{url:"https://other.public.example/research/paper"});
    page("nested-paid",{url:"https://public.example/research/premium/paper"});
    const result=await read();
    assert.deepEqual(result.pages.map(p=>p.id),["www","public"]);
    assert.equal(result.total,9);assert.equal(result.filteredTotal,2);assert.equal(result.excludedAccessCount,7);
    assert.ok(result.pages.every(p=>p.access==="Free"&&p.sourceAccess==="Free"));
    const archive=await read({access:"all"});
    assert.equal(archive.pages.length,9);assert.equal(archive.filteredTotal,9);
    assert.equal(archive.pages.find(p=>p.id==="paid-linked")?.access,"Paid");
    assert.equal(archive.pages.find(p=>p.id==="unverified")?.access,"Unknown");
    assert.equal(archive.pages.find(p=>p.id==="nested-paid")?.access,"Paid");
  }finally{sqlite.close();}
});

test("Counts span classification batches and searching finds captures beyond the state snapshot cap",async()=>{
  const {sqlite,job,page,read}=database();
  try{
    job("run");
    for(let i=0;i<2105;i++)page(`page-${String(i).padStart(4,"0")}`,{url:i<270?`https://paid.example/${i}`:undefined});
    page("old-hidden",{title:"Unique historical evidence",time:"2020-01-01T00:00:00.000Z"});
    const result=await read();
    assert.equal(result.total,2106);assert.equal(result.filteredTotal,1836);assert.equal(result.excludedAccessCount,270);assert.equal(result.pages.length,40);
    const found=await read({q:"unique historical evidence"});
    assert.equal(found.total,2106);assert.equal(found.filteredTotal,1);assert.equal(found.excludedAccessCount,0);assert.deepEqual(found.pages.map(p=>p.id),["old-hidden"]);
  }finally{sqlite.close();}
});

test("Search matches questions and page metadata literally, with job and owner isolation",async()=>{
  const {sqlite,job,page,read}=database();
  try{
    job("run","alice","Semiconductor supply question");job("other","alice","Banking research");job("secret","bob","Hidden research");
    page("literal",{title:"Margins 50%_test O'Reilly",description:"Measured resilience",tags:["special-tag"]});
    page("second",{job:"other",title:"Other report"});
    page("bob-private",{job:"secret",user:"bob",title:"Secret semiconductor supply question"});
    for(const q of ["semiconductor supply question","50%_test","O'Reilly","measured resilience","special-tag","/literal"]){
      const result=await read({q});assert.deepEqual(result.pages.map(p=>p.id),["literal"],q);assert.equal(result.total,2);
    }
    assert.equal((await read({q:"50%_wrong"})).filteredTotal,0);
    assert.equal((await read({q:"'; DROP TABLE atlas_pages; --"})).filteredTotal,0);
    assert.deepEqual((await read({jobId:"other"})).pages.map(p=>p.id),["second"]);
    await assert.rejects(()=>read({jobId:"secret"}),error=>error instanceof ResultsError&&error.status===404);
    await assert.rejects(()=>read({jobId:"missing"}),error=>error instanceof ResultsError&&error.status===404);
    const bob=await read({},"bob");assert.equal(bob.total,1);assert.deepEqual(bob.pages.map(p=>p.id),["bob-private"]);
    const empty=await read({},"charlie");assert.equal(empty.total,0);assert.deepEqual(empty.pages,[]);
  }finally{sqlite.close();}
});

test("Invalid parameters and cursors fail clearly and cursors remain bound to their filters",async()=>{
  const {sqlite,db,job,page,read}=database();
  try{
    job("run");for(let i=0;i<42;i++)page(`page-${i}`);
    const invalidFilters:Record<string,string>[]=[{q:"a".repeat(301)},{jobId:"bad/id"},{access:"paid"},{cursor:"!bad"},{cursor:"e30"},{saved:"yes"}];
    for(const params of invalidFilters)await assert.rejects(()=>read(params),error=>error instanceof ResultsError&&error.status===400);
    for(const name of ["q","jobId","access","cursor","saved"]){
      const params=new URLSearchParams();params.append(name,"x");params.append(name,"y");
      await assert.rejects(()=>readResults(db,"alice",params,classify),/only once/);
    }
    const first=await read();assert.ok(first.nextCursor);
    const changedFilters:Record<string,string>[]=[{q:"banking"},{jobId:"run"},{access:"all"},{saved:"true"}];
    for(const changed of changedFilters)await assert.rejects(()=>read({cursor:first.nextCursor!,...changed}),/Reset pagination/);
    assert.deepEqual((await read({cursor:first.nextCursor!},"someone-else")).pages,[],"An otherwise valid cursor never selects another owner's pages.");
  }finally{sqlite.close();}
});
