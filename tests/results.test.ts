import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
// @ts-expect-error Node's native TypeScript runner needs the explicit extension.
import { readResults,ResultsError } from "../lib/results.ts";
// @ts-expect-error Node's native TypeScript runner needs the explicit extension.
import { classifyPageAccess } from "../lib/free-access.ts";

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
  sqlite.exec(`
    CREATE TABLE atlas_jobs(id TEXT PRIMARY KEY,user_id TEXT,query TEXT);
    CREATE TABLE atlas_pages(id TEXT PRIMARY KEY,user_id TEXT,job_id TEXT,source_id TEXT,url TEXT,title TEXT,description TEXT,domain TEXT,category TEXT,tags TEXT,depth INTEGER,parent_url TEXT,fetched_at TEXT,status TEXT);
  `);
  class Prepared{
    sql:string;params:(string|number|null)[];
    constructor(sql:string,params:(string|number|null)[]=[]){this.sql=sql;this.params=params;}
    bind(...params:(string|number|null)[]){return new Prepared(this.sql,params);}
    async all(){return {results:sqlite.prepare(this.sql).all(...this.params),success:true};}
  }
  const db={prepare:(sql:string)=>new Prepared(sql),batch:(commands:Prepared[])=>Promise.all(commands.map(command=>command.all()))} as unknown as D1Database;
  const job=(id:string,user="alice",query="Banking research question")=>sqlite.prepare("INSERT INTO atlas_jobs VALUES(?,?,?)").run(id,user,query);
  const page=(id:string,options:{user?:string;job?:string;url?:string;sourceId?:string;title?:string;description?:string;tags?:string[];time?:string}={})=>sqlite.prepare("INSERT INTO atlas_pages VALUES(?,?,?,?,?,?,?,'Finance','Research',?,1,'https://public.example/research',?,'indexed')").run(id,options.user??"alice",options.job??"run",options.sourceId??"free",options.url??`https://public.example/research/${id}`,options.title??`Report ${id}`,options.description??"Collected summary",JSON.stringify(options.tags??["banking"]),options.time??"2026-10-18T12:00:00.000Z");
  const read=(params:Record<string,string>={},user="alice")=>readResults(db,user,new URLSearchParams(params),classify);
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
    const invalidFilters:Record<string,string>[]=[{q:"a".repeat(301)},{jobId:"bad/id"},{access:"paid"},{cursor:"!bad"},{cursor:"e30"}];
    for(const params of invalidFilters)await assert.rejects(()=>read(params),error=>error instanceof ResultsError&&error.status===400);
    for(const name of ["q","jobId","access","cursor"]){
      const params=new URLSearchParams();params.append(name,"x");params.append(name,"y");
      await assert.rejects(()=>readResults(db,"alice",params,classify),/only once/);
    }
    const first=await read();assert.ok(first.nextCursor);
    const changedFilters:Record<string,string>[]=[{q:"banking"},{jobId:"run"},{access:"all"}];
    for(const changed of changedFilters)await assert.rejects(()=>read({cursor:first.nextCursor!,...changed}),/Reset pagination/);
    assert.deepEqual((await read({cursor:first.nextCursor!},"someone-else")).pages,[],"An otherwise valid cursor never selects another owner's pages.");
  }finally{sqlite.close();}
});
