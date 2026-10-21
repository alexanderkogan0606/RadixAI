import type { DiscoveredDocument } from "./discovery";
// @ts-expect-error Native TypeScript tests require the explicit extension.
import { assessResource, cleanSearchQuery } from "./resource-quality.ts";

/** OpenAIRE Graph v4 metadata, with access evidence attached to the selected instance. */
const ENDPOINT="https://api.openaire.eu/graph/v4/research-products";
const MAX_ROWS=100;
type ObjectValue=Record<string,unknown>;
const object=(value:unknown):ObjectValue=>value&&typeof value==="object"&&!Array.isArray(value)?value as ObjectValue:{};
function plain(value:unknown,max=3000):string {
  if(typeof value!=="string")return "";
  return value.slice(0,30_000).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ").replace(/<[^>]*>/g," ")
    .replace(/&#(x[\da-f]+|\d+);/gi,(_,raw:string)=>{const point=raw[0].toLowerCase()==="x"?parseInt(raw.slice(1),16):Number(raw);return point>0&&point<=0x10ffff?String.fromCodePoint(point):" ";})
    .replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&quot;/gi,'"').replace(/&apos;/gi,"'").replace(/&nbsp;/gi," ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ").replace(/<[^>]*>/g," ").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max);
}
function publicDocumentUrl(value:unknown):string|undefined {
  if(typeof value!=="string"||value.length>2400)return;
  try{
    const url=new URL(value),host=url.hostname.toLowerCase().replace(/\.$/,"");
    if(url.protocol!=="https:"||url.username||url.password||(url.port&&url.port!=="443")||!host.includes(".")||host.includes(":")||/^[\d.]+$/.test(host)||/(^|\.)(?:localhost|local|internal|home|lan|corp|test|invalid|example|onion|nip\.io|sslip\.io|lvh\.me|localtest\.me)$/.test(host))return;
    url.hostname=host;url.hash="";
    for(const key of [...url.searchParams.keys()])if(/^utm_/i.test(key)||["fbclid","gclid","msclkid"].includes(key.toLowerCase()))url.searchParams.delete(key);
    url.searchParams.sort();
    const path=decodeURIComponent(url.pathname).replace(/\/+$/,"");
    if(!path||/^(?:\/[a-z]{2})?\/(?:home|index\.(?:html?|php|aspx)|search|search-results|publications|papers|articles|reports|resources|library)$/i.test(path))return;
    return url.href;
  }catch{return;}
}
function date(value:unknown):string|undefined {
  const candidate=plain(value,30).slice(0,10),parsed=Date.parse(candidate);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate)&&Number.isFinite(parsed)&&new Date(parsed).toISOString().slice(0,10)===candidate?candidate:undefined;
}
function normalizedDoi(value:unknown):string|undefined {
  const candidate=plain(value,600).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,"").replace(/^doi:\s*/i,"").toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(candidate)?candidate:undefined;
}
function domain(query:string,title:string):DiscoveredDocument["domain"] {
  if(/\bcase stud(?:y|ies)\b/i.test(query))return "Case studies";
  const combined=`${query} ${title}`;
  if(/\b(?:financ\w*|bank\w*|credit|invest\w*|stock\w*|equity|bond\w*|monetary|macroeconom\w*|mergers?|acquisitions?)\b/i.test(combined))return "Finance";
  return /\b(?:tech\w*|software|cloud|ai|artificial intelligence|machine learning|comput\w*|semiconductor\w*|digital)\b/i.test(combined)?"Technology":"Business";
}
function explicitlyOpen(value:unknown):boolean {
  const access=object(value),label=plain(access.label,80).toLowerCase(),code=plain(access.code,80).toLowerCase();
  // A work-level bestAccessRight or a license alone never grants access to another copy.
  return (!!label||!!code)&&(!label||label==="open"||label==="open access")&&(!code||code==="c_abf2");
}
function notEmbargoed(value:unknown,foundAt:string):boolean {
  if(value===undefined||value===null||value==="")return true;
  const end=date(value),now=Date.parse(foundAt);
  return !!end&&Number.isFinite(now)&&Date.parse(end)<=now;
}
const doiUrl=(url:string)=>/^(?:dx\.)?doi\.org$/i.test(new URL(url).hostname);
const pdfUrl=(url:string)=>/\.pdf(?:$|[?#])/i.test(url)||/\/pdf(?:\/|$)/i.test(new URL(url).pathname);

/** pageIndex is zero based; public offset pagination is limited to 10,000 records. */
export function buildOpenAireUrl(query:string,pageIndex=0,rows=50):string {
  const pageSize=Number.isFinite(rows)?Math.max(1,Math.min(MAX_ROWS,Math.floor(rows))):50;
  const page=Number.isFinite(pageIndex)?Math.max(0,Math.min(Math.floor(10_000/pageSize)-1,Math.floor(pageIndex)))+1:1;
  const url=new URL(ENDPOINT);
  url.searchParams.set("search",cleanSearchQuery(query));
  url.searchParams.set("filter","type:publication,best_oa.rights:Open Access");
  url.searchParams.set("page",String(page));url.searchParams.set("page_size",String(pageSize));
  url.searchParams.set("select","id,type,mainTitle,descriptions,publicationDate,embargoEndDate,pids,instances");
  return url.href;
}

/** Raw provider rows drive exhaustion; accepted rows must not be mistaken for page size. */
export function openAirePagination(payload:unknown):{count:number;total?:number} {
  const body=object(payload);
  if(!Array.isArray(body.results))throw new Error("OpenAIRE returned an unexpected response.");
  const total=object(body.header).numFound;
  return {count:body.results.length,...(typeof total==="number"&&Number.isSafeInteger(total)&&total>=0?{total}:{})};
}

/** Parses provider evidence only. The discovery service applies query relevance and request limits. */
export function parseOpenAireDocuments(payload:unknown,query:string,foundAt:string):DiscoveredDocument[] {
  openAirePagination(payload);
  const rows=object(payload).results as unknown[],documents:DiscoveredDocument[]=[],seen=new Set<string>();
  for(const value of rows.slice(0,MAX_ROWS)){
    const work=object(value),id=plain(work.id,250),title=plain(work.mainTitle,500);
    if(!/^[a-zA-Z0-9_.-]+::[a-zA-Z0-9_.-]+$/.test(id)||work.type!=="publication"||!title||/\b(?:retraction|retracted|withdrawn)\b/i.test(title)||!notEmbargoed(work.embargoEndDate,foundAt))continue;
    const descriptions=(Array.isArray(work.descriptions)?work.descriptions:[]).slice(0,10).map(value=>plain(value));
    // Descriptions are supplied metadata; missing abstracts must not become invented summaries.
    const description=descriptions.find(value=>value.length>=28&&value.split(/\s+/).length>=5);
    if(!description)continue;
    const copies:{url:string;instance:ObjectValue;score:number}[]=[];
    for(const rawInstance of (Array.isArray(work.instances)?work.instances:[]).slice(0,100)){
      const instance=object(rawInstance);
      if(!explicitlyOpen(instance.accessRight)||!notEmbargoed(instance.embargoEndDate,foundAt))continue;
      for(const rawUrl of (Array.isArray(instance.urls)?instance.urls:[]).slice(0,30)){
        const url=publicDocumentUrl(rawUrl);
        if(url&&assessResource({url,title,description}).eligible)copies.push({url,instance,score:(doiUrl(url)?0:10)+(pdfUrl(url)?2:0)});
      }
    }
    copies.sort((a,b)=>b.score-a.score);
    const chosen=copies[0];if(!chosen)continue;
    const identifiers=(Array.isArray(work.pids)?work.pids:[]).slice(0,30).map(object);
    const doi=identifiers.filter(pid=>plain(pid.scheme,20).toLowerCase()==="doi").map(pid=>normalizedDoi(pid.value)).find(Boolean)|| (doiUrl(chosen.url)?normalizedDoi(chosen.url):undefined);
    if(seen.has(`id:${id}`)||seen.has(`url:${chosen.url}`)||(doi&&seen.has(`doi:${doi}`)))continue;
    seen.add(`id:${id}`);seen.add(`url:${chosen.url}`);if(doi)seen.add(`doi:${doi}`);
    const recordUrl=new URL(ENDPOINT);recordUrl.searchParams.set("filter",`id:${id}`);
    const license=plain(chosen.instance.license,160),kind=plain(chosen.instance.type,80);
    documents.push({id:`openaire-${id}`,title,name:title,url:chosen.url,description,provider:"OpenAIRE",providerRecordUrl:recordUrl.href,
      publishedAt:date(work.publicationDate)||date(chosen.instance.publicationDate),access:"Free",
      accessBasis:`OpenAIRE marks the specific linked instance as open access${license?`; instance license: ${license}`:""}. This is provider metadata; destination availability has not been independently checked.`,
      fullTextUrl:chosen.url,doi,type:/\b(?:book|report|thesis|dissertation)\b/i.test(kind)?"Report":"Research paper",domain:domain(query,title),query,foundAt});
  }
  return documents;
}
