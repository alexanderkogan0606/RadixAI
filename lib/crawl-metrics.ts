/** Dashboard statistics from captured titles/descriptions and actual crawl records only. */
// @ts-expect-error Node's native TypeScript tests require the explicit extension.
import {queryTerms} from "./resource-quality.ts";

export interface CrawlMetricPage {id?:string;url:string;title?:string;name?:string;description?:string;fetchedAt?:string}
export interface CrawlMetricFrontier {url:string;status:string}
export interface CrawlMetricEvent {id?:string;time:string;message:string;url?:string|null;level?:string}
export interface CrawlMetricJob {status?:string;createdAt?:string;updatedAt?:string}
export interface CrawlMetricsInput {
  pages?:readonly CrawlMetricPage[];frontier?:readonly CrawlMetricFrontier[];events?:readonly CrawlMetricEvent[];
  edges?:readonly {source:string;target:string}[];query?:string;job?:CrawlMetricJob|null;now?:number|string;replay?:boolean;
}
export interface CrawlWebsiteMetric {hostname:string;discovered:number;checked:number;queued:number;processing:number;failed:number;percent:number}
const supplementalStop=new Set("home welcome contact privacy cookies cookie terms rights reserved copyright login signin signup account subscribe subscription navigation menu next previous click download website site public metadata summary abstract description read analyzed captured fetched independently source available unavailable filed period ended accession document title http https www org com pdf html doi license version".split(" "));
const limits={pages:300,frontier:5000,events:1000,edges:10000};
const time=(value:unknown):number|null=>{const result=typeof value==="number"?value:typeof value==="string"&&value?Date.parse(value):NaN;return Number.isFinite(result)?result:null;};
const clean=(value:unknown):string=>typeof value==="string"?value.slice(0,16000).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi," ").replace(/<[^>]*>/g," ").replace(/&amp;|&#38;/gi,"&").replace(/&nbsp;|&#160;/gi," ").replace(/\s+/g," ").trim():"";
function address(value:string):{url:string;hostname:string}|null {try{const url=new URL(value);if(!/^https?:$/.test(url.protocol))return null;url.hash="";return {url:url.href,hostname:url.hostname.toLowerCase().replace(/^www\./,"").replace(/\.$/,"")};}catch{return null;}}
function metadataWords(value:string):string[]{
  // Keep phrase synonyms intact before asking the shared normalizer about each word.
  // Per-word normalization avoids queryTerms' 20-distinct-term cap on long summaries.
  const normalized=value.normalize("NFKC").toLowerCase().replace(/[’']s\b/g,"").replace(/\bdeep[\s-]?dive\b/g," ")
    .replace(/\bm\s*(?:&|and)\s*a\b/g," merger ").replace(/\bartificial intelligence\b|\bmachine learning\b/g," ai ")
    .replace(/\b(customer|user|talent|traffic|data) acquisitions?\b/g,"$1acquisition");
  return normalized.match(/[\p{L}\p{N}]+/gu)||[];
}

/** Pure and deterministic: the caller supplies the clock and replay-filtered arrays. */
export function computeCrawlMetrics(input:CrawlMetricsInput={}) {
  const pages=input.pages||[],frontier=input.frontier||[],events=input.events||[],edges=input.edges||[];
  const wanted=queryTerms(input.query||""),canonical=new Map<string,string|undefined>();
  const normalize=(word:string)=>{if(!canonical.has(word))canonical.set(word,queryTerms(word)[0]);return canonical.get(word);};
  const analyzed=pages.slice(-limits.pages).map((page,index)=>{
    const title=clean(page.title||page.name),description=clean(page.description),metadata=`${title} ${description}`.trim();
    const terms=new Set(metadataWords(metadata).map(normalize).filter((term):term is string=>!!term));
    const score=wanted.length?wanted.filter(term=>terms.has(term)).length/wanted.length*100:null;
    return {id:page.id||`${page.url}#${index}`,url:page.url,title,fetchedAt:page.fetchedAt||null,time:time(page.fetchedAt),index,
      wordCount:(metadata.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)||[]).length,terms,metadataMatch:score};
  }).sort((a,b)=>(a.time??Infinity)-(b.time??Infinity)||a.index-b.index);
  const metadataWordCount=analyzed.reduce((sum,page)=>sum+page.wordCount,0);
  const counts=new Map<string,number>();
  for(const page of analyzed)for(const term of page.terms)counts.set(term,(counts.get(term)||0)+1);
  const supplemental=[...counts].filter(([term])=>!wanted.includes(term)&&!supplementalStop.has(term)&&!/^\d+$/.test(term)&&(term.length>=3||term==="ai"))
    .sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([term])=>term);
  const terms=[...wanted,...supplemental].slice(0,6),lastPages=analyzed.slice(-12);
  const termRows=terms.map(term=>({term,origin:wanted.includes(term)?"query" as const:"metadata" as const,
    documentsWithTerm:counts.get(term)||0,sharePercent:analyzed.length?(counts.get(term)||0)/analyzed.length*100:0,
    hits:lastPages.map(page=>page.terms.has(term)?1:0)}));
  const columns=lastPages.map(({terms:_terms,time:_time,index:_index,...page})=>page);
  const metadataMatch=analyzed.length&&wanted.length?analyzed.reduce((sum,page)=>sum+(page.metadataMatch||0),0)/analyzed.length:null;
  const matchHistory=wanted.length?analyzed.map(page=>({id:page.id,url:page.url,time:page.fetchedAt,score:page.metadataMatch!})):[];

  const consideredEvents=events.slice(0,limits.events);
  // Completion marks every leftover queued URL "skipped", even if it was never attempted.
  // A skipped URL therefore needs its own failure or HTTP response evidence to count as checked.
  const attemptedSkippedUrls=new Set(consideredEvents.flatMap(event=>{
    if(!event.url)return [];
    const verifiedOutcome=["blocked","skipped","error"].includes(event.level||"")||/^HTTP [1-5]\d{2}\s*·\s*\d+(?:\.\d+)? ms\b/.test(event.message);
    const normalized=verifiedOutcome?address(event.url):null;
    return normalized?[normalized.url]:[];
  }));
  const terminal=new Set(["done","error","skipped","blocked"]),byUrl=new Map<string,{hostname:string;status:string}>();
  const priority=(status:string)=>status==="done"?4:terminal.has(status)?3:status==="processing"?2:status==="queued"?1:0;
  for(const item of frontier.slice(0,limits.frontier)){
    const normalized=address(item.url);if(!normalized)continue;
    const previous=byUrl.get(normalized.url);
    if(!previous||priority(item.status)>priority(previous.status))byUrl.set(normalized.url,{hostname:normalized.hostname,status:item.status});
  }
  const byHost=new Map<string,CrawlWebsiteMetric>();
  for(const [url,item] of byUrl){
    const host=byHost.get(item.hostname)||{hostname:item.hostname,discovered:0,checked:0,queued:0,processing:0,failed:0,percent:0};
    const checked=terminal.has(item.status)&&(item.status!=="skipped"||attemptedSkippedUrls.has(url));
    host.discovered++;if(checked)host.checked++;
    if(item.status==="queued")host.queued++;if(item.status==="processing")host.processing++;
    if(checked&&["error","skipped","blocked"].includes(item.status))host.failed++;
    byHost.set(item.hostname,host);
  }
  const websites=[...byHost.values()].map(host=>({...host,percent:host.checked/host.discovered*100}))
    .sort((a,b)=>b.discovered-a.discovered||a.hostname.localeCompare(b.hostname)).slice(0,6);
  const fetchSamples=consideredEvents.flatMap((event,index)=>{
    const match=event.message.match(/^HTTP (\d{3})\s*·\s*(\d+(?:\.\d+)?) ms\b/),at=time(event.time);
    if(!match||at===null)return [];
    const status=Number(match[1]),durationMs=Number(match[2]);
    return status>=100&&status<=599&&Number.isFinite(durationMs)?[{id:event.id||`event-${index}`,url:event.url||null,time:event.time,status,durationMs,at,index}]:[];
  }).sort((a,b)=>a.at-b.at||a.index-b.index).slice(-24).map(({at:_at,index:_index,...sample})=>sample);
  const start=time(input.job?.createdAt),updated=time(input.job?.updatedAt);
  const recordedTimes=[...analyzed.map(page=>page.time),...consideredEvents.map(event=>time(event.time))].filter((at):at is number=>at!==null);
  const end=input.replay?(recordedTimes.length?Math.max(...recordedTimes):start):input.job?.status==="running"?(time(input.now)??updated):(updated??time(input.now));
  const elapsedMs=start!==null&&end!==null?Math.max(0,end-start):null;
  const metadataWordsPerMinute=elapsedMs!==null&&elapsedMs>0?metadataWordCount/(elapsedMs/60000):null;
  const edgeCount=new Set(edges.slice(0,limits.edges).flatMap(edge=>{const source=address(edge.source),target=address(edge.target);return source&&target?[`${source.url}\n${target.url}`]:[];})).size;
  return {elapsedMs,metadataWordCount,metadataWordsPerMinute,pagesAnalyzed:analyzed.length,totalDiscovered:byUrl.size,websiteCount:byHost.size,websites,
    queryTerms:wanted,columns,termRows,metadataMatch,matchHistory,fetchSamples,
    averageFetchMs:fetchSamples.length?fetchSamples.reduce((sum,sample)=>sum+sample.durationMs,0)/fetchSamples.length:null,
    latestFetchMs:fetchSamples.at(-1)?.durationMs??null,edgeCount,
    limited:pages.length>limits.pages||frontier.length>limits.frontier||events.length>limits.events||edges.length>limits.edges};
}
