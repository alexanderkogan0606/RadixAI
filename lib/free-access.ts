/** Access is a destination property: a free seed never makes all its outbound links free. */
export type ResourceAccess = "Free" | "Freemium" | "Mixed" | "Paid" | "Unknown";
export interface AccessSource { id?:string; url:string; feedUrl?:string; access?:string; exact?:boolean }

export function isFreeSource(source:{access?:string}):boolean { return source.access === "Free"; }
function accessOf(source?:AccessSource):ResourceAccess {
  return source && ["Free","Freemium","Mixed","Paid"].includes(source.access || "") ? source.access as ResourceAccess : "Unknown";
}
const hostOf=(url:URL)=>url.hostname.toLowerCase().replace(/\.$/,"").replace(/^www\./,"");
type Candidate={source:AccessSource;url:URL;path:string;exact:boolean};
const indexes=new WeakMap<readonly AccessSource[],Map<string,Candidate[]>>();
function sourceIndex(sources:readonly AccessSource[]) {
  let index=indexes.get(sources);if(index)return index;
  index=new Map();
  for(const source of sources)for(const [address,exact] of [[source.url,false],[source.feedUrl,true]] as const){
    if(!address)continue;
    try{
      const url=new URL(address);if(url.protocol!=="https:"||url.username||url.password)continue;
      const host=hostOf(url),entries=index.get(host)||[];
      entries.push({source,url,path:url.pathname.replace(/\/+$/,"")||"/",exact:exact||source.exact===true});index.set(host,entries);
    }catch{/* An invalid catalog URL cannot establish access. */}
  }
  indexes.set(sources,index);return index;
}

/** Match exact hosts (plus www), then the most specific path, respecting segment boundaries.
 * Query-specific seeds require their query values. Feeds only establish access for that exact feed.
 * A restricted entry wins a same-path conflict; unrelated subdomains never inherit access. */
export function sourceForUrl(address:string,sources:readonly AccessSource[]):AccessSource|undefined {
  let url:URL;try{url=new URL(address);}catch{return undefined;}
  if(url.protocol!=="https:"||url.username||url.password||(url.port&&url.port!=="443"))return undefined;
  const path=url.pathname.replace(/\/+$/,"")||"/";
  let best:AccessSource|undefined,bestScore=-1;
  for(const candidate of sourceIndex(sources).get(hostOf(url))||[]){
    const matches=candidate.exact ? path===candidate.path : candidate.path==="/"||path===candidate.path||path.startsWith(candidate.path+"/");
    if(!matches||[...candidate.url.searchParams].some(([key,value])=>!url.searchParams.getAll(key).includes(value)))continue;
    if(candidate.source.exact){const actual=new URLSearchParams(url.search),expected=new URLSearchParams(candidate.url.search);actual.sort();expected.sort();if(actual.toString()!==expected.toString())continue;}
    // A provider-confirmed open document overrides a broad publisher classification only at its exact URL.
    const score=(candidate.source.exact?1_000_000:0)+candidate.path.length*100+candidate.url.searchParams.size;
    const restricted=["Paid","Mixed","Freemium"].includes(accessOf(candidate.source));
    if(score>bestScore||(score===bestScore&&restricted)){best=candidate.source;bestScore=score;}
  }
  return best;
}

export function classifyPageAccess(page:{url:string;sourceId?:string},sources:readonly AccessSource[]):ResourceAccess {
  return accessOf(sourceForUrl(page.url,sources));
}
export function isKnownRestrictedUrl(url:string,sources:readonly AccessSource[]):boolean {
  return ["Paid","Mixed","Freemium"].includes(classifyPageAccess({url},sources));
}

/** Detect explicit access gates, not newsletter subscriptions or ordinary sign-in navigation. */
export function detectPaywall(body:string,status=200,contentType="text/html"):string|null {
  if(status===402)return "Payment required (HTTP 402); paid content was not indexed.";
  if(status===401)return "Sign-in required (HTTP 401); restricted content was not indexed.";
  if(!/html/i.test(contentType)&&!/<html\b|<script\b|<h1\b/i.test(body))return null;
  for(const match of body.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){
    if(!/\btype\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json'|application\/ld\+json(?:\s|$))/i.test(match[1]))continue;
    try{
      const stack:unknown[]=[JSON.parse(match[2])];let examined=0;
      while(stack.length&&examined++<10000){
        const value=stack.pop();if(!value||typeof value!=="object")continue;
        const node=value as Record<string,unknown>;
        if(node.isAccessibleForFree===false||String(node.isAccessibleForFree).toLowerCase()==="false")return "Page declares paid access in structured data; it was not indexed.";
        stack.push(...Object.values(node));
      }
    }catch{/* Invalid structured data is not evidence of a paywall. */}
  }
  const text=body.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi," ").replace(/<[^>]*>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/\s+/g," ");
  if(/\b(?:subscribe|purchase a subscription|become a (?:paid )?(?:subscriber|member)|(?:sign|log)\s*in)\s+(?:now\s+)?to\s+(?:continue reading|read\s+(?:this (?:article|story|report)|the (?:full|rest of (?:this|the)) (?:article|story|report))|(?:access|unlock)\s+(?:this (?:article|story|report)|the full (?:article|story|report)))\b/i.test(text)||
    /\b(?:this (?:article|story|report|content) is (?:available |reserved )?(?:only )?for (?:paid )?(?:subscribers|members)|(?:subscriber|subscription|paid member)[ -]only (?:article|story|report|content)|you (?:must|need to) (?:be logged in|sign in|log in|subscribe) to (?:read|view|access) (?:this|the full) (?:article|story|report|content))\b/i.test(text)){
    return "Page requires a subscription or sign-in to read; it was not indexed.";
  }
  const heading=(body.match(/<(?:h1|title)\b[^>]*>([\s\S]*?)<\/(?:h1|title)>/i)?.[1]||"").replace(/<[^>]*>/g," ").trim();
  if(text.length<5000&&/^(?:sign\s*in|log\s*in|member (?:sign\s*in|log\s*in))(?:\s*[|–—:-].*)?$/i.test(heading)&&/<input\b[^>]*\btype\s*=\s*["']?password\b/i.test(body))return "Sign-in page detected; restricted content was not indexed.";
  return null;
}
