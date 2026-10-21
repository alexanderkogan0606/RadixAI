import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's native TypeScript tests require the explicit extension.
import {computeCrawlMetrics,type CrawlMetricPage} from "../lib/crawl-metrics.ts";

const start="2026-10-21T12:00:00.000Z";
const at=(seconds:number)=>new Date(Date.parse(start)+seconds*1000).toISOString();
const page=(id:string,title:string,description:string,seconds:number):CrawlMetricPage=>({id,url:`https://research.org/${id}`,title,description,fetchedAt:at(seconds)});

test("Empty input has no invented time, match score, rate or request samples",()=>{
  const metrics=computeCrawlMetrics();
  assert.equal(metrics.elapsedMs,null);assert.equal(metrics.metadataWordsPerMinute,null);assert.equal(metrics.metadataMatch,null);
  assert.equal(metrics.metadataWordCount,0);assert.equal(metrics.pagesAnalyzed,0);assert.equal(metrics.totalDiscovered,0);
  assert.deepEqual(metrics.websites,[]);assert.deepEqual(metrics.termRows,[]);assert.deepEqual(metrics.columns,[]);
  assert.deepEqual(metrics.matchHistory,[]);assert.deepEqual(metrics.fetchSamples,[]);assert.equal(metrics.averageFetchMs,null);assert.equal(metrics.latestFetchMs,null);
  const queryOnly=computeCrawlMetrics({query:"AI banking"});
  assert.deepEqual(queryOnly.termRows.map(row=>[row.term,row.documentsWithTerm,row.sharePercent]),[["ai",0,0],["bank",0,0]]);
  assert.equal(queryOnly.metadataMatch,null);
});

test("Word counts and match coverage use titles and descriptions only, with synonym-normalized terms",()=>{
  const pages=[{...page("first","AI banking","Artificial intelligence improves banking.",30),fullText:"ignored ".repeat(500),tags:["unobserved"]},page("second","Bank lending","Bank mergers increase competition.",60)];
  const metrics=computeCrawlMetrics({pages,query:"How is AI being used in banking?",job:{status:"completed",createdAt:start,updatedAt:at(120)},now:Date.parse(at(5000))});
  assert.equal(metrics.metadataWordCount,12);assert.equal(metrics.elapsedMs,120000);assert.equal(metrics.metadataWordsPerMinute,6);
  assert.deepEqual(metrics.queryTerms,["ai","bank"]);assert.equal(metrics.metadataMatch,75);
  assert.deepEqual(metrics.matchHistory.map(item=>item.score),[100,50]);
  assert.deepEqual(metrics.termRows.slice(0,2).map(row=>({term:row.term,origin:row.origin,count:row.documentsWithTerm,share:row.sharePercent,hits:row.hits})),[
    {term:"ai",origin:"query",count:1,share:50,hits:[1,0]},{term:"bank",origin:"query",count:2,share:100,hits:[1,1]},
  ]);
  assert.ok(!metrics.termRows.some(row=>["ignored","unobserved"].includes(row.term)));
});

test("Long summaries retain late query terms and distinguish customer acquisition from M&A",()=>{
  const prefix="alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega";
  const metrics=computeCrawlMetrics({query:"M&A in banking",pages:[page("merger","Measured outcomes",`${prefix}. Banks and acquisitions are examined.`,1),page("marketing","Bank marketing","Customer acquisition strategies for banking customers.",2)]});
  assert.deepEqual(metrics.queryTerms,["merger","bank"]);
  assert.deepEqual(metrics.matchHistory.map(item=>item.score),[100,50]);
  assert.deepEqual(metrics.termRows.find(row=>row.term==="merger")?.hits,[1,0]);
  const noQuery=computeCrawlMetrics({pages:[page("plain","Bank bank bank","Home navigation privacy cookies contact banking models.",1)]});
  assert.equal(noQuery.metadataMatch,null);assert.deepEqual(noQuery.matchHistory,[]);
  assert.equal(noQuery.termRows[0].term,"bank");assert.equal(noQuery.termRows[0].documentsWithTerm,1,"Repeated occurrences count once per document.");
  assert.ok(noQuery.termRows.every(row=>row.origin==="metadata"&&!['home','navigation','privacy','cookies','contact'].includes(row.term)));
});

test("Replay uses only passed records and freezes elapsed time at the visible recording position",()=>{
  const pages=[page("early","Bank evidence","Lending outcomes",10),page("late","AI banking","Artificial intelligence outcomes",100)];
  const job={status:"completed",createdAt:start,updatedAt:at(120)};
  const early=computeCrawlMetrics({pages:pages.slice(0,1),events:[{time:at(15),message:"HTTP 200 · 40 ms · Indexed metadata"}],query:"AI banking",job,replay:true,now:Date.parse(at(10000))});
  const frozen=computeCrawlMetrics({pages:pages.slice(0,1),events:[{time:at(15),message:"HTTP 200 · 40 ms · Indexed metadata"}],query:"AI banking",job,replay:true,now:Date.parse(at(20000))});
  assert.deepEqual(early,frozen);assert.equal(early.elapsedMs,15000);assert.equal(early.pagesAnalyzed,1);assert.equal(early.metadataMatch,50);
  const later=computeCrawlMetrics({pages,job,replay:true,query:"AI banking"});
  assert.equal(later.elapsedMs,100000);assert.equal(later.pagesAnalyzed,2);assert.equal(later.metadataMatch,75);
  const emptyReplay=computeCrawlMetrics({job,replay:true,now:Date.parse(at(1000))});
  assert.equal(emptyReplay.elapsedMs,0);assert.equal(emptyReplay.metadataWordsPerMinute,null);
});

test("Running time follows the supplied clock; completed and paused runs freeze at their update time",()=>{
  const pages=[page("one","Bank study","Lending outcomes",0)];
  assert.equal(computeCrawlMetrics({pages,job:{status:"running",createdAt:start,updatedAt:at(10)},now:Date.parse(at(30))}).elapsedMs,30000);
  for(const status of ["paused","completed"]){
    assert.equal(computeCrawlMetrics({pages,job:{status,createdAt:start,updatedAt:at(10)},now:Date.parse(at(30))}).elapsedMs,10000);
  }
  const zero=computeCrawlMetrics({pages,job:{status:"running",createdAt:start},now:Date.parse(start)});
  assert.equal(zero.elapsedMs,0);assert.equal(zero.metadataWordsPerMinute,null);
  assert.equal(computeCrawlMetrics({job:{status:"running",createdAt:at(30)},now:Date.parse(start)}).elapsedMs,0);
  assert.equal(computeCrawlMetrics({pages,job:{createdAt:"invalid",updatedAt:"invalid"},now:"invalid"}).elapsedMs,null);
});

test("Website progress counts distinct URLs and does not equate unverified skips with checked pages",()=>{
  const frontier=[{url:"https://research.org/done",status:"queued"},{url:"https://research.org/done#part",status:"done"},
    ...["queued","processing","error","skipped","blocked","unknown"].map(status=>({url:`https://research.org/${status}`,status})),
    {url:"https://www.research.org/second",status:"done"},{url:"https://other.org/paper",status:"queued"},{url:"not a URL",status:"done"}];
  const metrics=computeCrawlMetrics({frontier});
  assert.equal(metrics.totalDiscovered,9);assert.equal(metrics.websiteCount,2);
  assert.deepEqual(metrics.websites[0],{hostname:"research.org",discovered:8,checked:4,queued:1,processing:1,failed:2,percent:50});
  assert.deepEqual(metrics.websites[1],{hostname:"other.org",discovered:1,checked:0,queued:1,processing:0,failed:0,percent:0});
  const top=computeCrawlMetrics({frontier:Array.from({length:10},(_,i)=>({url:`https://host${i}.org/paper`,status:"queued"}))});
  assert.equal(top.websites.length,6);assert.equal(top.websiteCount,10);assert.equal(top.totalDiscovered,10);
});

test("Completed page-budget skips stay discovered without inflating checked, failed or queued counts",()=>{
  const frontier=Array.from({length:12},(_,i)=>({url:`https://research.org/page-${i}`,status:i<5?"done":"skipped"}));
  const metrics=computeCrawlMetrics({frontier,job:{status:"completed",createdAt:start,updatedAt:at(30)},events:[
    {time:at(30),level:"info",message:"Page limit reached; remaining discoveries were skipped."},
    {time:at(30),level:"info",message:"Stage · complete · Page limit reached; remaining discoveries were skipped."},
  ]});
  assert.equal(metrics.totalDiscovered,12);
  assert.deepEqual(metrics.websites[0],{hostname:"research.org",discovered:12,checked:5,queued:0,processing:0,failed:0,percent:5/12*100});
});

test("Skipped URLs count as checked only with their own failed outcome or HTTP response",()=>{
  const names=["policy","blocked","error","response","only-fetching","only-access-stage","untouched"];
  const frontier=names.map(name=>({url:`https://research.org/${name}`,status:"skipped"}));
  const events=[
    {time:at(1),level:"skipped",url:"https://research.org/policy#fragment",message:"Source requests no indexing; metadata was not saved."},
    {time:at(2),level:"blocked",url:"https://research.org/blocked",message:"Blocked by robots.txt rules."},
    {time:at(3),level:"error",url:"https://research.org/error",message:"The source could not be fetched."},
    {time:at(4),level:"info",url:"https://research.org/response",message:"HTTP 200 · 42 ms · Duplicate URL skipped."},
    {time:at(5),level:"info",url:"https://research.org/only-fetching",message:"Fetching https://research.org/only-fetching"},
    {time:at(6),level:"info",url:"https://research.org/only-access-stage",message:"Stage · access · Checking public access."},
    {time:at(7),level:"skipped",url:"https://other.org/untouched",message:"Skipped by policy."},
  ];
  const metrics=computeCrawlMetrics({frontier,events});
  assert.deepEqual(metrics.websites[0],{hostname:"research.org",discovered:7,checked:4,queued:0,processing:0,failed:4,percent:4/7*100});
});

test("Columns show the latest 12 captures while coverage uses every analyzed document",()=>{
  const pages=Array.from({length:15},(_,i)=>page(String(i),i%2?"Bank lending":"AI banking","Measured outcomes",i));
  const before=JSON.stringify(pages);Object.freeze(pages);pages.forEach(Object.freeze);
  const metrics=computeCrawlMetrics({pages:[...pages].reverse(),query:"AI banking"});
  assert.equal(metrics.pagesAnalyzed,15);assert.deepEqual(metrics.columns.map(column=>column.id),Array.from({length:12},(_,i)=>String(i+3)));
  assert.equal(metrics.termRows[0].documentsWithTerm,8);assert.equal(metrics.termRows[0].sharePercent,8/15*100);
  assert.deepEqual(metrics.termRows[0].hits,Array.from({length:12},(_,i)=>(i+3)%2?0:1));
  assert.equal(metrics.matchHistory.length,15);assert.equal(JSON.stringify(pages),before);
});

test("Fetch charts include only recorded HTTP duration events, ordered and capped at 24",()=>{
  const events=[...Array.from({length:30},(_,i)=>({id:`http-${i}`,time:at(i),message:`HTTP ${i%2?200:404} · ${i*10} ms · Recorded response`,url:"https://research.org/article"})),
    {id:"fetching",time:at(31),message:"Fetching https://research.org/article"},
    {id:"fake",time:at(32),message:"Found a sentence mentioning HTTP 200 · 500 ms"},
    {id:"bad-time",time:"invalid",message:"HTTP 200 · 30 ms"},{id:"bad-code",time:at(33),message:"HTTP 999 · 40 ms"}].reverse();
  const metrics=computeCrawlMetrics({events});
  assert.equal(metrics.fetchSamples.length,24);assert.equal(metrics.fetchSamples[0].id,"http-6");assert.equal(metrics.fetchSamples.at(-1)?.id,"http-29");
  assert.equal(metrics.latestFetchMs,290);assert.equal(metrics.averageFetchMs,175);
  assert.ok(metrics.fetchSamples.some(sample=>sample.status===404),"The duration is an observed HTTP response, not a success claim.");
});

test("Large input is bounded explicitly and discovered links are counted without duplicates",()=>{
  const metrics=computeCrawlMetrics({pages:Array.from({length:305},(_,i)=>page(String(i),"Bank","Lending",i)),
    frontier:Array.from({length:5001},(_,i)=>({url:`https://research.org/${i}`,status:"queued"})),
    edges:[{source:"https://research.org/a",target:"https://research.org/b"},{source:"https://research.org/a",target:"https://research.org/b#part"},{source:"invalid",target:"https://research.org/b"}]});
  assert.equal(metrics.pagesAnalyzed,300);assert.equal(metrics.totalDiscovered,5000);assert.equal(metrics.edgeCount,1);assert.equal(metrics.limited,true);
});
