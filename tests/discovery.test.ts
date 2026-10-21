import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's native TypeScript runner requires the explicit extension.
import {discoverDocuments,matchesDiscoverySubject} from "../lib/discovery.ts";
// @ts-expect-error Node's native TypeScript runner requires the explicit extension.
import {documentIdentityKeys} from "../lib/document-identity.ts";

const topic="banking artificial intelligence";
function inverted(abstract:string){
  const index:Record<string,number[]>={};abstract.split(/\s+/).forEach((word,i)=>(index[word]||=[]).push(i));return index;
}
function work(overrides:Record<string,unknown>={}){
  return {id:"https://openalex.org/W123456",title:"Artificial intelligence in banking: measured outcomes",doi:"https://doi.org/10.1234/bank.1",publication_date:"2025-04-09",type:"article",is_retracted:false,
    open_access:{is_oa:true,oa_status:"green",oa_url:"https://repository.edu/papers/banking-ai.pdf"},
    best_oa_location:{is_oa:true,landing_page_url:"https://repository.edu/record/banking-ai",pdf_url:"https://repository.edu/papers/banking-ai.pdf",license:"cc-by",version:"acceptedVersion"},
    abstract_inverted_index:inverted("This study measures artificial intelligence adoption in banking using financial performance and customer service outcomes."),...overrides};
}
function bankDocument(overrides:Record<string,unknown>={}){
  return {id:"33142246",display_title:"Artificial intelligence in banking and financial inclusion",docdt:"2024-02-19T05:00:00Z",
    abstracts:{"cdata!":"This report compares artificial intelligence in banking with traditional approaches to financial inclusion and credit assessment."},
    url:"http://documents.worldbank.org/curated/en/959181623060169420",pdfurl:"http://documents.worldbank.org/curated/en/959181623060169420/pdf/Banking-Artificial-Intelligence.pdf",...overrides};
}
function json(value:unknown){return new Response(JSON.stringify(value),{headers:{"content-type":"application/json"}});}
function fixtureFetch(openAlex:unknown,worldBank:unknown,requests:{url:URL;init?:RequestInit}[]=[]):typeof fetch {
  return (async(input:RequestInfo|URL,init?:RequestInit)=>{const url=new URL(String(input));requests.push({url,init});
    return json(url.hostname==="api.openalex.org"?openAlex:url.hostname==="search.worldbank.org"?worldBank:url.hostname==="api.crossref.org"?{status:"ok",message:{items:[]}}:{header:{numFound:0},results:[]});
  }) as typeof fetch;
}

test("Discovery returns real item links, decoded abstracts, provider evidence and publication dates",async()=>{
  const requests:{url:URL;init?:RequestInit}[]=[];
  const result=await discoverDocuments(`show me research on ${topic}`,{fetcher:fixtureFetch({results:[work()]},{documents:{D33142246:bankDocument(),facets:{}}},requests)});
  assert.equal(requests.length,4);assert.equal(result.documents.length,2);
  assert.deepEqual(result.providers.map(p=>[p.provider,p.status,p.count]),[["OpenAlex","ok",1],["World Bank","ok",1],["Crossref","empty",0],["OpenAIRE","empty",0]]);
  assert.ok(requests.every(request=>request.url.protocol==="https:"&&request.init?.redirect==="manual"&&request.init.signal));
  assert.ok(requests.every(request=>!request.url.searchParams.has("api_key")),"Discovery requires no credentials.");
  assert.equal(requests[0].url.searchParams.get("search"),topic);
  assert.equal(requests[0].url.searchParams.get("filter"),"open_access.is_oa:true");
  assert.equal(requests[1].url.pathname,"/api/v3/wds");
  assert.equal(requests[1].url.searchParams.get("qterm"),topic);
  const paper=result.documents.find(d=>d.provider==="OpenAlex")!;
  assert.equal(paper.url,"https://repository.edu/record/banking-ai");
  assert.equal(paper.description,"This study measures artificial intelligence adoption in banking using financial performance and customer service outcomes.");
  assert.equal(paper.doi,"10.1234/bank.1");assert.equal(paper.publishedAt,"2025-04-09");
  assert.match(paper.accessBasis,/OpenAlex marks this document/);assert.match(paper.accessBasis,/not been independently checked/);
  const report=result.documents.find(d=>d.provider==="World Bank")!;
  assert.equal(report.url,"https://documents.worldbank.org/curated/en/959181623060169420");
  assert.match(report.fullTextUrl||"",/^https:\/\/documents\.worldbank\.org\/curated\/en\/959181623060169420\/pdf\//);
  assert.equal(report.publishedAt,"2024-02-19");assert.match(report.description,/financial inclusion/);
  assert.ok(result.documents.every(d=>d.access==="Free"&&d.name===d.title&&d.query===topic&&d.foundAt===result.searchedAt));
});

test("Closed copies, retractions, broad home pages and unsafe destinations are excluded",async()=>{
  const unsafe=["https://repository.edu/","https://repository.edu/research","https://127.0.0.1/paper","https://localhost/paper","https://service.internal/paper","https://reader:secret@repository.edu/paper","http://repository.edu/paper","https://repository.edu:444/paper"];
  const rows=[work({open_access:{is_oa:false}}),work({best_oa_location:{is_oa:false,landing_page_url:"https://publisher.org/article/123"}}),work({is_retracted:true}),
    ...unsafe.map((url,i)=>work({id:`https://openalex.org/W${300+i}`,open_access:{is_oa:true,oa_url:url},best_oa_location:{is_oa:true,landing_page_url:url,pdf_url:url}}))];
  const result=await discoverDocuments(topic,{fetcher:fixtureFetch({results:rows},{documents:{D1:bankDocument({url:"https://documents.worldbank.org/"}),D2:bankDocument({pdfurl:"https://evilworldbank.org/paper.pdf"}),D3:bankDocument({pdfurl:null})}})});
  assert.deepEqual(result.documents,[]);assert.ok(result.providers.every(p=>p.status==="empty"));
});

test("Free document evidence never comes from a closed primary location",async()=>{
  const item=work({primary_location:{is_oa:false,landing_page_url:"https://paidpublisher.org/article/1"},best_oa_location:{is_oa:true,landing_page_url:"https://repository.edu/record/open-copy",pdf_url:null}});
  const result=await discoverDocuments(topic,{fetcher:fixtureFetch({results:[item]},{documents:{}})});
  assert.equal(result.documents[0].url,"https://repository.edu/record/open-copy");
  assert.ok(!JSON.stringify(result.documents).includes("paidpublisher.org"));
});

test("AI queries expand the acronym and reject access-to-information and publisher-name matches",async()=>{
  const requests:{url:URL;init?:RequestInit}[]=[];
  const documents={
    D1:bankDocument({id:"1",display_title:"Requested disclosure of board records: access to information",abstracts:{"cdata!":"The World Bank access to information (AI) policy governs disclosure of Board records and related financial documents."}}),
    D2:bankDocument({id:"2",display_title:"Artificial Intelligence Country Diagnostic for India",abstracts:{"cdata!":"Artificial intelligence offers opportunities for industrial productivity. The World Bank prepared this report on digital capabilities and employment."}}),
    D3:bankDocument({id:"3",display_title:"Artificial intelligence in commercial banking",abstracts:{"cdata!":"This report evaluates artificial intelligence for commercial banking, credit decisions and fraud prevention using measured lending outcomes."}}),
  };
  const result=await discoverDocuments("AI in banking",{fetcher:fixtureFetch({results:[]},{documents},requests)});
  assert.ok(requests.every(request=>(request.url.searchParams.get("search")||request.url.searchParams.get("qterm")||request.url.searchParams.get("query")||"").includes("artificial intelligence")));
  assert.deepEqual(result.documents.map(document=>document.id),["worldbank-3"]);
  assert.equal(result.documents[0].query,"AI in banking","The user's query is preserved separately from API expansion.");
});

test("M&A must be a primary title subject rather than a law-firm service mentioned incidentally",async()=>{
  const result=await discoverDocuments("M&A case studies",{fetcher:fixtureFetch({results:[]},{documents:{
    D1:bankDocument({id:"1",display_title:"Tackling Childcare: F.J. and G. de Saram - Legal Services",abstracts:{"cdata!":"This case study examines childcare support at a law firm. Its legal services include mergers and acquisitions, commercial litigation and employment law."}}),
    D2:bankDocument({id:"2",display_title:"Mergers and acquisitions in emerging markets",abstracts:{"cdata!":"This case study evaluates mergers and acquisitions through measured integration costs and operational performance after the transaction."}}),
  }})});
  assert.deepEqual(result.documents.map(document=>document.id),["worldbank-2"]);
});

test("Corporate M&A excludes land-acquisition and resettlement reports but keeps shareholder expropriation research",async()=>{
  const result=await discoverDocuments("M&A case studies",{fetcher:fixtureFetch({results:[]},{documents:{
    D1:bankDocument({id:"1",url:"https://documents.worldbank.org/curated/en/10001",display_title:"Land acquisition and involuntary resettlement: performance standard 5",abstracts:{"cdata!":"This report explains compensation for land acquisition and involuntary resettlement in infrastructure projects and financial safeguards."}}),
    D2:bankDocument({id:"2",url:"https://documents.worldbank.org/curated/en/10002",display_title:"Rampur hydro power project: land acquisition and community development practices",abstracts:{"cdata!":"The report examines land acquisition, compensation and community development practices in a major power investment project."}}),
    D3:bankDocument({id:"3",url:"https://documents.worldbank.org/curated/en/10003",display_title:"Controlling shareholder stock pledge, aggravated expropriation and corporate acquisitions",abstracts:{"cdata!":"This study measures shareholder expropriation during corporate acquisitions and the effects on minority shareholder returns."}}),
    D4:bankDocument({id:"4",url:"https://documents.worldbank.org/curated/en/10004",pdfurl:"https://documents.worldbank.org/curated/en/10004/pdf/compensation.pdf",display_title:"Compensation for executives after mergers and acquisitions",abstracts:{"cdata!":"This paper measures executive compensation and financial performance following mergers and acquisitions of public companies."}}),
  }})});
  assert.deepEqual(result.documents.map(document=>document.id),["worldbank-3","worldbank-4"]);
  assert.equal(matchesDiscoverySubject({url:"https://publicresearch.org/report/land",title:"Land acquisition and involuntary resettlement",description:"This report studies compensation practices in land acquisition and involuntary resettlement."},"land acquisition resettlement"),true);
});

test("Document identity merges exact Zenodo route aliases and destination DOIs without merging versions by title",()=>{
  const old={url:"https://zenodo.org/record/7050039",doi:"10.5281/zenodo.7050038"},current={url:"https://zenodo.org/records/7050039",doi:"10.5281/zenodo.7050039"};
  assert.ok(documentIdentityKeys(old).some(key=>documentIdentityKeys(current).includes(key)));
  const selected={url:"https://doi.org/10.1016/j.jcorpfin.2017.11.003",doi:"10.2139/ssrn.2747036"};
  assert.ok(documentIdentityKeys(selected).includes("doi:10.1016/j.jcorpfin.2017.11.003"));
  assert.ok(!documentIdentityKeys(selected).includes("doi:10.2139/ssrn.2747036"));
  assert.ok(!documentIdentityKeys({url:"https://zenodo.org/records/7050038"}).some(key=>documentIdentityKeys(current).includes(key)));
  assert.ok(!documentIdentityKeys({url:"https://doi.org/10.2139/ssrn.2747036"}).some(key=>documentIdentityKeys(selected).includes(key)));
  assert.ok(!documentIdentityKeys({url:"https://zenodo.org/record/7050039/files/article.pdf"}).some(key=>documentIdentityKeys(current).includes(key)));
});

test("Default topic prompts handle singular supply chains and explicit AI deployment vocabulary",async()=>{
  const chips=work({title:"Semiconductor supply chain resilience and manufacturing capacity",abstract_inverted_index:inverted("This study examines semiconductor supply chain resilience and measures concentration in manufacturing capacity across countries.")});
  const chipResult=await discoverDocuments("Semiconductor supply chains",{fetcher:fixtureFetch({results:[chips]},{documents:{}})});
  assert.equal(chipResult.documents.length,1);
  const banking=work({title:"Artificial intelligence applications in banking",abstract_inverted_index:inverted("This study evaluates artificial intelligence adoption in commercial banking using credit outcomes and operating performance.")});
  const bankResult=await discoverDocuments("AI in banking deployments",{fetcher:fixtureFetch({results:[banking]},{documents:{}})});
  assert.equal(bankResult.documents.length,1);
  const natural=await discoverDocuments("How is AI being used in banking?",{fetcher:fixtureFetch({results:[banking]},{documents:{}})});
  assert.equal(natural.documents.length,1,"Question phrasing must not become an additional research subject.");
});

test("Direct open-access PDFs and repositories take precedence over DOI redirects",async()=>{
  const result=await discoverDocuments(topic,{fetcher:fixtureFetch({results:[
    work({best_oa_location:{is_oa:true,landing_page_url:"https://doi.org/10.1234/bank.1",pdf_url:"https://repository.edu/papers/direct-copy.pdf"}}),
    work({id:"https://openalex.org/W234567",doi:"10.1234/bank.2",open_access:{is_oa:true,oa_url:"https://doi.org/10.1234/bank.2"},best_oa_location:{is_oa:true,landing_page_url:"https://doi.org/10.1234/bank.2",pdf_url:null},locations:[{is_oa:false,landing_page_url:"https://paidpublisher.org/articles/2"},{is_oa:true,landing_page_url:"https://repository.edu/record/bank-2",pdf_url:"https://repository.edu/papers/bank-2.pdf",license:"cc-by"}]}),
  ]},{documents:{}})});
  assert.deepEqual(result.documents.map(document=>document.url),["https://repository.edu/papers/direct-copy.pdf","https://repository.edu/record/bank-2"]);
  assert.deepEqual(result.documents.map(document=>document.fullTextUrl),["https://repository.edu/papers/direct-copy.pdf","https://repository.edu/papers/bank-2.pdf"]);
  assert.match(result.documents[1].accessBasis,/license: cc-by/);
});

test("Session notices, generic pages and off-topic provider records are never recommended",async()=>{
  const rows=[work({title:"Your session has expired",abstract_inverted_index:inverted("Sign in again to view artificial intelligence in banking research.")}),
    work({title:"SaaS pricing and retention",abstract_inverted_index:inverted("A study of SaaS subscription pricing and customer retention outcomes.")}),
    work({title:"Research",abstract_inverted_index:inverted("Find all our banking artificial intelligence research publications here.")})];
  const result=await discoverDocuments(topic,{fetcher:fixtureFetch({results:rows},{documents:{D1:bankDocument({display_title:"Sign in",abstracts:{"cdata!":"Your session has expired. Sign in again to continue."}})}})});
  assert.deepEqual(result.documents,[]);assert.ok(result.providers.every(p=>p.status==="empty"));
});

test("DOI, canonical URL and full-text aliases deduplicate provider records",async()=>{
  const pdf="https://documents.worldbank.org/curated/en/959181623060169420/pdf/Banking-Artificial-Intelligence.pdf";
  const rows=[work({doi:"https://doi.org/10.1234/SHARED",best_oa_location:{is_oa:true,landing_page_url:"https://repository.edu/record/1?utm_source=feed#summary",pdf_url:pdf}}),
    work({id:"https://openalex.org/W2",doi:"doi:10.1234/shared",best_oa_location:{is_oa:true,landing_page_url:"https://repository.edu/record/2",pdf_url:null}}),
    work({id:"https://openalex.org/W3",doi:null,best_oa_location:{is_oa:true,landing_page_url:"https://repository.edu/record/1?utm_medium=web",pdf_url:null}})];
  const result=await discoverDocuments(topic,{fetcher:fixtureFetch({results:rows},{documents:{D33142246:bankDocument()}})});
  assert.equal(result.documents.length,1);assert.equal(result.documents[0].url,"https://repository.edu/record/1");
});

test("A provider's rate limit remains visible while the other provider returns useful results",async()=>{
  const fetcher=(async(input:RequestInfo|URL)=>String(input).includes("api.openalex.org")?new Response("Too many requests",{status:429}):json({documents:{D33142246:bankDocument()}})) as typeof fetch;
  const result=await discoverDocuments(topic,{fetcher});
  assert.equal(result.documents.length,1);assert.equal(result.documents[0].provider,"World Bank");
  assert.equal(result.providers[0].status,"rate-limited");assert.equal(result.providers[0].httpStatus,429);
  assert.match(result.providers[0].message||"",/free search limit/);
});

test("Invalid JSON, unexpected shapes and HTML errors are failures, not successful empty searches",async()=>{
  for(const response of [()=>new Response("not JSON",{headers:{"content-type":"application/json"}}),()=>json({error:"upstream unavailable"}),()=>new Response("<h1>Login</h1>",{headers:{"content-type":"text/html"}}),()=>new Response("Service unavailable",{status:503})]){
    const result=await discoverDocuments(topic,{fetcher:(async()=>response()) as typeof fetch});
    assert.deepEqual(result.documents,[]);assert.ok(result.providers.every(p=>p.status==="error"&&p.message));
  }
});

test("Request deadline bounds hanging fetches and response streams",async()=>{
  for(const fetcher of [((()=>new Promise(()=>{})) as unknown as typeof fetch),((async()=>new Response(new ReadableStream({start(){}}),{headers:{"content-type":"application/json"}})) as typeof fetch)]){
    const start=performance.now();const result=await discoverDocuments(topic,{fetcher,timeoutMs:50});
    assert.ok(performance.now()-start<500);assert.ok(result.providers.every(p=>p.status==="timeout"));
    assert.deepEqual(result.documents,[]);
  }
});

test("Provider bodies and result counts are bounded",async()=>{
  for(const headers of [{"content-type":"application/json","content-length":"1000001"},{"content-type":"application/json"}] as Record<string,string>[]){
    const result=await discoverDocuments(topic,{fetcher:(async()=>new Response("x".repeat(1_000_001),{headers})) as typeof fetch});
    assert.ok(result.providers.every(p=>p.status==="error"&&/size limit/.test(p.message||"")));
  }
  const rows=Array.from({length:100},(_,i)=>work({id:`https://openalex.org/W${1000+i}`,doi:`10.1234/bank${i}`,open_access:{is_oa:true,oa_url:`https://repository.edu/record/${i}`},best_oa_location:{is_oa:true,landing_page_url:`https://repository.edu/record/${i}`,pdf_url:null}}));
  const result=await discoverDocuments(topic,{fetcher:fixtureFetch({results:rows},{documents:{}})});
  assert.equal(result.documents.length,24);
});

test("Blank and operational queries make no network requests",async()=>{
  for(const query of ["","  ","crawl test","public research"]){
    const result=await discoverDocuments(query,{fetcher:(async()=>{throw new Error("Should not fetch");}) as typeof fetch});
    assert.deepEqual(result.documents,[]);assert.ok(result.providers.every(p=>p.status==="empty"));
  }
});

function crossrefWork(overrides:Record<string,unknown>={}){
  return {DOI:"10.1234/bank.1",title:["Artificial intelligence in banking: measured outcomes"],abstract:"<jats:p>This study measures artificial intelligence adoption in banking using financial performance and customer service outcomes.</jats:p>",
    published:{"date-parts":[[2025,4,9]]},URL:"https://doi.org/10.1234/bank.1",type:"journal-article",
    license:[{URL:"https://creativecommons.org/licenses/by/4.0/","content-version":"vor",start:{"date-parts":[[2020,1,1]],timestamp:Date.UTC(2020,0,1),"date-time":"2020-01-01T00:00:00Z"}}],
    link:[{URL:"https://repository.edu/papers/banking-ai.pdf","content-type":"application/pdf","content-version":"vor"}],...overrides};
}
function crossrefFixture(items:unknown[],requests:string[]=[],documentResponse:()=>Response=()=>new Response("%PDF-1.7\n% Public document fixture",{headers:{"content-type":"application/pdf"}})):typeof fetch {
  return async input=>{const url=new URL(String(input));requests.push(url.href);
    if(url.hostname==="api.openalex.org")return new Response(null,{status:429});
    if(url.hostname==="search.worldbank.org")return json({documents:{}});
    if(url.hostname==="api.crossref.org")return json({status:"ok",message:{items}});
    if(url.hostname==="api.openaire.eu")return json({header:{numFound:0},results:[]});
    return documentResponse();
  };
}

test("OpenAlex failures fall back to licensed and publicly reachable Crossref articles while retaining provider failures",async()=>{
  const requests:string[]=[];
  const result=await discoverDocuments("AI in banking",{fetcher:crossrefFixture([crossrefWork()],requests)});
  assert.deepEqual(result.providers.map(provider=>[provider.provider,provider.status]),[["OpenAlex","rate-limited"],["World Bank","empty"],["Crossref","ok"],["OpenAIRE","empty"]]);
  assert.equal(result.documents.length,1);const document=result.documents[0];
  assert.equal(document.provider,"Crossref");assert.equal(document.access,"Free");assert.equal(document.publishedAt,"2025-04-09");
  assert.equal(document.url,"https://repository.edu/papers/banking-ai.pdf");assert.equal(document.fullTextUrl,document.url);
  assert.match(document.providerRecordUrl,/api\.crossref\.org\/works\/10.1234%2Fbank.1$/);
  assert.match(document.accessBasis,/Creative Commons license/);assert.match(document.accessBasis,/public PDF response was fetched successfully without credentials/);assert.doesNotMatch(document.accessBasis,/has not been independently checked/);
  assert.match(document.description,/This study measures/);assert.doesNotMatch(document.description,/<[^>]+>/);
  const api=new URL(requests.find(url=>url.includes("api.crossref.org"))!);
  assert.equal(api.searchParams.get("query"),"artificial intelligence in banking");assert.equal(api.searchParams.get("filter"),"has-abstract:true,has-license:true");
  assert.equal(requests.filter(url=>url.includes("repository.edu")).length,1);
});

test("All four independent providers are searched even when OpenAlex succeeds or is empty",async()=>{
  for(const works of [[],[work()]]){
    const requests:{url:URL;init?:RequestInit}[]=[];
    const result=await discoverDocuments(topic,{fetcher:fixtureFetch({results:works},{documents:{}},requests)});
    assert.equal(result.providers.length,4);assert.equal(requests.length,4);assert.ok(requests.some(request=>request.url.hostname==="api.crossref.org"));
  }
});

test("Crossref licenses exclude TDM contracts, embargoes, spoofed hosts, conflicting dates and nonexistent CC versions",async()=>{
  const badLicenses=[
    {URL:"https://publisher.edu/tdm","content-version":"tdm"},
    {URL:"https://creativecommons.org/licenses/by/4.0/","content-version":"tdm"},
    {URL:"https://creativecommons.org/licenses/by/4.0/","content-version":"stm-asf"},
    {URL:"https://creativecommons.org.evil.test/licenses/by/4.0/","content-version":"vor"},
    {URL:"https://user:secret@creativecommons.org/licenses/by/4.0/","content-version":"vor"},
    {URL:"https://creativecommons.org/licenses/by/4.5/","content-version":"vor"},
    {URL:"https://creativecommons.org/publicdomain/mark/1.0/","content-version":"vor"},
    {URL:"https://creativecommons.org/licenses/by/4.0/","content-version":"vor",start:{timestamp:Date.UTC(2099,0,1)}},
    {URL:"https://creativecommons.org/licenses/by/4.0/","content-version":"vor",start:{timestamp:Date.UTC(2020,0,1),"date-parts":[[2099,1,1]]}},
    {URL:"https://creativecommons.org/licenses/by/4.0/","content-version":"vor",start:{timestamp:Date.UTC(2020,0,1),"date-time":"nonsense"}},
    {URL:"https://creativecommons.org/licenses/by/4.0/","content-version":"vor",start:{timestamp:Date.UTC(2020,0,1)/1000}},
  ];
  const requests:string[]=[];
  const result=await discoverDocuments(topic,{fetcher:crossrefFixture(badLicenses.map((license,index)=>crossrefWork({DOI:`10.1234/bad.${index}`,license:[license]})),requests)});
  assert.deepEqual(result.documents,[]);assert.equal(result.providers.find(provider=>provider.provider==="Crossref")?.status,"empty");
  assert.ok(requests.every(url=>/api\.openalex|search\.worldbank|api\.crossref|api\.openaire/.test(url)),"Unlicensed or embargoed content must not be probed or claimed free.");
});

test("Crossref accepted-manuscript licenses apply only to their matching copy and never retry an unlicensed DOI",async()=>{
  const license=[{URL:"http://creativecommons.org/licenses/by-nc/4.0/","content-version":"am"}];
  const vor=await discoverDocuments(topic,{fetcher:crossrefFixture([crossrefWork({license})])});assert.equal(vor.documents.length,0);
  const manuscript=crossrefWork({license,link:[{URL:"https://repository.edu/papers/accepted.pdf","content-type":"application/pdf","content-version":"am"}]});
  const accepted=await discoverDocuments(topic,{fetcher:crossrefFixture([manuscript])});assert.equal(accepted.documents.length,1);assert.match(accepted.documents[0].accessBasis,/linked accepted manuscript/);
  const requests:string[]=[];
  const blocked=await discoverDocuments(topic,{fetcher:crossrefFixture([manuscript],requests,()=>new Response(null,{status:403}))});
  assert.equal(blocked.documents.length,0);assert.ok(!requests.some(url=>url.includes("doi.org")));assert.match(blocked.providers.find(provider=>provider.provider==="Crossref")?.message||"",/no document passed the public-access check/);
});

test("Crossref rejects unavailable public copies, missing abstracts and incidental or off-topic subjects",async()=>{
  const noAbstract=crossrefWork({abstract:undefined}),incidental=crossrefWork({title:["Country access-to-information disclosure rules"],abstract:"This document describes access to information (AI) at the World Bank and explains the rules governing administrative disclosure."});
  const quality=await discoverDocuments("AI in banking",{fetcher:crossrefFixture([noAbstract,incidental])});assert.equal(quality.documents.length,0);
  for(const response of [()=>new Response(null,{status:403}),()=>new Response("<html><body><main><h1>Sign in to read</h1><p>Your session has expired.</p></main></body></html>",{headers:{"content-type":"text/html"}}),()=>new Response("Not a PDF",{headers:{"content-type":"application/pdf"}})]){
    const blocked=await discoverDocuments(topic,{fetcher:crossrefFixture([crossrefWork()],[],response)});assert.equal(blocked.documents.length,0);assert.match(blocked.providers.find(provider=>provider.provider==="Crossref")?.message||"",/public-access check/);
  }
});

test("Crossref decodes encoded abstracts and deduplicates normalized DOIs after public verification",async()=>{
  const result=await discoverDocuments(topic,{fetcher:crossrefFixture([
    crossrefWork({abstract:"&lt;jats:p&gt;This study measures artificial intelligence adoption in banking and customer outcomes.&lt;/jats:p&gt;"}),
    crossrefWork({DOI:"10.1234/BANK.1",link:[{URL:"https://repository.edu/papers/second-copy.pdf","content-type":"application/pdf","content-version":"vor"}]}),
  ])});
  assert.equal(result.documents.length,1);assert.doesNotMatch(result.documents[0].description,/<|&lt;|jats:/);
});

test("SaaS pricing and retention requests require the SaaS subject and a requested business measure",async()=>{
  const items=[
    crossrefWork({DOI:"10.1234/ott",title:["Customer retention in OTT platforms in Ahmedabad"],abstract:"This study evaluates pricing strategies and customer retention in streaming television platforms serving households in Ahmedabad."}),
    crossrefWork({DOI:"10.1234/ai-service",title:["Artificial intelligence customer service in Indonesian SaaS firms"],abstract:"This study evaluates software-as-a-service customer service automation, agent satisfaction and response time in Indonesian firms."}),
    crossrefWork({DOI:"10.1234/saas-pricing",title:["SaaS pricing and customer retention in enterprise software"],abstract:"This study evaluates software-as-a-service pricing strategies and customer retention using subscription cohorts and revenue outcomes."}),
  ];
  const result=await discoverDocuments("SaaS pricing and customer retention",{fetcher:crossrefFixture(items)});
  assert.deepEqual(result.documents.map(document=>document.doi),["10.1234/saas-pricing"]);
});

test("Crossref caches and coalesces metadata while checking public access again for each search",async()=>{
  const requests:string[]=[],fetcher=crossrefFixture([crossrefWork()],requests);
  const results=await Promise.all([discoverDocuments(topic,{fetcher}),discoverDocuments(topic,{fetcher})]);
  assert.ok(results.every(result=>result.documents.length===1));
  await discoverDocuments(topic,{fetcher});
  assert.equal(requests.filter(url=>url.includes("api.crossref.org")).length,1);
  assert.equal(requests.filter(url=>url.includes("repository.edu")).length,3,"A metadata cache must not skip the current public-access check.");
});

test("Crossref serializes its public API at one concurrent request and one start per second",async()=>{
  let active=0,maxActive=0,apiCalls=0;const starts:number[]=[];
  const fetcher:typeof fetch=async input=>{
    const url=new URL(String(input));if(url.hostname==="api.crossref.org"){
      apiCalls++;active++;maxActive=Math.max(maxActive,active);starts.push(Date.now());await new Promise(resolve=>setTimeout(resolve,apiCalls===1?1200:20));active--;
      return json({status:"ok",message:{items:[crossrefWork()]}});
    }
    return crossrefFixture([])(input);
  };
  const results=await Promise.all([discoverDocuments(topic,{fetcher}),discoverDocuments(`${topic} outcomes`,{fetcher})]);
  assert.ok(results.every(result=>result.documents.length===1));assert.equal(apiCalls,2);assert.equal(maxActive,1);assert.ok(starts[1]-starts[0]>=1000);
});

test("The fallback and public-access checks share the original bounded search deadline",async()=>{
  const started=performance.now();
  const fetcher:typeof fetch=async input=>{
    const url=new URL(String(input));if(url.hostname==="api.openalex.org")return new Promise(()=>{});
    if(url.hostname==="search.worldbank.org")return json({documents:{}});
    if(url.hostname==="api.crossref.org")return json({status:"ok",message:{items:[crossrefWork()]}});
    return new Promise(()=>{});
  };
  const result=await discoverDocuments(topic,{fetcher,timeoutMs:80});assert.equal(result.documents.length,0);assert.ok(performance.now()-started<250);
  assert.equal(result.providers[0].status,"timeout");assert.ok(result.providers.some(provider=>provider.provider==="Crossref"));
});

test("429 Retry-After suppresses only the blocked provider and resumes it after cooldown",async t=>{
  let now=Date.now(),openAlexCalls=0,bankCalls=0;t.mock.method(Date,"now",()=>now);
  const fetcher:typeof fetch=async input=>{
    const host=new URL(String(input)).hostname;
    if(host==="api.openalex.org"){openAlexCalls++;return openAlexCalls===1?new Response(null,{status:429,headers:{"retry-after":"120"}}):json({results:[work()]});}
    if(host==="search.worldbank.org"){bankCalls++;return json({documents:{D1:bankDocument()}});}
    return json(host==="api.crossref.org"?{status:"ok",message:{items:[]}}:{header:{numFound:0},results:[]});
  };
  const first=await discoverDocuments(topic,{fetcher});
  assert.equal(first.providers[0].retryAt,new Date(now+120000).toISOString());assert.equal(first.providers[0].skippedByCooldown,undefined);
  const second=await discoverDocuments(topic,{fetcher});
  assert.equal(openAlexCalls,1);assert.equal(bankCalls,2);assert.equal(second.providers[0].skippedByCooldown,true);assert.equal(second.documents.length,1);
  assert.equal(second.search?.nextBatch,1,"A blocked provider is retryable, not exhausted.");
  now+=120001;
  const third=await discoverDocuments(topic,{fetcher});assert.equal(openAlexCalls,2);assert.equal(third.providers[0].status,"ok");
});

test("HTTP-date Retry-After and a missing header produce bounded truthful retry times",async()=>{
  for(const header of [new Date(Date.now()+90000).toUTCString(),null]){
    const started=Date.now();
    const fetcher:typeof fetch=async input=>new URL(String(input)).hostname==="api.openalex.org"?new Response(null,{status:429,headers:header?{"retry-after":header}:{}}):json(new URL(String(input)).hostname==="api.crossref.org"?{status:"ok",message:{items:[]}}:new URL(String(input)).hostname==="search.worldbank.org"?{documents:{}}:{header:{numFound:0},results:[]});
    const result=await discoverDocuments(topic,{fetcher}),retry=Date.parse(result.providers[0].retryAt!);
    assert.ok(retry>=started+(header?88000:299000));assert.ok(retry<=Date.now()+(header?90000:300000));
    assert.equal(result.providers[0].status,"rate-limited");
  }
});

test("Queued Crossref requests observe the first rate limit without another network attempt",async()=>{
  let calls=0;
  const fetcher:typeof fetch=async input=>{
    const host=new URL(String(input)).hostname;
    if(host==="api.crossref.org"){calls++;return new Response(null,{status:429,headers:{"retry-after":"60"}});}
    return json(host==="search.worldbank.org"?{documents:{}}:{header:{numFound:0},results:[]});
  };
  const start=performance.now(),results=await Promise.all([discoverDocuments(topic,{fetcher}),discoverDocuments(`${topic} outcomes`,{fetcher})]);
  assert.equal(calls,1);assert.ok(performance.now()-start<700);
  assert.ok(results.every(result=>result.providers.find(provider=>provider.provider==="Crossref")?.status==="rate-limited"));
  assert.ok(results.some(result=>result.providers.find(provider=>provider.provider==="Crossref")?.skippedByCooldown));
});

test("Search rotates core and subject variants, paginates, and reports raw examined records",async t=>{
  let now=Date.now();t.mock.method(Date,"now",()=>now);
  const requests:{url:URL;init?:RequestInit}[]=[];
  const rows=Array.from({length:50},(_,index)=>work({id:`https://openalex.org/W${5000+index}`}));
  const fetcher=fixtureFetch({meta:{count:500},results:rows},{total:200,documents:{D1:bankDocument()}},requests);
  const original="I want research and case studies regarding mergers and acquisitions";
  const first=await discoverDocuments(original,{fetcher});
  const bankFirst=requests.find(request=>request.url.hostname==="search.worldbank.org")!.url;
  assert.equal(bankFirst.searchParams.get("qterm"),"mergers acquisitions");
  assert.equal(first.search?.candidatesChecked,51);assert.equal(first.search?.batch,0);assert.equal(first.search?.nextBatch,1);
  assert.equal(requests.find(request=>request.url.hostname==="api.openalex.org")!.url.searchParams.get("per-page"),"50");
  assert.equal(requests.find(request=>request.url.hostname==="api.crossref.org")!.url.searchParams.get("rows"),"75");
  now+=2000;requests.length=0;
  const second=await discoverDocuments(original,{fetcher,batch:1});
  assert.notDeepEqual(second.search?.queryVariants,first.search?.queryVariants);
  now+=2000;requests.length=0;
  await discoverDocuments(original,{fetcher,batch:4});
  assert.equal(requests.find(request=>request.url.hostname==="api.openalex.org")!.url.searchParams.get("page"),"2");
  assert.equal(requests.find(request=>request.url.hostname==="search.worldbank.org")!.url.searchParams.get("os"),"50");
  assert.equal(requests.find(request=>request.url.hostname==="api.crossref.org")!.url.searchParams.get("offset"),"75");
});

test("Existing URL aliases and DOIs are excluded before public document checks",async()=>{
  const requests:string[]=[],fetcher=crossrefFixture([crossrefWork()],requests);
  const result=await discoverDocuments(topic,{fetcher,excludeDois:["https://doi.org/10.1234/BANK.1"],excludeUrls:["https://repository.edu/papers/banking-ai.pdf?utm_source=previous"]});
  assert.equal(result.documents.length,0);assert.equal(result.search?.candidatesChecked,1);
  assert.equal(requests.filter(url=>url.includes("repository.edu")).length,0);
});

test("Exhaustion requires every query variant; failures remain retryable and the final batch is bounded",async t=>{
  let now=Date.now();t.mock.method(Date,"now",()=>now);
  const fetcher=fixtureFetch({results:[]},{documents:{}});
  const continuationKey="test-exhaustion-unique";
  const first=await discoverDocuments(topic,{fetcher,continuationKey});assert.equal(first.search?.nextBatch,1);
  now+=2000;const second=await discoverDocuments(topic,{fetcher,batch:1,continuationKey});assert.equal(second.search?.nextBatch,2);
  now+=2000;const third=await discoverDocuments(topic,{fetcher,batch:2,continuationKey});assert.equal(third.search?.nextBatch,null);assert.equal(third.search?.limitReached,undefined);
  const limited=await discoverDocuments(topic,{fetcher:(async()=>new Response(null,{status:503})) as typeof fetch,batch:99});
  assert.equal(limited.search?.batch,19);assert.equal(limited.search?.nextBatch,null);assert.equal(limited.search?.limitReached,true);
});

test("Broader corporate merger searches reject astrophysics and unrelated political mergers",async()=>{
  const rows=[
    work({id:"https://openalex.org/W8001",title:"Galaxy evolution in the post-merger regime",abstract_inverted_index:inverted("This study investigates galaxy mergers using stellar mass growth and gravitational models of merger activity."),doi:"10.1234/space"}),
    work({id:"https://openalex.org/W8002",title:"The FATA-KP merger and administrative reform",abstract_inverted_index:inverted("This study evaluates the administrative merger of districts and changes in political representation, constitutional law and public administration."),doi:"10.1234/politics"}),
    work({id:"https://openalex.org/W8003",title:"Post-merger integration in corporate acquisitions",abstract_inverted_index:inverted("This study evaluates merger integration, corporate governance and financial performance after company acquisitions."),doi:"10.1234/company"}),
  ];
  const result=await discoverDocuments("M&A case studies",{fetcher:fixtureFetch({results:rows},{documents:{}})});
  assert.deepEqual(result.documents.map(document=>document.doi),["10.1234/company"]);
});

test("Subject matching can find the topic after twenty metadata words",async()=>{
  const title="Evaluating measured operational organisational quantitative qualitative empirical comparative longitudinal retrospective prospective regional local international strategic practical technical analytical methodological descriptive causal explanatory predictive diagnostic outcomes: artificial intelligence in banking";
  const result=await discoverDocuments("AI in banking",{fetcher:fixtureFetch({results:[work({title})]},{documents:{}})});
  assert.equal(result.documents.length,1);
});

test("Each search retains eligible overflow records and cannot borrow another chain's exhaustion",async t=>{
  let now=Date.now();t.mock.method(Date,"now",()=>now);
  const rows=Array.from({length:30},(_,i)=>work({id:`https://openalex.org/W${9000+i}`,doi:`10.1234/carry${i}`,best_oa_location:{is_oa:true,landing_page_url:`https://repository.edu/papers/carry${i}`,pdf_url:null}}));
  const requests:{url:URL;init?:RequestInit}[]=[];
  const fetcher:typeof fetch=async(input,init)=>{
    const url=new URL(String(input));requests.push({url,init});
    return json(url.hostname==="api.openalex.org"?{meta:{count:30},results:url.searchParams.get("search")===topic?rows:[]}:url.hostname==="search.worldbank.org"?{documents:{}}:url.hostname==="api.crossref.org"?{status:"ok",message:{items:[]}}:{header:{numFound:0},results:[]});
  };
  const first=await discoverDocuments(topic,{fetcher,continuationKey:"test-search-chain-1"});assert.equal(first.documents.length,24);
  now+=2000;
  const next=await discoverDocuments(topic,{fetcher,batch:1,continuationKey:"test-search-chain-1",excludeDois:first.documents.map(document=>document.doi!)});
  assert.equal(next.documents.length,6,"A later batch must include the previous page's eligible overflow.");
  assert.ok(next.documents.every(document=>!first.documents.some(prior=>prior.doi===document.doi)));
  now+=2000;
  await discoverDocuments(topic,{fetcher,batch:2,continuationKey:"test-search-chain-1"});
  now+=2000;
  const fresh=await discoverDocuments(topic,{fetcher,continuationKey:"test-search-chain-2"});assert.equal(fresh.search?.nextBatch,1);assert.equal(fresh.documents.length,24);
  assert.ok(requests.every(request=>!request.url.href.includes("test-search-chain")),"The internal continuation key must not be sent to providers.");
});

test("Repository author and browse lists cannot replace a specific open document",async()=>{
  const rows=[work({open_access:{is_oa:true,oa_url:"https://eprints.leedsbeckett.ac.uk/view/creators/Du=3AM=3A=3A.html%3E"},best_oa_location:{is_oa:true,landing_page_url:"https://eprints.leedsbeckett.ac.uk/view/creators/Du=3AM=3A=3A.html%3E",pdf_url:null},locations:[{is_oa:true,landing_page_url:"https://repository.edu/record/actual-paper",pdf_url:"https://repository.edu/papers/actual-paper.pdf"}]}),
    work({id:"https://openalex.org/W9999",doi:"10.1234/browse",open_access:{is_oa:true,oa_url:"https://repository.edu/browse?type=author"},best_oa_location:{is_oa:true,landing_page_url:"https://repository.edu/browse?type=author",pdf_url:null}})];
  const result=await discoverDocuments(topic,{fetcher:fixtureFetch({results:rows},{documents:{}})});
  assert.deepEqual(result.documents.map(document=>document.url),["https://repository.edu/record/actual-paper"]);
});
