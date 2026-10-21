import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's native TypeScript runner requires the explicit extension.
import {discoverDocuments} from "../lib/discovery.ts";

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
    return json(url.hostname==="api.openalex.org"?openAlex:worldBank);
  }) as typeof fetch;
}

test("Discovery returns real item links, decoded abstracts, provider evidence and publication dates",async()=>{
  const requests:{url:URL;init?:RequestInit}[]=[];
  const result=await discoverDocuments(`show me research on ${topic}`,{fetcher:fixtureFetch({results:[work()]},{documents:{D33142246:bankDocument(),facets:{}}},requests)});
  assert.equal(requests.length,2);assert.equal(result.documents.length,2);
  assert.deepEqual(result.providers.map(p=>[p.provider,p.status,p.count]),[["OpenAlex","ok",1],["World Bank","ok",1]]);
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
  assert.ok(requests.every(request=>(request.url.searchParams.get("search")||request.url.searchParams.get("qterm"))==="artificial intelligence in banking"));
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
  assert.equal(result.documents.length,8);
});

test("Blank and operational queries make no network requests",async()=>{
  for(const query of ["","  ","crawl test","public research"]){
    const result=await discoverDocuments(query,{fetcher:(async()=>{throw new Error("Should not fetch");}) as typeof fetch});
    assert.deepEqual(result.documents,[]);assert.ok(result.providers.every(p=>p.status==="empty"));
  }
});
