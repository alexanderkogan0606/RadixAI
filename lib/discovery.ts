// @ts-expect-error Node's native TypeScript tests require the explicit extension.
import { assessResource, cleanSearchQuery, queryTerms } from "./resource-quality.ts";
// @ts-expect-error Node's native TypeScript tests require the explicit extension.
import { discoverFilings, isFilingQuery } from "./filing-discovery.ts";

/** These are provider-attributed document records, not claims that the full text was read. */
export type DiscoveryProvider="OpenAlex"|"World Bank"|"SEC EDGAR";
export interface DiscoveredDocument {
  id:string;title:string;name:string;url:string;description:string;provider:DiscoveryProvider;
  providerRecordUrl:string;publishedAt?:string;access:"Free";accessBasis:string;fullTextUrl?:string;
  doi?:string;type:"Research paper"|"Report"|"Quarterly report"|"Annual report";domain:"Finance"|"Business"|"Technology"|"Case studies";
  query:string;foundAt:string;
}
export interface ProviderStatus {
  provider:DiscoveryProvider;status:"ok"|"empty"|"error"|"rate-limited"|"timeout";
  count:number;message?:string;httpStatus?:number;
}
export interface DiscoveryResult {documents:DiscoveredDocument[];providers:ProviderStatus[];searchedAt:string}
export interface DiscoveryOptions {fetcher?:typeof fetch;timeoutMs?:number}
type RecordValue=Record<string,unknown>;
type ProviderResult={documents:DiscoveredDocument[];status:ProviderStatus};
const MAX_RESPONSE_BYTES=1_000_000;
const RESULTS_PER_PROVIDER=8;
const REQUESTED_ROWS=12;
const record=(value:unknown):RecordValue=>value&&typeof value==="object"&&!Array.isArray(value)?value as RecordValue:{};
const text=(value:unknown)=>typeof value==="string"?value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ").replace(/<[^>]*>/g," ").replace(/&amp;|&#38;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&nbsp;/gi," ").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim():"";

/** Strip tracking only. Article IDs, DOI paths and meaningful query parameters remain intact. */
function documentUrl(value:unknown,upgradeWorldBank=false):string|undefined {
  if(typeof value!=="string"||value.length>2400)return;
  try{
    const url=new URL(value),host=url.hostname.toLowerCase().replace(/\.$/,"");
    if(upgradeWorldBank&&url.protocol==="http:"&&/^(?:documents1?|thedocs)\.worldbank\.org$/.test(host))url.protocol="https:";
    if(url.protocol!=="https:"||url.username||url.password||(url.port&&url.port!=="443")||!host.includes(".")||host.includes(":")||/^[\d.]+$/.test(host)||/(^|\.)(?:localhost|local|internal|home|lan|corp|test|invalid|example|onion|nip\.io|sslip\.io|lvh\.me)$/.test(host))return;
    url.hostname=host;url.hash="";
    for(const key of [...url.searchParams.keys()])if(/^utm_/i.test(key)||["fbclid","gclid","msclkid"].includes(key.toLowerCase()))url.searchParams.delete(key);
    url.searchParams.sort();
    // A provider's home page or search listing is never a document result.
    const path=url.pathname.replace(/\/+$/,"");
    if(!path||/^(?:\/[a-z]{2})?\/(?:home|index\.(?:html?|php|aspx)|search|search-results|publications|papers|articles|reports|resources|library)$/i.test(path))return;
    return url.href;
  }catch{return;}
}
function normalizedDoi(value:unknown):string|undefined {
  const doi=text(value).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,"").replace(/^doi:\s*/i,"").toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(doi)?doi:undefined;
}
function publishedDate(value:unknown):string|undefined {
  const date=text(value).slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))?date:undefined;
}
function domainFor(query:string,title:string):DiscoveredDocument["domain"] {
  const combined=`${query} ${title}`;
  if(/\bcase stud(?:y|ies)\b/i.test(query))return "Case studies";
  if(/\b(?:financ\w*|bank\w*|credit|invest\w*|stock\w*|equity|bond\w*|monetary|macroeconom\w*|mergers?|acquisitions?)\b/i.test(combined))return "Finance";
  if(/\b(?:tech\w*|software|cloud|ai|artificial intelligence|machine learning|comput\w*|semiconductor\w*|digital)\b/i.test(combined))return "Technology";
  return "Business";
}
function abstractFromIndex(value:unknown):string {
  const entries=Object.entries(record(value)).slice(0,5000),words=new Map<number,string>();
  for(const [word,positions] of entries){
    if(!Array.isArray(positions))continue;
    for(const position of positions.slice(0,1500))if(Number.isInteger(position)&&position>=0&&position<3000)words.set(position,text(word).slice(0,180));
  }
  return text([...words.entries()].sort((a,b)=>a[0]-b[0]).map(([,word])=>word).join(" ")).slice(0,3000);
}
function worldBankAbstract(value:unknown):string {
  if(typeof value==="string")return text(value).slice(0,3000);
  const item=record(value);return text(item["cdata!"]||item.cdata||item.abstract||item.text).slice(0,3000);
}

/** Provider search can match incidental full-text mentions. Require evidence of the requested subject. */
function subjectMatch(document:DiscoveredDocument,query:string):boolean {
  const plurals:Record<string,string>={chains:"chain",semiconductors:"semiconductor",payments:"payment",markets:"market",industries:"industry",institutions:"institution",technologies:"technology"};
  const canonical=(term:string)=>plurals[term]||term;
  const wanted=queryTerms(query).map(canonical);if(!wanted.length)return false;
  const context=(value:string)=>{
    let result=value.replace(/\bsoftware[ -]as[ -]a[ -]service\b/gi,"SaaS").replace(/\bWorld Bank(?: Group)?\b/gi,match=>/\bWorld Bank\b/i.test(query)?match:"");
    if(wanted.includes("deployment"))result=result.replace(/\b(?:implementations?|adoptions?|applications?|applied|deployed)\b/gi,"deployment");
    return result;
  };
  const title=context(document.title),lead=context(document.description.slice(0,450));
  const titleTerms=new Set(queryTerms(title).map(canonical)),contentTerms=new Set(queryTerms(`${title} ${lead}`).map(canonical));
  const framing=new Set(["company","market","growth","risk","cost","price","impact","impacts","effect","effects","benefit","benefits","evidence","empirical","successful","role","outcome","outcomes"]);
  const subjects=wanted.filter(term=>!framing.has(term)&&!/^\d+$/.test(term));
  const anchors=subjects.length?subjects:wanted;
  if(!anchors.some(term=>titleTerms.has(term)))return false;
  // A one-concept query such as M&A must actually be a subject of the title.
  if(wanted.length<=3&&!wanted.every(term=>contentTerms.has(term)))return false;
  if(wanted.length>3&&anchors.filter(term=>contentTerms.has(term)).length<Math.min(2,anchors.length))return false;
  if(wanted.includes("ai")&&!/\bartificial intelligence\b|\bmachine learning\b|\bdeep learning\b|\b(?:large )?language models?\b|\bneural networks?\b|\bgenerative ai\b/i.test(`${title} ${lead}`))return false;
  return true;
}

function openAlexDocuments(payload:unknown,query:string,foundAt:string):DiscoveredDocument[] {
  const body=record(payload);
  if(!Array.isArray(body.results))throw new ProviderFailure("error","The provider returned an unexpected response.");
  const documents:DiscoveredDocument[]=[];
  for(const item of body.results.slice(0,REQUESTED_ROWS)){
    const work=record(item),oa=record(work.open_access),best=record(work.best_oa_location);
    if(oa.is_oa!==true||best.is_oa!==true||work.is_retracted===true)continue;
    const providerRecordUrl=documentUrl(work.id),identifier=providerRecordUrl?.match(/^https:\/\/openalex\.org\/(W\d+)$/)?.[1];
    if(!identifier||!providerRecordUrl)continue;
    const locations=[best,...(Array.isArray(work.locations)?work.locations.slice(0,100).map(record):[])].filter(location=>location.is_oa===true);
    const copies=locations.map(location=>{
      const landing=documentUrl(location.landing_page_url),pdf=documentUrl(location.pdf_url),fallback=location===best?documentUrl(oa.oa_url):undefined;
      const direct=(value?:string)=>value&&!/^(?:dx\.)?doi\.org$/i.test(new URL(value).hostname)?value:undefined;
      return {location,url:direct(landing)||direct(pdf)||direct(fallback)||landing||pdf||fallback,pdf};
    }).filter(copy=>copy.url);
    // Prefer the best direct copy; otherwise use another explicitly OA repository copy before a DOI redirect.
    const chosen=copies.find(copy=>!/^(?:dx\.)?doi\.org$/i.test(new URL(copy.url!).hostname))||copies[0];
    if(!chosen?.url)continue;
    const {url,location}=chosen;
    const title=text(work.title||work.display_name).slice(0,500),description=abstractFromIndex(work.abstract_inverted_index);
    const fullTextUrl=chosen.pdf||url;
    const license=text(location.license).slice(0,80),version=text(location.version).slice(0,80);
    documents.push({id:`openalex-${identifier}`,title,name:title,url,description,provider:"OpenAlex",providerRecordUrl,
      publishedAt:publishedDate(work.publication_date),access:"Free",
      accessBasis:`OpenAlex marks this document and the linked copy as open access (readable without payment or login)${license?`; license: ${license}`:""}${version?`; version: ${version}`:""}. Destination availability has not been independently checked.`,
      fullTextUrl,doi:normalizedDoi(work.doi||location.doi),type:"Research paper",domain:domainFor(query,title),query,foundAt});
  }
  return documents;
}
function worldBankDocuments(payload:unknown,query:string,foundAt:string):DiscoveredDocument[] {
  const body=record(payload);
  if(!body.documents||typeof body.documents!=="object"||Array.isArray(body.documents))throw new ProviderFailure("error","The provider returned an unexpected response.");
  const documents:DiscoveredDocument[]=[];
  for(const [key,value] of Object.entries(record(body.documents)).slice(0,REQUESTED_ROWS+1)){
    if(key==="facets")continue;
    const item=record(value),id=text(item.id)||key.replace(/^D/,"");
    const url=documentUrl(item.url,true),fullTextUrl=documentUrl(item.pdfurl,true);
    if(!/^\d+$/.test(id)||!url||!fullTextUrl)continue;
    const landing=new URL(url),pdf=new URL(fullTextUrl);
    if(landing.hostname!=="documents.worldbank.org"||!/^\/curated\/[a-z]{2}\/\d+(?:\/|$)/i.test(landing.pathname)||!/^(?:documents1?|thedocs)\.worldbank\.org$/.test(pdf.hostname)||!/^\/(?:curated|en\/doc)\//.test(pdf.pathname)||!(/\.pdf$/i.test(pdf.pathname)||/\/pdf\//.test(pdf.pathname)))continue;
    const title=text(item.display_title||item.docna).slice(0,500),description=worldBankAbstract(item.abstracts||item.ml_abstract);
    documents.push({id:`worldbank-${id}`,title,name:title,url,description,provider:"World Bank",providerRecordUrl:url,
      publishedAt:publishedDate(item.docdt),access:"Free",accessBasis:"The World Bank public Documents & Reports API supplies this specific document record and a public PDF link. Destination availability has not been independently checked.",
      fullTextUrl,type:"Report",domain:domainFor(query,title),query,foundAt});
  }
  return documents;
}
class ProviderFailure extends Error {
  providerStatus:ProviderStatus["status"];httpStatus?:number;
  constructor(status:ProviderStatus["status"],message:string,httpStatus?:number){super(message);this.providerStatus=status;this.httpStatus=httpStatus;}
}
async function boundedJson(url:string,fetcher:typeof fetch,timeoutMs:number):Promise<unknown> {
  const controller=new AbortController();let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{
    controller.abort();void reader?.cancel().catch(()=>{});
    reject(new ProviderFailure("timeout","The provider did not respond before the search deadline. Try again later."));
  },timeoutMs);});
  try{
    return await Promise.race([deadline,(async()=>{
      const response=await fetcher(url,{headers:{Accept:"application/json","User-Agent":"SignalResearch/1.0 (public open-access document discovery)"},redirect:"manual",signal:controller.signal});
      if(!response.ok){void response.body?.cancel();throw new ProviderFailure(response.status===429?"rate-limited":"error",response.status===429?"The provider's free search limit was reached. Try again later.":`The provider returned HTTP ${response.status}.`,response.status);}
      if(Number(response.headers.get("content-length")||0)>MAX_RESPONSE_BYTES){void response.body?.cancel();throw new ProviderFailure("error","The provider response exceeded the search size limit.");}
      const contentType=response.headers.get("content-type")||"";
      if(contentType&&!/\bjson\b/i.test(contentType)){void response.body?.cancel();throw new ProviderFailure("error","The provider returned a non-JSON response.");}
      if(!response.body)throw new ProviderFailure("error","The provider returned an empty response.");
      reader=response.body.getReader();const decoder=new TextDecoder();let bytes=0,body="";
      while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;
        if(bytes>MAX_RESPONSE_BYTES){void reader.cancel();throw new ProviderFailure("error","The provider response exceeded the search size limit.");}
        body+=decoder.decode(chunk.value,{stream:true});
      }
      reader.releaseLock();reader=undefined;
      body+=decoder.decode();
      try{return JSON.parse(body);}catch{throw new ProviderFailure("error","The provider returned malformed JSON.");}
    })()]);
  }finally{if(timer)clearTimeout(timer);}
}
function providerUrl(provider:"OpenAlex"|"World Bank",query:string):string {
  const url=new URL(provider==="OpenAlex"?"https://api.openalex.org/works":"https://search.worldbank.org/api/v3/wds");
  if(provider==="OpenAlex"){
    url.searchParams.set("search",query.replace(/\bai\b/gi,"artificial intelligence"));url.searchParams.set("filter","open_access.is_oa:true");url.searchParams.set("per-page",String(REQUESTED_ROWS));
    url.searchParams.set("select","id,title,doi,publication_date,open_access,best_oa_location,locations,abstract_inverted_index,type,is_retracted");
  }else{
    url.searchParams.set("format","json");url.searchParams.set("qterm",query.replace(/\bai\b/gi,"artificial intelligence"));url.searchParams.set("rows",String(REQUESTED_ROWS));
    url.searchParams.set("fl","docdt,abstracts,docty,pdfurl,url,display_title");
  }
  return url.href;
}

/** Company filing requests use SEC; topic research uses two independent no-key providers. */
export async function discoverDocuments(input:string,options:DiscoveryOptions={}):Promise<DiscoveryResult> {
  const query=cleanSearchQuery(input),searchedAt=new Date().toISOString(),providers:("OpenAlex"|"World Bank")[]=["OpenAlex","World Bank"];
  if(isFilingQuery(query)){
    const filings=await discoverFilings(query,options,searchedAt);
    return {documents:filings.documents,providers:[filings.status],searchedAt};
  }
  if(query.length<2||!queryTerms(query).length)return {documents:[],searchedAt,providers:providers.map(provider=>({provider,status:"empty",count:0,message:"Enter a specific research topic to search for documents."}))};
  const fetcher=options.fetcher||((input,init)=>globalThis.fetch(input,init)),timeoutMs=Math.max(50,Math.min(options.timeoutMs||8000,8000));
  const results=await Promise.all(providers.map(async(provider):Promise<ProviderResult>=>{
    try{
      const payload=await boundedJson(providerUrl(provider,query),fetcher,timeoutMs);
      const candidates=(provider==="OpenAlex"?openAlexDocuments:worldBankDocuments)(payload,query,searchedAt);
      const documents=candidates.map(document=>({document,assessment:assessResource(document,query)})).filter(item=>item.assessment.eligible&&subjectMatch(item.document,query)).sort((a,b)=>b.assessment.score-a.assessment.score).slice(0,RESULTS_PER_PROVIDER).map(item=>item.document);
      return {documents,status:{provider,status:documents.length?"ok":"empty",count:documents.length,...(!documents.length?{message:"No matching free documents with usable titles or summaries were returned."}:{})}};
    }catch(error){
      // Keep provider/network diagnostics on the server; never log the query, URL, body or credentials.
      if(!(error instanceof ProviderFailure))console.warn("Document discovery request failed",{provider,name:error instanceof Error?error.name:"UnknownError",message:error instanceof Error?error.message.replace(/https?:\/\/[^\s"']+/gi,"[provider URL]").slice(0,300):"Unknown network failure"});
      const failure=error instanceof ProviderFailure?error:error instanceof Error&&["AbortError","TimeoutError"].includes(error.name)?new ProviderFailure("timeout","The provider did not respond before the search deadline. Try again later."):new ProviderFailure("error","The provider could not be reached. Other providers may still return results.");
      return {documents:[],status:{provider,status:failure.providerStatus,count:0,message:failure.message,...(failure.httpStatus?{httpStatus:failure.httpStatus}:{})}};
    }
  }));
  const seen=new Set<string>(),documents:DiscoveredDocument[]=[];
  for(const document of results.flatMap(result=>result.documents)){
    const keys=[`url:${document.url}`,...(document.fullTextUrl?[`url:${document.fullTextUrl}`]:[]),...(document.doi?[`doi:${document.doi}`]:[])];
    const duplicate=keys.some(key=>seen.has(key));keys.forEach(key=>seen.add(key));
    if(!duplicate)documents.push(document);
  }
  return {documents,providers:results.map(result=>result.status),searchedAt};
}
