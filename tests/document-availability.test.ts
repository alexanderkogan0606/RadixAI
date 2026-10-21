import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's native TypeScript tests require the explicit extension.
import {checkDocumentAvailability} from "../lib/document-availability.ts";

const url="https://journal.org/articles/bank-technology";
const paragraphs=[
  "Artificial intelligence tools are being evaluated across financial institutions to support lending decisions and operational processes. This article describes the study design, the institutions included in the analysis, the measurement framework, and the assumptions needed to interpret comparisons between different banking systems. The methodology separates observed associations from claims about causal effects.",
  "The research compares deployment approaches across participating banks and documents how each organization evaluates data quality, model performance, and human oversight. The analysis considers customer access, operating costs, and implementation constraints together. It explains the limitations of the available records and identifies where additional evidence would be needed before drawing broader conclusions about industry outcomes.",
  "The discussion examines governance choices and the practical conditions that influence whether a system can be maintained over time. It outlines how researchers can reproduce the comparison using the disclosed measurement definitions. The conclusions are limited to the institutions and reporting periods covered by the study, with further research needed to evaluate other settings and longer time horizons.",
];
const article=`<html><head><title>Artificial intelligence deployment in banking</title></head><body><nav><a href="/login">Sign in</a></nav><article><h1>Artificial intelligence deployment in banking</h1><h2>Introduction</h2>${paragraphs.map(p=>`<p>${p}</p>`).join("")}</article></body></html>`;
const response=(body:string,headers:Record<string,string>={})=>new Response(body,{headers:{"content-type":"text/html",...headers}});
const fixture=(body:string):typeof fetch=>async()=>response(body);

test("Substantive public HTML is checked without authentication and returns its actual URL",async()=>{
  let init:RequestInit|undefined;
  const found=await checkDocumentAvailability(url,{fetcher:async(_input,options)=>{init=options;return response(article);}});
  assert.deepEqual(found,{url,kind:"html"});
  assert.equal(init?.redirect,"manual");assert.equal(init?.credentials,"omit");assert.equal(init?.referrerPolicy,"no-referrer");
  const headers=new Headers(init?.headers);assert.equal(headers.get("cookie"),null);assert.equal(headers.get("authorization"),null);
  assert.match(headers.get("user-agent")||"",/https:\/\/radixai\.sk1616\.chatgpt\.site\//);
});

test("Only a successful PDF response with initial PDF magic qualifies; its body is cancelled",async()=>{
  let cancelled=0,reads=0;
  const chunks=[new TextEncoder().encode("%P"),new TextEncoder().encode("DF-1.7\nUnexamined document content")];
  const found=await checkDocumentAvailability(url+".pdf",{fetcher:async()=>new Response(new ReadableStream({pull(controller){reads++;controller.enqueue(chunks.shift()||new Uint8Array(1000));},cancel(){cancelled++;}}),{headers:{"content-type":"application/pdf"}})});
  assert.deepEqual(found,{url:url+".pdf",kind:"pdf"});assert.equal(cancelled,1);assert.ok(reads<=3);
  for(const [body,type] of [["<html>Sign in required</html>","application/pdf"],["not a PDF","application/octet-stream"],["%PDF-1.7","text/plain"]]){
    assert.equal(await checkDocumentAvailability(url,{fetcher:async()=>new Response(body,{headers:{"content-type":type}})}),null);
  }
  assert.deepEqual(await checkDocumentAvailability(url,{fetcher:async()=>new Response("%PDF-1.7",{headers:{"content-type":"application/octet-stream"}})}),{url,kind:"pdf"});
});

test("Errors, session notices, login, CAPTCHA and paywalls cannot establish free availability",async()=>{
  for(const status of [204,206,401,402,403,404,429,500]){
    let cancelled=false;
    const fetcher:typeof fetch=async()=>new Response(status===204?null:new ReadableStream({cancel(){cancelled=true;}}),{status,headers:{"content-type":"text/html"}});
    assert.equal(await checkDocumentAvailability(url,{fetcher}),null);if(status!==204)assert.equal(cancelled,true);
  }
  const pages=[
    article.replace("<body>","<body><p>Your session is about to expire due to inactivity.</p>"),
    article.replace("<body>","<body><h1>Sign in</h1><p>Please sign in to access this article.</p>"),
    article.replace("<body>","<body><p>Verify that you are a human to continue.</p>"),
    article.replace("<body>","<body><p>Subscribe to read the full article.</p>"),
    article.replace("<body>","<body><p>Purchase access to this article.</p>"),
    article.replace("<head>",'<head><script type="application/ld+json">{"isAccessibleForFree":false}</script>'),
    article.replace("<body>",`<body><div>${"Navigation text ".repeat(650)}</div><p>Your session has expired.</p>`),
  ];
  for(const body of pages)assert.equal(await checkDocumentAvailability(url,{fetcher:fixture(body)}),null);
});

test("Homepages, abstract-only records, metadata scripts and short landing text are not readable articles",async()=>{
  assert.equal(await checkDocumentAvailability("https://journal.org/",{fetcher:fixture(article)}),null);
  assert.equal(await checkDocumentAvailability("https://journal.org/doi/abs/10.1234/paper",{fetcher:fixture(article)}),null);
  assert.equal(await checkDocumentAvailability(url,{fetcher:fixture(article.replace("<h2>Introduction</h2>","<h2>Abstract</h2>"))}),null);
  assert.equal(await checkDocumentAvailability(url,{fetcher:fixture(`<title>Research collection</title><main><p>View our research collection and find the publications that interest you.</p></main>`)}),null);
  assert.equal(await checkDocumentAvailability(url,{fetcher:fixture(`<title>Research paper</title><script type="application/ld+json">${JSON.stringify({articleBody:article})}</script>`)}),null);
});

test("Every redirect is revalidated; safe chains are bounded and response bodies are cancelled",async()=>{
  let cancelled=0;const requested:string[]=[];
  const fetcher:typeof fetch=async input=>{requested.push(String(input));return requested.length<=3?new Response(new ReadableStream({cancel(){cancelled++;}}),{status:302,headers:{location:`/articles/hop-${requested.length}`}}):response(article);};
  assert.deepEqual(await checkDocumentAvailability(url,{fetcher}),{url:"https://journal.org/articles/hop-3",kind:"html"});assert.equal(requested.length,4);assert.equal(cancelled,3);
  for(const target of ["http://journal.org/article","https://127.0.0.1/article","https://user:pass@journal.org/article","https://metadata.google.internal/article","https://private.nip.io/article","https://localhost./article"]){
    let calls=0;
    assert.equal(await checkDocumentAvailability(url,{fetcher:async()=>{calls++;return new Response(null,{status:302,headers:{location:target}});}}),null);assert.equal(calls,1,target);
  }
  let calls=0;
  assert.equal(await checkDocumentAvailability(url,{fetcher:async()=>new Response(null,{status:302,headers:{location:`/article-${++calls}`}})}),null);assert.equal(calls,4);
  let loopCalls=0;
  assert.equal(await checkDocumentAvailability(url,{fetcher:async()=>{loopCalls++;return new Response(null,{status:302,headers:{location:url}});}}),null);assert.equal(loopCalls,1);
});

test("Unsafe initial URLs and zero deadlines never trigger a request",async()=>{
  let calls=0;const fetcher:typeof fetch=async()=>{calls++;return response(article);};
  for(const address of ["http://journal.org/article","https://0x7f000001/article","https://2130706433/article","https://[::1]/article","https://user@journal.org/article","https://journal.org:8443/article","https://localtest.me/article","https://host.internal/article","not a URL"]){
    assert.equal(await checkDocumentAvailability(address,{fetcher}),null,address);
  }
  assert.equal(await checkDocumentAvailability(url,{fetcher,timeoutMs:0}),null);assert.equal(calls,0);
});

test("HTML reads stop at 128 KB and cancel unread data",async()=>{
  let cancelled=0,reads=0;
  const chunks=[new TextEncoder().encode(article),new Uint8Array(128*1024).fill(32)];
  const result=await checkDocumentAvailability(url,{fetcher:async()=>new Response(new ReadableStream({pull(controller){reads++;controller.enqueue(chunks.shift()||new Uint8Array(1000));},cancel(){cancelled++;}}),{headers:{"content-type":"text/html"}})});
  assert.deepEqual(result,{url,kind:"html"});assert.equal(cancelled,1);assert.ok(reads<=3);
});

test("The shared deadline covers both pending fetches and stalled body reads",async()=>{
  let signal:AbortSignal|undefined;
  const started=Date.now();
  assert.equal(await checkDocumentAvailability(url,{timeoutMs:20,fetcher:async(_input,init)=>{signal=init?.signal||undefined;return new Promise<Response>(()=>{});}}),null);
  assert.equal(signal?.aborted,true);assert.ok(Date.now()-started<500);
  let cancelled=false;
  assert.equal(await checkDocumentAvailability(url,{timeoutMs:20,fetcher:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{"content-type":"text/html"}})}),null);
  assert.equal(cancelled,true);
  assert.equal(await checkDocumentAvailability(url,{fetcher:async()=>{throw new Error("Connection failed");}}),null);
});
