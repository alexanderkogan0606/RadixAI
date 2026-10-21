import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node native TypeScript tests require an explicit extension.
import {discoverFilings,isFilingQuery} from "../lib/filing-discovery.ts";
// @ts-expect-error Node native TypeScript tests require an explicit extension.
import {discoverDocuments} from "../lib/discovery.ts";

const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{"content-type":"application/json"}});
function payload(overrides:Record<string,unknown>={}){
  return {cik:"0000320193",name:"Apple Inc.",tickers:["AAPL"],fiscalYearEnd:"0930",filings:{recent:{
    accessionNumber:["0000320193-25-000100","0000320193-25-000080","0000320193-25-000050","0000320193-25-000010","0000320193-24-000120"],
    form:["8-K","10-Q","10-Q","10-Q","10-K"],reportDate:["2025-08-01","2025-06-28","2025-03-29","2024-12-28","2024-09-28"],
    filingDate:["2025-08-01","2025-08-01","2025-05-02","2025-01-31","2024-11-01"],
    primaryDocument:["aapl-8k.htm","aapl-20250628.htm","aapl-20250329.htm","aapl-20241228.htm","aapl-20240928.htm"],
  },files:[]},...overrides};
}
function fixture(body:unknown,requests:{url:string;init?:RequestInit;time:number}[]=[]):typeof fetch {
  return (async(input:RequestInfo|URL,init?:RequestInit)=>{requests.push({url:String(input),init,time:Date.now()});return json(body);}) as typeof fetch;
}

test("Specific quarterly requests return the primary SEC filing and factual period/date metadata",async()=>{
  const requests:{url:string;init?:RequestInit;time:number}[]=[];
  const result=await discoverDocuments("Apple latest quarterly report",{fetcher:fixture(payload(),requests)});
  assert.equal(result.providers.length,1);assert.equal(result.providers[0].provider,"SEC EDGAR");assert.equal(result.providers[0].status,"ok");
  assert.equal(requests.length,1);assert.equal(requests[0].url,"https://data.sec.gov/submissions/CIK0000320193.json");
  assert.equal(requests[0].init?.redirect,"manual");assert.match(String(new Headers(requests[0].init?.headers).get("User-Agent")),/radixai\.sk1616\.chatgpt\.site/);
  assert.equal(result.documents.length,1);const document=result.documents[0];
  assert.equal(document.url,"https://www.sec.gov/Archives/edgar/data/320193/000032019325000080/aapl-20250628.htm");
  assert.equal(document.fullTextUrl,document.url);assert.equal(document.type,"Quarterly report");assert.equal(document.access,"Free");
  assert.match(document.title,/Apple Inc\. \(AAPL\).*Quarterly report, 10-Q, period ended 2025-06-28/);
  assert.equal(document.publishedAt,"2025-08-01");assert.match(document.description,/Reporting period ended 2025-06-28; filed 2025-08-01/);
  assert.match(document.description,/financial results have not been read/);assert.match(document.providerRecordUrl,/0000320193-25-000080-index\.html$/);
  assert.ok(!requests.some(request=>/openalex|worldbank/.test(request.url)),"Academic papers must not substitute for company quarterly reports.");
});

test("Explicit fiscal quarters and years select the requested period rather than the latest filing",async()=>{
  const fetcher=fixture(payload());
  const fiscal=await discoverFilings("AAPL Q1 2025 quarterly report",{fetcher});
  assert.equal(fiscal.documents.length,1);assert.match(fiscal.documents[0].url,/aapl-20241228\.htm$/,"Apple fiscal Q1 2025 ends in December 2024.");
  const calendar=await discoverFilings("AAPL calendar Q1 2025 quarterly report",{fetcher});
  assert.equal(calendar.documents.length,1);assert.match(calendar.documents[0].url,/aapl-20250329\.htm$/);
  const fy=await discoverFilings("AAPL Q1 FY2025",{fetcher});
  assert.equal(fy.documents.length,1);assert.match(fy.documents[0].url,/aapl-20241228\.htm$/);
  const exactDate=await discoverFilings("Apple quarterly report period ended 2024-12-28",{fetcher});
  assert.equal(exactDate.documents.length,1);assert.match(exactDate.documents[0].url,/aapl-20241228\.htm$/);
  const annual=await discoverFilings("Apple annual report 2024",{fetcher});
  assert.equal(annual.documents.length,1);assert.equal(annual.documents[0].type,"Annual report");assert.match(annual.documents[0].url,/aapl-20240928\.htm$/);
  const absent=await discoverFilings("Apple quarterly report 2011",{fetcher});
  assert.equal(absent.documents.length,0);assert.equal(absent.status.status,"empty");assert.match(absent.status.message||"",/No matching/);
  const q4=await discoverFilings("Apple Q4 2025 quarterly report",{fetcher});
  assert.equal(q4.documents.length,0);assert.match(q4.status.message||"",/annual 10-K rather than a 10-Q/);
});

test("Public company directory resolves explicit tickers and names with bounded sequential SEC requests",async()=>{
  const requests:{url:string;time:number}[]=[];
  const fetcher:typeof fetch=async input=>{requests.push({url:String(input),time:Date.now()});return String(input).includes("company_tickers")?
    json({0:{cik_str:1321655,ticker:"PLTR",title:"Palantir Technologies Inc."},1:{cik_str:123,ticker:"ON",title:"ON Corp"}}):
    json(payload({cik:1321655,name:"Palantir Technologies Inc.",tickers:["PLTR"]}));};
  const result=await discoverFilings("PLTR latest quarterly report",{fetcher});
  assert.equal(result.documents.length,1);assert.match(result.documents[0].title,/Palantir Technologies/);
  assert.equal(requests.length,2);assert.equal(requests[0].url,"https://www.sec.gov/files/company_tickers.json");assert.match(requests[1].url,/CIK0001321655\.json$/);
  assert.ok(requests[1].time-requests[0].time>=190,"Requests must stay below the SEC ten-per-second ceiling.");
  await discoverFilings("Palantir Technologies quarterly report",{fetcher});
  assert.equal(requests.length,2,"Repeated requests reuse the directory and recent submissions cache.");
});

test("June fiscal year ends resolve Microsoft quarters without inventing a quarter from missing metadata",async()=>{
  const microsoft=payload({cik:789019,name:"Microsoft Corporation",tickers:["MSFT"],fiscalYearEnd:"0630",filings:{recent:{form:["10-Q"],accessionNumber:["0000950170-24-000001"],reportDate:["2024-09-30"],filingDate:["2024-10-30"],primaryDocument:["msft-20240930.htm"]},files:[]}});
  const result=await discoverFilings("MSFT Q1 FY2025",{fetcher:fixture(microsoft)});
  assert.equal(result.documents.length,1);assert.match(result.documents[0].title,/period ended 2024-09-30$/);
  const unknownCalendar=await discoverFilings("MSFT Q1 FY2025",{fetcher:fixture({...microsoft,fiscalYearEnd:""})});
  assert.equal(unknownCalendar.documents.length,0);assert.equal(unknownCalendar.status.status,"empty");
});

test("Missing company names do not turn ordinary query words into tickers",async()=>{
  const requests:{url:string;init?:RequestInit;time:number}[]=[];
  const result=await discoverDocuments("Find quarterly reports on AI",{fetcher:fixture({0:{cik_str:1577526,ticker:"AI",title:"C3.ai, Inc."},1:{cik_str:123,ticker:"ON",title:"ON Corp"}},requests)});
  assert.equal(result.documents.length,0);assert.equal(result.providers[0].status,"empty");assert.match(result.providers[0].message||"",/Name a specific/);
  assert.equal(requests.length,1,"No guessed company submissions are requested.");
  const form=await discoverFilings("Find the latest form 10-Q reports",{fetcher:fixture({0:{cik_str:1,ticker:"FORM",title:"FormFactor Inc."},1:{cik_str:2,ticker:"FIND",title:"Findex.com, Inc."}},requests)});
  assert.equal(form.documents.length,0);assert.equal(form.status.status,"empty");assert.match(form.status.message||"",/Name a specific/);
  assert.equal(requests.length,2,"Ordinary form/find wording must not trigger company submissions.");
});

test("One bounded historical submissions page can satisfy an older explicit year",async()=>{
  const current=payload();current.filings.files=[{name:"CIK0000320193-submissions-001.json",filingFrom:"2010-01-01",filingTo:"2020-12-31"}] as never[];
  const requests:string[]=[];
  const fetcher:typeof fetch=async input=>{requests.push(String(input));return String(input).includes("-submissions-")?json({
    form:["10-Q"],accessionNumber:["0000320193-19-000050"],reportDate:["2019-03-30"],filingDate:["2019-05-01"],primaryDocument:["aapl-20190330.htm"],
  }):json(current);};
  const result=await discoverFilings("Apple Q2 2019 quarterly report",{fetcher});
  assert.equal(result.documents.length,1);assert.match(result.documents[0].url,/aapl-20190330.htm$/);assert.equal(requests.length,2);
});

test("SEC failures remain visible and never produce homepages, scholarly fallbacks or retries",async()=>{
  for(const status of [403,429,302,500]){
    const requests:string[]=[];const result=await discoverDocuments("Apple latest quarterly report",{fetcher:async input=>{requests.push(String(input));return new Response(null,{status});}});
    assert.equal(result.documents.length,0);assert.equal(result.providers[0].httpStatus,status);assert.equal(result.providers[0].status,status===429?"rate-limited":"error");assert.equal(requests.length,1);
  }
});

test("A slow or oversized SEC response is bounded and diagnosed",async()=>{
  const slow=await discoverFilings("Apple 10-Q",{timeoutMs:50,fetcher:()=>new Promise(()=>{})});
  assert.equal(slow.status.status,"timeout");assert.equal(slow.documents.length,0);
  const oversized=await discoverFilings("Apple 10-Q",{fetcher:async()=>new Response("{}",{headers:{"content-type":"application/json","content-length":"2000001"}})});
  assert.equal(oversized.status.status,"error");assert.match(oversized.status.message||"",/two-megabyte/);
  const html=await discoverFilings("Apple 10-Q",{fetcher:async()=>new Response("<title>Access Denied</title>",{headers:{"content-type":"text/html"}})});
  assert.equal(html.status.status,"error");assert.match(html.status.message||"",/non-JSON/);
});

test("Wrong companies, hostile filenames, non-report forms and missing dates never become document links",async()=>{
  const wrong=await discoverFilings("Apple quarterly report",{fetcher:fixture(payload({cik:999}))});
  assert.equal(wrong.documents.length,0);assert.equal(wrong.status.status,"error");
  const malformed=payload();malformed.filings.recent.primaryDocument[1]="../../secret.htm";malformed.filings.recent.primaryDocument[2]="https://evil.test/report.htm";malformed.filings.recent.reportDate[3]="";
  const result=await discoverFilings("Apple quarterly report",{fetcher:fixture(malformed)});assert.equal(result.documents.length,0);
});

test("General research questions never call SEC",async()=>{
  let requests=0;
  for(const query of ["AI in banking","SaaS pricing","mergers and acquisitions case studies"]){
    assert.equal(isFilingQuery(query),false);
    const result=await discoverFilings(query,{fetcher:async()=>{requests++;return json({});}});assert.equal(result.documents.length,0);
  }
  assert.equal(requests,0);
});
