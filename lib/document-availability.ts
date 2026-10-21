/** A bounded public-response check, not a claim that the full document was read. */
// @ts-expect-error Node's native TypeScript tests require the explicit extension.
import { assessResource } from "./resource-quality.ts";
// @ts-expect-error Node's native TypeScript tests require the explicit extension.
import { detectPaywall } from "./free-access.ts";

export interface AvailabilityOptions {fetcher?:typeof fetch;timeoutMs?:number}
export interface AvailableDocument {url:string;kind:"pdf"|"html"}
const MAX_HTML_BYTES=128*1024;
const USER_AGENT="SignalResearch/1.0 (+https://signal-research-crawler.sk1616.chatgpt.site/; public document availability check)";
const defaultFetcher:typeof fetch=(input,init)=>globalThis.fetch(input,init);

function publicUrl(address:string,base?:string):string|null {
  if(typeof address!=="string"||address.length>2400)return null;
  try{
    const url=new URL(address,base),host=url.hostname.toLowerCase().replace(/\.$/,"");
    if(url.protocol!=="https:"||url.username||url.password||(url.port&&url.port!=="443")||!host.includes(".")||host.includes(":")||/^[\d.]+$/.test(host)||!/^[a-z0-9.-]+$/.test(host)||
      /(^|\.)(?:localhost|local|internal|home|lan|corp|test|invalid|example|onion|localtest\.me|nip\.io|sslip\.io|lvh\.me)$/.test(host)||host==="metadata.google.internal")return null;
    url.hostname=host;url.hash="";
    return url.href;
  }catch{return null;}
}
function text(html:string):string {
  return html.replace(/<!--[^]*?-->/g," ").replace(/<(script|style|noscript|template)\b[^>]*>[^]*?<\/\1\s*>/gi," ").replace(/<[^>]*>/g," ")
    .replace(/&#(x[\da-f]+|\d+);/gi,(_match,value:string)=>{const code=value[0].toLowerCase()==="x"?parseInt(value.slice(1),16):Number(value);return code>0&&code<=0x10ffff?String.fromCodePoint(code):" ";})
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi,(_match,name:string)=>({amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:" "}[name.toLowerCase()]||" "))
    .replace(/\s+/g," ").trim();
}
function readableHtml(html:string,url:string):boolean {
  if(detectPaywall(html,200,"text/html"))return false;
  const visible=text(html),title=text(html.match(/<h1\b[^>]*>([^]*?)<\/h1\s*>/i)?.[1]||html.match(/<title\b[^>]*>([^]*?)<\/title\s*>/i)?.[1]||"");
  if(/\b(?:purchase (?:this (?:article|document)|access|pdf)|rent this article|access through (?:your|an?) institution|full (?:text|article) (?:is )?(?:available )?(?:to subscribers|behind a paywall))\b/i.test(visible))return false;
  // Check all visible text in overlapping windows so a gate after a long header is caught.
  for(let offset=0;offset<visible.length;offset+=7000){
    const reason=assessResource({url,title,description:visible.slice(offset,offset+8000)}).reason;
    if(reason==="access-gate"||reason==="error"||reason==="navigation")return false;
  }
  if(!title||/\/(?:abs|abstract|abstracts)(?:\/|$)/i.test(new URL(url).pathname))return false;
  const withoutChrome=html.replace(/<(script|style|noscript|template|nav|header|footer|aside)\b[^>]*>[^]*?<\/\1\s*>/gi," ");
  const region=withoutChrome.match(/<(article|main)\b[^>]*>([^]*?)(?:<\/\1\s*>|$)/i)?.[2]||
    withoutChrome.match(/<(?:div|section)\b[^>]*(?:id|class)\s*=\s*["'][^"']*\b(?:article[-_ ]body|full[-_ ]?text|body[-_ ]content)\b[^"']*["'][^>]*>([^]*)/i)?.[1];
  if(!region)return false;
  const headings=[...region.matchAll(/<h[2-6]\b[^>]*>([^]*?)<\/h[2-6]\s*>/gi)].map(match=>text(match[1]));
  const hasAbstract=headings.some(heading=>/^abstract\b/i.test(heading));
  const hasBodyHeading=headings.some(heading=>/\b(?:introduction|background|methods?|methodology|results|discussion|conclusions?|findings|limitations|analysis|case study)\b/i.test(heading));
  if(hasAbstract&&!hasBodyHeading)return false;
  const paragraphs=[...region.matchAll(/<p\b[^>]*>([^]*?)<\/p\s*>/gi)].map(match=>text(match[1])).filter(paragraph=>paragraph.length>=100&&paragraph.split(/\s+/).length>=20);
  const body=paragraphs.join(" ");
  if(paragraphs.length<3||body.length<800||body.split(/\s+/).length<120)return false;
  return assessResource({url,title,description:paragraphs[0]}).eligible;
}

/** No cookies/authentication, HTTP upgrades, or broad publisher access inference. */
export async function checkDocumentAvailability(address:string,options:AvailabilityOptions={}):Promise<AvailableDocument|null> {
  const initial=publicUrl(address);if(!initial)return null;
  const timeoutMs=Number.isFinite(options.timeoutMs)?Math.min(3000,Number(options.timeoutMs)):3000;
  if(timeoutMs<=0)return null;
  const controller=new AbortController(),deadline=Date.now()+timeoutMs,fetcher=options.fetcher||defaultFetcher;
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,body:ReadableStream<Uint8Array>|null=null,timer:ReturnType<typeof setTimeout>|undefined;
  const cancel=()=>{try{void (reader?reader.cancel():body?.cancel())?.catch(()=>{});}catch{/* Cancellation must not turn a failed check into an error. */}};
  const expired=()=>controller.signal.aborted||Date.now()>=deadline;
  const run=async():Promise<AvailableDocument|null>=>{
    let current=initial;
    const seen=new Set<string>();
    for(let redirects=0;redirects<=3;redirects++){
      if(expired()||seen.has(current))return null;seen.add(current);
      const response=await fetcher(current,{redirect:"manual",credentials:"omit",referrerPolicy:"no-referrer",signal:controller.signal,headers:{Accept:"application/pdf,text/html,application/xhtml+xml;q=0.9","User-Agent":USER_AGENT}});
      body=response.body;if(expired()){cancel();return null;}
      if([301,302,303,307,308].includes(response.status)){
        const location=response.headers.get("location"),next=location?publicUrl(location,current):null;cancel();body=null;
        if(!next||redirects===3)return null;current=next;continue;
      }
      if(response.status!==200||!body)return null;
      const contentType=(response.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();
      const pdf=contentType==="application/pdf"||contentType==="application/octet-stream";
      if(!pdf&&contentType!=="text/html"&&contentType!=="application/xhtml+xml")return null;
      reader=body.getReader();
      if(pdf){
        const magic=[37,80,68,70,45];let offset=0;
        while(offset<magic.length&&!expired()){
          const chunk=await reader.read();if(expired()||chunk.done)return null;
          for(const byte of chunk.value){if(byte!==magic[offset++])return null;if(offset===magic.length){cancel();return {url:current,kind:"pdf"};}}
        }
        return null;
      }
      const decoder=new TextDecoder();let bytes=0,html="";
      while(bytes<MAX_HTML_BYTES&&!expired()){
        const chunk=await reader.read();if(expired())return null;if(chunk.done)break;
        const accepted=chunk.value.subarray(0,MAX_HTML_BYTES-bytes);bytes+=accepted.length;html+=decoder.decode(accepted,{stream:true});
      }
      cancel();html+=decoder.decode();
      return !expired()&&readableHtml(html,current)?{url:current,kind:"html"}:null;
    }
    return null;
  };
  try{
    const timeout=new Promise<null>(resolve=>{timer=setTimeout(()=>{controller.abort();cancel();resolve(null);},timeoutMs);});
    return await Promise.race([run().catch(()=>null),timeout]);
  }finally{
    if(timer)clearTimeout(timer);controller.abort();cancel();
    try{reader?.releaseLock();}catch{/* An aborted pending read may still hold the stream lock. */}
  }
}
