import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Native TypeScript tests require the explicit extension.
import { buildOpenAireUrl, openAirePagination, parseOpenAireDocuments } from "../lib/openaire-discovery.ts";

const foundAt="2026-10-21T05:31:38.300Z",query="Mergers and acquisitions case studies";
const open={code:"c_abf2",label:"OPEN"};
function instance(overrides:Record<string,unknown>={}){return {accessRight:open,type:"Article",urls:["https://repository.edu/record/42"],license:"CC BY",...overrides};}
function work(overrides:Record<string,unknown>={}){return {id:"doi_dedup___::abc123",type:"publication",mainTitle:"Mergers &amp; acquisitions in the pharmaceutical industry",descriptions:["<jats:p>This study examines mergers and acquisitions among pharmaceutical companies and compares corporate integration outcomes.</jats:p>"],publicationDate:"2024-04-19",pids:[{scheme:"doi",value:"10.1234/MA.42"}],bestAccessRight:open,instances:[instance()],...overrides};}
const parse=(rows:unknown[])=>parseOpenAireDocuments({header:{numFound:rows.length},results:rows},query,foundAt);

test("OpenAIRE metadata preserves the question, instance evidence, exact provider record and publication date",()=>{
  const [doc]=parse([work()]);
  assert.equal(doc.provider,"OpenAIRE");assert.equal(doc.access,"Free");assert.equal(doc.query,query);assert.equal(doc.foundAt,foundAt);assert.equal(doc.domain,"Case studies");
  assert.equal(doc.url,"https://repository.edu/record/42");assert.equal(doc.doi,"10.1234/ma.42");assert.equal(doc.publishedAt,"2024-04-19");
  assert.equal(doc.title,"Mergers & acquisitions in the pharmaceutical industry");assert.doesNotMatch(doc.description,/<[^>]+>/);
  assert.equal(new URL(doc.providerRecordUrl).searchParams.get("filter"),"id:doi_dedup___::abc123");
  assert.match(doc.accessBasis,/specific linked instance/);assert.match(doc.accessBasis,/CC BY/);assert.match(doc.accessBasis,/has not been independently checked/);
});

test("Whole-work OPEN and licenses cannot grant access to a closed, unknown or missing-url instance",()=>{
  const badCopies=[instance({accessRight:{code:"c_14cb",label:"CLOSED"}}),instance({accessRight:null}),instance({accessRight:{label:"UNKNOWN"}}),instance({accessRight:{code:"c_14cb",label:"OPEN"}}),instance({accessRight:{code:"c_abf2",label:"CLOSED"}})];
  assert.deepEqual(parse(badCopies.map((copy,index)=>work({id:`sample::${index}`,instances:[copy,instance({urls:null})]}))),[]);
  assert.equal(parse([work({bestAccessRight:null,instances:[instance({accessRight:{code:"c_abf2"}})]})]).length,1,"The particular copy supplies the access evidence.");
  assert.equal(parse([work({instances:[instance({accessRight:{label:"Open Access"}})]})]).length,1);
});

test("Explicit open repository copies beat DOI redirects and never use closed-copy PDF links",()=>{
  const [doc]=parse([work({instances:[instance({urls:["https://doi.org/10.1234/ma.42"]}),instance({accessRight:{label:"CLOSED"},urls:["https://publisher.edu/private/paper.pdf"]}),instance({urls:["https://repository.edu/record/42?utm_source=feed#summary","https://repository.edu/files/paper.pdf"]})]})]);
  assert.equal(doc.url,"https://repository.edu/files/paper.pdf");assert.equal(doc.fullTextUrl,doc.url);
  const [landing]=parse([work({instances:[instance({urls:["https://doi.org/10.1234/ma.42"]}),instance({urls:["https://repository.edu/record/42?b=2&utm_source=feed&a=1#abstract"]})]})]);
  assert.equal(landing.url,"https://repository.edu/record/42?a=1&b=2");
});

test("Nonpublic URLs, HTTP upgrades, collection pages and access gates cannot become free documents",()=>{
  const urls=["http://repository.edu/record/42","https://user:pass@repository.edu/record/42","https://repository.edu:8443/record/42","https://127.0.0.1/record/42","https://0x7f000001/record/42","https://[::1]/record/42","https://localhost/record/42","https://private.local/record/42","https://127.0.0.1.nip.io/record/42","https://repository.edu/","https://repository.edu/publications","https://repository.edu/login","https://repository.edu/feed.xml","https://repository.edu/search?q=merger"];
  for(const url of urls)assert.deepEqual(parse([work({instances:[instance({urls:[url]})]})]),[],url);
  assert.deepEqual(parse([work({descriptions:["Your session is about to expire due to inactivity. Please sign in to continue."]})]),[]);
});

test("Real descriptions are required and invalid dates, future embargoes and nonpublications stay honest",()=>{
  for(const descriptions of [null,[],[""],["No abstract available"]])assert.deepEqual(parse([work({descriptions})]),[]);
  assert.deepEqual(parse([work({mainTitle:"Retraction: Mergers and acquisitions"}),work({type:"data"}),work({embargoEndDate:"2099-01-01"}),work({embargoEndDate:"not a date"}),work({instances:[instance({embargoEndDate:"2099-01-01"})]})]),[]);
  const [doc]=parse([work({publicationDate:"2025-02-30",embargoEndDate:"2020-01-01",instances:[instance({type:"Report",publicationDate:"2024-01-02"})]})]);
  assert.equal(doc.publishedAt,"2024-01-02");assert.equal(doc.type,"Report");
});

test("Duplicate works and oversized metadata are bounded without inventing titles or summaries",()=>{
  const one=work(),sameUrl=work({id:"other::id",pids:null}),sameDoi=work({id:"other::doi",instances:[instance({urls:["https://second.edu/paper/1"]})]});
  assert.equal(parse([one,one,sameUrl,sameDoi]).length,1);
  const rows=Array.from({length:150},(_,index)=>work({id:`record::${index}`,mainTitle:"Mergers and acquisitions "+"a".repeat(1000),descriptions:["This research examines corporate merger outcomes. ".repeat(1000)],pids:null,instances:[instance({urls:[`https://repository.edu/record/${index}`]})]}));
  const docs=parse(rows);assert.equal(docs.length,100);assert.ok(docs.every(doc=>doc.title.length<=500&&doc.description.length<=3000));
});

test("Pagination uses raw rows even if access filtering rejects every document",()=>{
  const payload={header:{numFound:7466,page:1,pageSize:50},results:[work({instances:[]}),work({descriptions:null})]};
  assert.deepEqual(openAirePagination(payload),{count:2,total:7466});assert.deepEqual(parseOpenAireDocuments(payload,query,foundAt),[]);
  assert.deepEqual(openAirePagination({results:[],header:{numFound:"7466"}}),{count:0});
  for(const payload of [null,[],{}, {error:"unavailable"},{results:{}}])assert.throws(()=>parseOpenAireDocuments(payload,query,foundAt),/unexpected response/);
});

test("Search URLs use documented v4 filters, sparse copy evidence and bounded one-based pages",()=>{
  const first=new URL(buildOpenAireUrl("mergers acquisitions"));
  assert.equal(first.origin+first.pathname,"https://api.openaire.eu/graph/v4/research-products");assert.equal(first.searchParams.get("page"),"1");assert.equal(first.searchParams.get("page_size"),"50");assert.equal(first.searchParams.get("filter"),"type:publication,best_oa.rights:Open Access");assert.match(first.searchParams.get("select")||"",/instances/);
  const second=new URL(buildOpenAireUrl("mergers acquisitions",1,75));assert.equal(second.searchParams.get("page"),"2");assert.equal(second.searchParams.get("page_size"),"75");
  const capped=new URL(buildOpenAireUrl("a".repeat(1000),9999,1000));assert.equal(capped.searchParams.get("page"),"100");assert.equal(capped.searchParams.get("page_size"),"100");assert.equal(capped.searchParams.get("search")?.length,300);
  assert.equal(new URL(buildOpenAireUrl("mergers",-5,NaN)).searchParams.get("page"),"1");
});
