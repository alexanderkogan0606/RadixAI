// @ts-expect-error Node's native TypeScript tests require the explicit extension.
import { assessResource, cleanSearchQuery, queryTerms, matchesAcquisitionContext } from "./resource-quality.ts";
// @ts-expect-error Node's native TypeScript tests require the explicit extension.
import { discoverFilings, isFilingQuery } from "./filing-discovery.ts";
// @ts-expect-error Node's native TypeScript tests require the explicit extension.
import { checkDocumentAvailability } from "./document-availability.ts";
// @ts-expect-error Node's native TypeScript tests require the explicit extension.
import { parseOpenAireDocuments, buildOpenAireUrl } from "./openaire-discovery.ts";
// @ts-expect-error Node's native TypeScript tests require the explicit extension.
import { documentIdentityKeys } from "./document-identity.ts";

/** These are provider-attributed document records, not claims that the full text was read. */
export type DiscoveryProvider="OpenAlex"|"World Bank"|"SEC EDGAR"|"Crossref"|"OpenAIRE";
export interface DiscoveredDocument {
  id:string;title:string;name:string;url:string;description:string;provider:DiscoveryProvider;
  providerRecordUrl:string;publishedAt?:string;access:"Free";accessBasis:string;fullTextUrl?:string;
  doi?:string;type:"Research paper"|"Report"|"Quarterly report"|"Annual report";domain:"Finance"|"Business"|"Technology"|"Case studies";
  query:string;foundAt:string;
}
export interface ProviderStatus {
  provider:DiscoveryProvider;status:"ok"|"empty"|"error"|"rate-limited"|"timeout";
  count:number;message?:string;httpStatus?:number;retryAt?:string;skippedByCooldown?:boolean;
}
export interface DiscoverySearch {batch:number;nextBatch:number|null;candidatesChecked:number;queryVariants:string[];limitReached?:boolean}
export interface DiscoveryResult {documents:DiscoveredDocument[];providers:ProviderStatus[];searchedAt:string;search?:DiscoverySearch}
export interface DiscoveryOptions {fetcher?:typeof fetch;timeoutMs?:number;batch?:number;excludeUrls?:string[];excludeDois?:string[];continuationKey?:string}
type RecordValue=Record<string,unknown>;
type ProviderResult={documents:DiscoveredDocument[];status:ProviderStatus;candidatesChecked?:number;hasMore?:boolean};
const MAX_RESPONSE_BYTES=1_000_000;
const RESULTS_PER_PROVIDER=24;
const REQUESTED_ROWS=50;
const CROSSREF_ROWS=75;
const MAX_BATCHES=20;
const defaultFetcher:typeof fetch=(input,init)=>globalThis.fetch(input,init);
const record=(value:unknown):RecordValue=>value&&typeof value==="object"&&!Array.isArray(value)?value as RecordValue:{};
const text=(value:unknown)=>typeof value==="string"?value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ").replace(/<[^>]*>/g," ").replace(/&amp;|&#38;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&nbsp;/gi," ").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ").replace(/<[^>]*>/g," ").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim():"";

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
    const path=decodeURIComponent(url.pathname).replace(/\/+$/,"");
    if(/[<>]/.test(path)||/(?:^|\/)(?:browse|browse-by|authors?|creators|collections?|communities)(?:\/|$)/i.test(path)||/\/view\/(?:creators|years?|subjects|divisions|types)(?:\/|$)/i.test(path))return;
    if(!path||/^(?:\/[a-z]{2})?\/(?:home|index\.(?:html?|php|aspx)|search|search-results|publications|papers|articles|reports|resources|library|research|blog|news)$/i.test(path))return;
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
export function matchesDiscoverySubject(document:Pick<DiscoveredDocument,"title"|"description"|"url">,query:string):boolean {
  if(!matchesAcquisitionContext(document,query))return false;
  const plurals:Record<string,string>={chains:"chain",semiconductors:"semiconductor",payments:"payment",markets:"market",industries:"industry",institutions:"institution",technologies:"technology"};
  const canonical=(term:string)=>plurals[term]||term;
  const wanted=queryTerms(query).map(canonical);if(!wanted.length)return false;
  const context=(value:string)=>{
    let result=value.replace(/\bsoftware[ -]as[ -]a[ -]service\b/gi,"SaaS").replace(/\bWorld Bank(?: Group)?\b/gi,match=>/\bWorld Bank\b/i.test(query)?match:"");
    if(wanted.includes("deployment"))result=result.replace(/\b(?:implementations?|adoptions?|applications?|applied|deployed)\b/gi,"deployment");
    return result.replace(/\b(?:chains|semiconductors|payments|markets|industries|institutions|technologies)\b/gi,word=>canonical(word.toLowerCase()));
  };
  const title=context(document.title),lead=context(document.description.slice(0,450));
  // queryTerms limits the user objective to 20 terms; metadata must not be truncated to 20 tokens.
  const wantedQuery=wanted.join(" ");
  const titleTerms=new Set(assessResource({url:document.url,title,description:""},wantedQuery).matchedTerms);
  const contentTerms=new Set(assessResource({url:document.url,title,description:lead},wantedQuery).matchedTerms);
  if(wanted.includes("merger")&&!/\b(?:galax\w*|astrophysic\w*|astronom\w*|black holes?|neutron|stellar|gravitational)\b/i.test(query)){
    if(/\b(?:galax\w*|astrophysic\w*|black holes?|neutron|stellar|gravitational)\b/i.test(`${title} ${lead}`))return false;
    if(!/\b(?:corporat\w*|compan\w*|firms?|banks?|business\w*|financ\w*|equity|shareholders?|acquisitions?|takeovers?|synerg\w*|valuation|profit\w*|revenue|industr\w*|enterprises?|transaction\w*|competition|antitrust)\b/i.test(`${title} ${lead}`))return false;
  }
  const framing=new Set(["company","market","growth","risk","cost","price","impact","impacts","effect","effects","benefit","benefits","evidence","empirical","successful","role","outcome","outcomes"]);
  const subjects=wanted.filter(term=>!framing.has(term)&&!/^\d+$/.test(term));
  const anchors=subjects.length?subjects:wanted;
  if(!anchors.some(term=>titleTerms.has(term)))return false;
  if(wanted.includes("saas")){
    if(!contentTerms.has("saas"))return false;
    const specifics=wanted.filter(term=>["price","retention"].includes(term));
    if(specifics.length&&!specifics.some(term=>contentTerms.has(term)))return false;
  }
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
function crossrefDate(value:unknown):string|undefined {
  const parts=record(value)["date-parts"];
  if(!Array.isArray(parts)||!Array.isArray(parts[0])||parts[0].length<3)return;
  const [year,month,day]=parts[0];if(![year,month,day].every(Number.isInteger))return;
  const date=`${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
  return publishedDate(date)===date&&new Date(date).toISOString().slice(0,10)===date?date:undefined;
}
function creativeCommonsLicense(value:unknown,foundAt:string):{url:string;version:string}|undefined {
  const item=record(value),version=text(item["content-version"]).toLowerCase()||"unspecified";
  if(!["vor","am","unspecified"].includes(version)||typeof item.URL!=="string")return;
  try{
    const url=new URL(item.URL);
    if(!["http:","https:"].includes(url.protocol)||url.username||url.password||url.port||!/^www\.creativecommons\.org$|^creativecommons\.org$/i.test(url.hostname))return;
    // General publisher policies, TDM-only contracts and Public Domain Mark declarations
    // do not establish an explicit Creative Commons reading license for this copy.
    if(!/^\/(?:licenses\/(?:by|by-sa|by-nd|by-nc|by-nc-sa|by-nc-nd)\/(?:1\.0|2\.0|2\.5|3\.0|4\.0)(?:\/[a-z]{2})?|publicdomain\/zero\/1\.0)\/?(?:legalcode|deed(?:\.[a-z]+)?)?\/?$/i.test(url.pathname))return;
    if(item.start!==undefined){
      const start=record(item.start),timestamps:number[]=[];
      if(start["date-parts"]!==undefined){const date=crossrefDate(start);if(!date)return;timestamps.push(Date.parse(date));}
      if(start.timestamp!==undefined){if(typeof start.timestamp!=="number"||!Number.isFinite(start.timestamp)||Math.abs(start.timestamp)<100_000_000_000)return;timestamps.push(start.timestamp);}
      if(start["date-time"]!==undefined){if(typeof start["date-time"]!=="string"||!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(start["date-time"]))return;const instant=Date.parse(start["date-time"]);if(!Number.isFinite(instant))return;timestamps.push(instant);}
      if(!timestamps.length||timestamps.some(timestamp=>timestamp>Date.parse(foundAt))||new Set(timestamps.map(timestamp=>new Date(timestamp).toISOString().slice(0,10))).size!==1)return;
    }
    url.protocol="https:";url.hash="";url.search="";
    return {url:url.href,version};
  }catch{return;}
}
function crossrefDocuments(payload:unknown,query:string,foundAt:string):DiscoveredDocument[] {
  const body=record(payload),message=record(body.message);
  if(body.status!=="ok"||!Array.isArray(message.items))throw new ProviderFailure("error","The provider returned an unexpected response.");
  const documents:DiscoveredDocument[]=[];
  for(const value of message.items.slice(0,CROSSREF_ROWS)){
    const item=record(value),doi=normalizedDoi(item.DOI),title=text(Array.isArray(item.title)?item.title[0]:item.title).slice(0,500),description=text(item.abstract).replace(/^Abstract\s+/i,"").slice(0,3000);
    if(!doi||!title||description.length<28||description.split(/\s+/).length<5||!['journal-article','proceedings-article','posted-content','book-chapter'].includes(text(item.type))||/\b(?:retracted|retraction|withdrawn)\b/i.test(title))continue;
    const licenses=(Array.isArray(item.license)?item.license:[]).slice(0,30).map(value=>creativeCommonsLicense(value,foundAt)).filter((license):license is {url:string;version:string}=>!!license);
    const links=(Array.isArray(item.link)?item.link:[]).slice(0,50).map(record);
    let chosen:{url:string;license:{url:string;version:string}}|undefined;
    for(const license of licenses){
      const matching=links.filter(link=>{
        const version=text(link["content-version"]).toLowerCase()||"unspecified",kind=text(link["content-type"]).toLowerCase();
        return (license.version==="unspecified"?["vor","am","unspecified"].includes(version):version===license.version)&&["application/pdf","text/html","unspecified",""].includes(kind);
      }).sort((a,b)=>Number(text(b["content-type"])==="application/pdf")-Number(text(a["content-type"])==="application/pdf"));
      const url=matching.map(link=>documentUrl(link.URL)).find(Boolean)||
        (license.version!=="am"?documentUrl(record(record(item.resource).primary).URL)||documentUrl(item.URL):undefined);
      if(url){chosen={url,license};break;}
    }
    if(!chosen)continue;
    documents.push({id:`crossref-${doi}`,title,name:title,url:chosen.url,description,provider:"Crossref",
      providerRecordUrl:`https://api.crossref.org/works/${encodeURIComponent(doi)}`,publishedAt:crossrefDate(item.published),access:"Free",
      accessBasis:`The publisher's Crossref record supplies a current Creative Commons license (${chosen.license.url}) for ${chosen.license.version==="vor"?"the version of record":chosen.license.version==="am"?"the linked accepted manuscript":"this work; the publisher did not specify the version"}. This is publisher-deposited license evidence; destination availability has not been independently checked.`,
      fullTextUrl:chosen.url,doi,type:"Research paper",domain:domainFor(query,title),query,foundAt});
  }
  return documents;
}
type TopicProvider="OpenAlex"|"World Bank"|"Crossref"|"OpenAIRE";
const TOPIC_PROVIDERS:TopicProvider[]=["OpenAlex","World Bank","Crossref","OpenAIRE"];
class ProviderFailure extends Error {
  providerStatus:ProviderStatus["status"];httpStatus?:number;retryAt?:string;skippedByCooldown?:boolean;
  constructor(status:ProviderStatus["status"],message:string,httpStatus?:number,retryAt?:string,skippedByCooldown?:boolean){super(message);this.providerStatus=status;this.httpStatus=httpStatus;this.retryAt=retryAt;this.skippedByCooldown=skippedByCooldown;}
}
const cooldowns=new WeakMap<typeof fetch,Map<TopicProvider,number>>();
function assertProviderAvailable(provider:TopicProvider,fetcher:typeof fetch){
  const until=cooldowns.get(fetcher)?.get(provider);
  if(until&&until>Date.now())throw new ProviderFailure("rate-limited","The provider's free search limit is still active; its request was skipped while other free sources are searched.",429,new Date(until).toISOString(),true);
  if(until)cooldowns.get(fetcher)?.delete(provider);
}
function recordRateLimit(provider:TopicProvider,fetcher:typeof fetch,header:string|null):string {
  const now=Date.now(),seconds=header&&/^\d+(?:\.\d+)?$/.test(header.trim())?Number(header):undefined;
  const parsed=header&&seconds===undefined?Date.parse(header):NaN;
  const delay=seconds!==undefined?seconds*1000:Number.isFinite(parsed)?parsed-now:300000;
  // Never retry immediately after 429; honor useful Retry-After values without an unbounded cache lifetime.
  const until=now+Math.max(1000,Math.min(delay,86400000));
  let state=cooldowns.get(fetcher);if(!state){state=new Map();cooldowns.set(fetcher,state);}state.set(provider,until);
  return new Date(until).toISOString();
}
async function boundedJson(url:string,fetcher:typeof fetch,timeoutMs:number,provider:TopicProvider):Promise<unknown> {
  assertProviderAvailable(provider,fetcher);
  const controller=new AbortController();let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{
    controller.abort();void reader?.cancel().catch(()=>{});
    reject(new ProviderFailure("timeout","The provider did not respond before the search deadline. Other free sources may still return results."));
  },timeoutMs);});
  try{
    return await Promise.race([deadline,(async()=>{
      const response=await fetcher(url,{headers:{Accept:"application/json","User-Agent":"RadixAI/1.0 (+https://radixai.sk1616.chatgpt.site/)"},redirect:"manual",signal:controller.signal});
      if(!response.ok){
        void response.body?.cancel();
        if(response.status===429)throw new ProviderFailure("rate-limited","The provider's free search limit was reached. Other free sources are being searched.",429,recordRateLimit(provider,fetcher,response.headers.get("retry-after")));
        throw new ProviderFailure("error",`The provider returned HTTP ${response.status}.`,response.status);
      }
      if(Number(response.headers.get("content-length")||0)>MAX_RESPONSE_BYTES){void response.body?.cancel();throw new ProviderFailure("error","The provider response exceeded the search size limit.");}
      const contentType=response.headers.get("content-type")||"";
      if(contentType&&!/\bjson\b/i.test(contentType)){void response.body?.cancel();throw new ProviderFailure("error","The provider returned a non-JSON response.");}
      if(!response.body)throw new ProviderFailure("error","The provider returned an empty response.");
      reader=response.body.getReader();const decoder=new TextDecoder();let bytes=0,body="";
      while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;
        if(bytes>MAX_RESPONSE_BYTES){void reader.cancel();throw new ProviderFailure("error","The provider response exceeded the search size limit.");}
        body+=decoder.decode(chunk.value,{stream:true});
      }
      reader.releaseLock();reader=undefined;body+=decoder.decode();
      try{return JSON.parse(body);}catch{throw new ProviderFailure("error","The provider returned malformed JSON.");}
    })()]);
  }finally{if(timer)clearTimeout(timer);}
}
const openAireCache=new WeakMap<typeof fetch,Map<string,{expires:number;value:Promise<unknown>}>>();
async function openAireJson(url:string,fetcher:typeof fetch,budget:number):Promise<unknown> {
  let cache=openAireCache.get(fetcher);if(!cache){cache=new Map();openAireCache.set(fetcher,cache);}
  const entry=cache.get(url);let value=entry&&entry.expires>Date.now()?entry.value:undefined;
  if(!value){
    value=boundedJson(url,fetcher,budget,"OpenAIRE");
    if(cache.size>=8)cache.delete(cache.keys().next().value!);cache.set(url,{expires:Date.now()+300000,value});
    const activeCache=cache;void value.catch(()=>activeCache.delete(url));
  }
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([value,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new ProviderFailure("timeout","OpenAIRE did not respond before the search deadline.")),budget);})]);}
  finally{if(timer)clearTimeout(timer);}
}
type CrossrefState={nextStart:number;tail:Promise<void>;cache:Map<string,{expires:number;value:Promise<unknown>}>};
const crossrefStates=new WeakMap<typeof fetch,CrossrefState>();
async function crossrefJson(url:string,fetcher:typeof fetch,deadline:number):Promise<unknown> {
  let state=crossrefStates.get(fetcher);if(!state){state={nextStart:0,tail:Promise.resolve(),cache:new Map()};crossrefStates.set(fetcher,state);}
  const remaining=deadline-Date.now();if(remaining<=0)throw new ProviderFailure("timeout","The search deadline was reached before Crossref could run.");
  const cached=state.cache.get(url);let value=cached&&cached.expires>Date.now()?cached.value:undefined;
  if(!value){
    assertProviderAvailable("Crossref",fetcher);
    const previous=state.tail;
    value=(async()=>{
      await previous;
      assertProviderAvailable("Crossref",fetcher);
      const start=Math.max(Date.now(),state.nextStart);
      if(start>=deadline)throw new ProviderFailure("timeout","Crossref's public request queue is busy; other free sources may still return results.");
      state.nextStart=start+1050;
      if(start>Date.now())await new Promise(resolve=>setTimeout(resolve,start-Date.now()));
      const available=deadline-Date.now();if(available<=0)throw new ProviderFailure("timeout","The search deadline was reached before Crossref could run.");
      return boundedJson(url,fetcher,available,"Crossref");
    })();
    state.tail=value.then(()=>{},()=>{});
    if(state.cache.size>=8)state.cache.delete(state.cache.keys().next().value!);state.cache.set(url,{expires:Date.now()+300000,value});
    const cache=state.cache;void value.catch(()=>{cache.delete(url);});
  }
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([value,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new ProviderFailure("timeout","Crossref did not respond before the search deadline.")),remaining);})]);}
  finally{if(timer)clearTimeout(timer);}
}
async function confirmCrossrefDocuments(candidates:DiscoveredDocument[],fetcher:typeof fetch,deadline:number,onAttempt:(document:DiscoveredDocument)=>void):Promise<DiscoveredDocument[]> {
  const confirmed:(DiscoveredDocument|undefined)[]=new Array(candidates.length);let next=0;
  await Promise.all(Array.from({length:Math.min(3,candidates.length)},async()=>{
    while(next<candidates.length){
      const index=next++,candidate=candidates[index],remaining=deadline-Date.now();if(remaining<=25)break;
      // Verify only the copy selected under this license. Never replace a failed accepted manuscript with an unlicensed DOI copy.
      onAttempt(candidate);
      const available=await checkDocumentAvailability(candidate.url,{fetcher,timeoutMs:Math.min(3000,remaining)});
      if(available)confirmed[index]={...candidate,url:available.url,fullTextUrl:available.url,
        accessBasis:`${candidate.accessBasis.replace("destination availability has not been independently checked.","the provider's license applies to the identified work.")} A public ${available.kind.toUpperCase()} response was fetched successfully without credentials at ${new Date().toISOString()}; a bounded content prefix was checked for document content and access gates. The full document has not been read or analyzed.`};
    }
  }));
  return confirmed.filter((document):document is DiscoveredDocument=>!!document);
}
function queryPlan(query:string):string[] {
  // Drop request framing from search syntax, never from the relevance objective.
  const core=query.replace(/\b(?:case studies|case study|research|articles?|papers?|reports?|documents?|resources?|examples?|please|find|show|me|how|is|are|being|used|using|regarding|concerning|about|the|and|in|on|of|for)\b/gi," ").replace(/\s+/g," ").trim()||query;
  const terms=queryTerms(query),variants=[core,query];
  if(terms.includes("merger"))variants.push("corporate acquisitions","post merger integration");
  else if(terms.includes("saas"))variants.push(`${core} subscription software`,`${core} enterprise software`);
  else if(terms.includes("ai")&&terms.includes("bank"))variants.push(`${core} financial services`,`${core} commercial banks`);
  else variants.push(`${core} empirical evidence`,`${core} case study`);
  return [...new Set(variants.map(value=>value.trim().slice(0,300)).filter(Boolean))].slice(0,4);
}
function providerUrl(provider:TopicProvider,query:string,page:number):string {
  const expanded=query.replace(/\bai\b/gi,"artificial intelligence");
  if(provider==="OpenAIRE")return buildOpenAireUrl(expanded,page,REQUESTED_ROWS);
  const url=new URL(provider==="OpenAlex"?"https://api.openalex.org/works":provider==="Crossref"?"https://api.crossref.org/works":"https://search.worldbank.org/api/v3/wds");
  if(provider==="OpenAlex"){
    url.searchParams.set("search",expanded);url.searchParams.set("filter","open_access.is_oa:true");url.searchParams.set("per-page",String(REQUESTED_ROWS));url.searchParams.set("page",String(page+1));
    url.searchParams.set("select","id,title,doi,publication_date,open_access,best_oa_location,locations,abstract_inverted_index,type,is_retracted");
  }else if(provider==="Crossref"){
    url.searchParams.set("query",expanded);url.searchParams.set("rows",String(CROSSREF_ROWS));url.searchParams.set("offset",String(page*CROSSREF_ROWS));
    url.searchParams.set("filter","has-abstract:true,has-license:true");url.searchParams.set("select","DOI,title,abstract,published,URL,link,license,type");
  }else{
    url.searchParams.set("format","json");url.searchParams.set("qterm",expanded);url.searchParams.set("rows",String(REQUESTED_ROWS));url.searchParams.set("os",String(page*REQUESTED_ROWS));
    url.searchParams.set("fl","docdt,abstracts,docty,pdfurl,url,display_title");
  }
  return url.href;
}
function pageSize(provider:TopicProvider,payload:unknown,page:number):{count:number;hasMore:boolean} {
  const body=record(payload),message=record(body.message);
  const rows=provider==="Crossref"?CROSSREF_ROWS:REQUESTED_ROWS;
  const raw=provider==="OpenAlex"?body.results:provider==="Crossref"?message.items:provider==="OpenAIRE"?body.results:undefined;
  const count=provider==="World Bank"?Object.keys(record(body.documents)).filter(key=>key!=="facets").length:Array.isArray(raw)?raw.length:0;
  const rawTotal=provider==="OpenAlex"?record(body.meta).count:provider==="Crossref"?message["total-results"]:provider==="OpenAIRE"?record(body.header).numFound:body.total;
  const total=(typeof rawTotal==="number"||typeof rawTotal==="string"&&/^\d+$/.test(rawTotal))?Number(rawTotal):NaN;
  return {count,hasMore:Number.isFinite(total)&&total>=0?(page+1)*rows<total:count>=rows};
}
const documentKeys=documentIdentityKeys;
function exclusionKeys(options:DiscoveryOptions):Set<string>{
  const excluded=new Set<string>();
  for(const value of (options.excludeUrls||[]).slice(0,10000)){const url=documentUrl(value);if(url)documentIdentityKeys({url}).forEach(key=>excluded.add(key));}
  for(const value of (options.excludeDois||[]).slice(0,5000)){const doi=normalizedDoi(value);if(doi)excluded.add(`doi:${doi}`);}
  return excluded;
}
type ProgressState={expires:number;query:string;exhausted:Set<string>;pending:Map<TopicProvider,DiscoveredDocument[]>;attempted:Map<TopicProvider,Set<string>>;truncated:boolean};
const progressStates=new WeakMap<typeof fetch,Map<string,ProgressState>>();
function progressFor(fetcher:typeof fetch,query:string,continuationKey?:string):ProgressState {
  const fresh=():ProgressState=>({expires:Date.now()+300000,query,exhausted:new Set(),pending:new Map(),attempted:new Map(),truncated:false});
  // Continuations use a server-generated search UUID, never a shared user query or client-supplied identity.
  if(!continuationKey||!/^[a-zA-Z0-9_-]{8,100}$/.test(continuationKey))return fresh();
  let searches=progressStates.get(fetcher);if(!searches){searches=new Map();progressStates.set(fetcher,searches);}
  let progress=searches.get(continuationKey);
  if(!progress||progress.query!==query||progress.expires<=Date.now()){
    for(const [key,value] of searches)if(value.expires<=Date.now())searches.delete(key);
    if(searches.size>=10)searches.delete(searches.keys().next().value!);
    progress=fresh();searches.set(continuationKey,progress);
  }else progress.expires=Date.now()+300000;
  return progress;
}

/** Company filing requests use SEC; topic research queries independent free public indexes. */
export async function discoverDocuments(input:string,options:DiscoveryOptions={}):Promise<DiscoveryResult> {
  const query=cleanSearchQuery(input),searchedAt=new Date().toISOString();
  const batch=Number.isInteger(options.batch)?Math.max(0,Math.min(MAX_BATCHES-1,options.batch!)):0;
  if(isFilingQuery(query)){
    const filings=await discoverFilings(query,options,searchedAt),excluded=exclusionKeys(options);
    return {documents:filings.documents.filter(document=>!documentKeys(document).some(key=>excluded.has(key))),providers:[filings.status],searchedAt,search:{batch,nextBatch:null,candidatesChecked:filings.documents.length,queryVariants:[query]}};
  }
  if(query.length<2||!queryTerms(query).length)return {documents:[],searchedAt,providers:TOPIC_PROVIDERS.map(provider=>({provider,status:"empty",count:0,message:"Enter a specific research topic to search for documents."})),search:{batch,nextBatch:null,candidatesChecked:0,queryVariants:[]}};
  const fetcher=options.fetcher||defaultFetcher,timeoutMs=Math.max(50,Math.min(options.timeoutMs||15000,15000)),deadline=Date.now()+timeoutMs;
  const variants=queryPlan(query),page=Math.floor(batch/variants.length),excluded=exclusionKeys(options),progress=progressFor(fetcher,query,options.continuationKey);
  const searches=TOPIC_PROVIDERS.map(provider=>{
    // Crossref's title/abstract search benefits from the original case-study phrase; World Bank starts with broad topic terms.
    const first=provider==="Crossref"?Math.max(0,variants.indexOf(query)):0;
    const variant=(batch+first)%variants.length;
    return {provider,variant,query:variants[variant]};
  });
  const runProvider=async({provider,variant,query:searchQuery}:typeof searches[number]):Promise<ProviderResult>=>{
    const progressKey=`${provider}:${variant}`;
    try{
      const budget=deadline-Date.now();if(budget<=0)throw new ProviderFailure("timeout","The search deadline was reached before this provider could run.");
      const url=providerUrl(provider,searchQuery,page);
      const payload=provider==="Crossref"?await crossrefJson(url,fetcher,Math.min(deadline,Date.now()+6000)):provider==="OpenAIRE"?await openAireJson(url,fetcher,budget):await boundedJson(url,fetcher,Math.min(budget,provider==="OpenAlex"?8000:15000),provider);
      const pagination=pageSize(provider,payload,page);
      const candidates=(provider==="OpenAlex"?openAlexDocuments:provider==="Crossref"?crossrefDocuments:provider==="OpenAIRE"?parseOpenAireDocuments:worldBankDocuments)(payload,query,searchedAt);
      const attempted=progress.attempted.get(provider)||new Set<string>();progress.attempted.set(provider,attempted);
      const seen=new Set([...excluded,...attempted]);
      const qualified=candidates.map(document=>({document,assessment:assessResource(document,query)})).filter(item=>item.assessment.eligible&&matchesDiscoverySubject(item.document,query)).sort((a,b)=>{
        const direct=(document:DiscoveredDocument)=>Number(!/\bdoi\.org\//i.test(document.url));
        return provider==="Crossref"?(direct(b.document)-direct(a.document)||b.assessment.score-a.assessment.score):b.assessment.score-a.assessment.score;
      }).map(item=>item.document);
      // Carry the unreturned eligible records into this search's next batch before adding new records.
      const matched=[...(progress.pending.get(provider)||[]),...qualified].filter(document=>{const keys=documentKeys(document);if(keys.some(key=>seen.has(key)))return false;keys.forEach(key=>seen.add(key));return true;});
      const selected=matched.slice(0,RESULTS_PER_PROVIDER),pending=matched.slice(RESULTS_PER_PROVIDER),checked:DiscoveredDocument[]=[];
      const documents=provider==="Crossref"?await confirmCrossrefDocuments(selected,fetcher,deadline,document=>checked.push(document)):selected;
      const confirmed=new Set(documents.flatMap(documentKeys));
      // Successful documents stay retryable until the server sends their persisted URL/DOI exclusions.
      // Only unsuccessful public-access checks are suppressed within this search chain.
      for(const document of checked)if(!documentKeys(document).some(key=>confirmed.has(key)))documentKeys(document).forEach(key=>attempted.add(key));
      const deferred=[...selected,...pending].filter(document=>!documentKeys(document).some(key=>attempted.has(key)));
      if(deferred.length>100)progress.truncated=true;progress.pending.set(provider,deferred.slice(0,100));
      const hasMore=pagination.hasMore||pending.length>0;
      // Provider pagination is independent of a user's exclusion list. Pending records prevent final exhaustion.
      if(!pagination.hasMore)progress.exhausted.add(progressKey);else progress.exhausted.delete(progressKey);
      if(provider==="Crossref"&&!documents.length&&matched.length)return {documents:[],candidatesChecked:pagination.count,hasMore,status:{provider,status:Date.now()>=deadline?"timeout":"empty",count:0,message:"Matching records found, but no document passed the public-access check."}};
      return {documents,candidatesChecked:pagination.count,hasMore,status:{provider,status:documents.length?"ok":"empty",count:documents.length,...(!documents.length?{message:matched.length?"No new documents were available in this batch.":"No new matching free documents with usable titles or summaries were returned in this batch."}:{})}};
    }catch(error){
      if(!(error instanceof ProviderFailure))console.warn("Document discovery request failed",{provider,name:error instanceof Error?error.name:"UnknownError",message:error instanceof Error?error.message.replace(/https?:\/\/[^\s"']+/gi,"[provider URL]").slice(0,300):"Unknown network failure"});
      const failure=error instanceof ProviderFailure?error:error instanceof Error&&["AbortError","TimeoutError"].includes(error.name)?new ProviderFailure("timeout","The provider did not respond before the search deadline."):new ProviderFailure("error","The provider could not be reached. Other providers may still return results.");
      progress.exhausted.delete(progressKey);
      return {documents:[],candidatesChecked:0,hasMore:true,status:{provider,status:failure.providerStatus,count:0,message:failure.message,...(failure.httpStatus?{httpStatus:failure.httpStatus}:{}),...(failure.retryAt?{retryAt:failure.retryAt}:{}),...(failure.skippedByCooldown?{skippedByCooldown:true}:{})}};
    }
  };
  const results=await Promise.all(searches.map(runProvider));
  const seen=new Set(excluded),documents:DiscoveredDocument[]=[];
  for(const document of results.flatMap(result=>result.documents)){
    const keys=documentKeys(document),duplicate=keys.some(key=>seen.has(key));keys.forEach(key=>seen.add(key));if(!duplicate)documents.push(document);
  }
  const delivered=new Set(documents.flatMap(documentKeys));
  const exhausted=!progress.truncated&&TOPIC_PROVIDERS.every(provider=>!(progress.pending.get(provider)||[]).some(document=>!documentKeys(document).some(key=>delivered.has(key)||excluded.has(key)))&&variants.every((_,index)=>progress.exhausted.has(`${provider}:${index}`)));
  const limitReached=batch===MAX_BATCHES-1&&!exhausted;
  return {documents,providers:results.map(result=>result.status),searchedAt,search:{batch,nextBatch:exhausted||batch===MAX_BATCHES-1?null:batch+1,candidatesChecked:results.reduce((sum,result)=>sum+(result.candidatesChecked||0),0),queryVariants:[...new Set(searches.map(search=>search.query))],...(limitReached?{limitReached:true}:{})}};
}
