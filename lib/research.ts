/** Live document discovery plus attributable metadata from the user's captured pages. */
// @ts-expect-error Node's native TypeScript tests require the explicit extension.
import { classifyPageAccess } from "./free-access.ts";
// @ts-expect-error Node's native TypeScript tests require the explicit extension.
import { assessResource, cleanSearchQuery, queryTerms } from "./resource-quality.ts";
// @ts-expect-error Node's native TypeScript tests require the explicit extension.
import { discoverDocuments, type DiscoveryOptions, type ProviderStatus } from "./discovery.ts";
// @ts-expect-error Node's native TypeScript tests require the explicit extension.
import { saveDiscoveredDocuments, readKnownFreeDocumentSources, type StoredDiscoveredDocument } from "./discovery-store.ts";
// @ts-expect-error Node's native TypeScript tests require the explicit extension.
import { isFilingQuery } from "./filing-discovery.ts";

export interface ResearchSource {
  id:string;name:string;url:string;domain:string;category:string;type:string;access:string;
  description:string;tags:string[];geography:string;crawlMethod:string;feedUrl?:string;
  verification:string;provenanceUrl?:string|null;checkedAt?:string;exact?:boolean;
}
export interface ResearchPage {
  id:string;url:string;title:string;description:string;sourceId?:string;domain?:string;
  category?:string;tags?:string[];fetchedAt?:string;[key:string]:unknown;
}
export interface ChatMessage {role:"user"|"assistant";content:string}
export interface ResearchAnswer {
  answer:string;sources:ResearchSource[];documents:StoredDiscoveredDocument[];pages:ResearchPage[];
  providers:ProviderStatus[];searchedAt:string;suggestedQueries:string[];
  mode:"retrieval"|"ai";plan:{query:string;sourceIds:string[];urls:string[]};
}
export interface ResearchDiscovery {documents:StoredDiscoveredDocument[];providers:ProviderStatus[];searchedAt:string}

type Followup="same"|"cases"|"outcomes"|null;
function followupKind(message:string):Followup {
  const value=message.trim().replace(/[.!?]+$/,"").toLowerCase();
  if(/^(?:(?:only|just) (?:the )?free(?: (?:sources|resources|documents|papers))?|free (?:sources|resources|only)|no paywalls?|include paid|all access|paid (?:is|are) (?:fine|okay|ok)|(?:more|other|additional) (?:sources|resources|documents|papers|examples)|(?:search |try )?again|continue|same topic|keep going|find more)$/.test(value))return "same";
  if(/^(?:(?:more|only|just|show me|find) )?(?:case stud(?:y|ies)|postmortems?)$/.test(value))return "cases";
  if(/^(?:focus on |show |find |only )?(?:measured |measurable )?(?:outcomes|results|production deployments)$/.test(value))return "outcomes";
  return null;
}
function refine(query:string,kind:Followup):string {
  if(kind==="cases"&&!/case stud|postmortem/i.test(query))return `${query} case studies`.trim();
  if(kind==="outcomes"&&!/measured outcomes/i.test(query))return `${query} measured outcomes`.trim();
  return query;
}
/** A new subject replaces history. Only explicit, topic-less followups inherit the prior query. */
export function resolveResearchQuery(message:string,history:ChatMessage[]):string {
  const kind=followupKind(message);
  if(!kind)return cleanSearchQuery(message);
  let previous="";
  for(const turn of cleanHistory(history).filter(turn=>turn.role==="user")){
    const priorKind=followupKind(turn.content);
    if(priorKind){if(previous)previous=refine(previous,priorKind);}else previous=cleanSearchQuery(turn.content);
  }
  return previous?refine(previous,kind).slice(0,300):"";
}
function followupQueries(query:string):string[] {
  const base=query.slice(0,180);
  if(!base)return ["Artificial intelligence in banking","SaaS pricing and retention","Mergers and acquisitions case studies"];
  if(isFilingQuery(query))return [base.replace(/\b(?:latest|most recent|current)\b/gi,"").replace(/\s+/g," ").trim(),base.replace(/\bquarterly\b|\b10-q\b/gi,"annual")].filter((value,index,values)=>value!==base&&values.indexOf(value)===index);
  return [`${base} measured outcomes`,`${base} case studies`,`${base} risks and limitations`];
}
function markdownLabel(value:string):string {return value.replace(/[\[\]\\]/g," ").replace(/\s+/g," ").trim();}
function markdownUrl(value:string):string {return value.replace(/\(/g,"%28").replace(/\)/g,"%29");}
function providerSummary(providers:ProviderStatus[]):string {
  return providers.map(provider=>`${provider.provider}: ${provider.status==="ok"?`${provider.count} matching record${provider.count===1?"":"s"}${provider.message?`. ${provider.message}`:""}`:provider.message||"No matching documents returned."}`).join("\n");
}

/** Pure answer composition. Catalog entries establish access only; homepages are never fallback evidence. */
export function researchAnswer(message:string,history:ChatMessage[],sources:ResearchSource[],pages:ResearchPage[]=[],discovery?:ResearchDiscovery):ResearchAnswer {
  const query=resolveResearchQuery(message,history),searchedAt=discovery?.searchedAt||new Date().toISOString(),hasTopic=queryTerms(query).length>0;
  const filingQuery=isFilingQuery(query);
  const documents=(discovery?.documents||[]).filter(document=>hasTopic&&document.access==="Free"&&!!document.accessBasis&&
    // SEC already validated explicit company, form and requested period. Do not require
    // words such as "earnings" or "latest" in factual filing metadata.
    assessResource(document,filingQuery&&document.provider==="SEC EDGAR"?"":query).eligible&&(!filingQuery||document.provider==="SEC EDGAR"));
  const documentUrls=new Set(documents.map(document=>document.url));
  const distinctPages=[...new Map(pages.map(page=>[page.url,page])).values()];
  const selectedPages=distinctPages.filter(page=>hasTopic&&!filingQuery&&!documentUrls.has(page.url)&&classifyPageAccess(page,sources)==="Free").map(page=>({page,quality:assessResource(page,query)})).filter(item=>item.quality.eligible).sort((a,b)=>b.quality.score-a.quality.score).slice(0,5).map(item=>item.page);
  const providers=discovery?.providers||[],failures=providers.filter(provider=>!["ok","empty"].includes(provider.status));
  let intro:string;
  if(!hasTopic)intro="Enter a specific topic, company or research question to search for free documents.";
  else if(documents.length)intro=`I found ${documents.length} free document${documents.length===1?"":"s"} for “${query}” in the live search${selectedPages.length?`, plus ${selectedPages.length} relevant captured page${selectedPages.length===1?"":"s"}`:""}.`;
  else if(providers.length&&failures.length===providers.length)intro=`Live document search is currently unavailable for “${query}”.${selectedPages.length?` Your library has ${selectedPages.length} relevant captured page${selectedPages.length===1?"":"s"} below.`:""}`;
  else if(discovery)intro=`No matching free documents were returned for “${query}”.${selectedPages.length?` Your library has ${selectedPages.length} relevant captured page${selectedPages.length===1?"":"s"} below.`:" Try a more specific company, industry or question."}`;
  else intro=`No live document search has been performed for “${query}”.${selectedPages.length?` Your library has ${selectedPages.length} relevant captured page${selectedPages.length===1?"":"s"} below.`:""}`;
  const notes=documents.slice(0,6).map(document=>`• [${markdownLabel(document.title)}](${markdownUrl(document.url)}) — ${document.provider}${document.publishedAt?`, ${document.publishedAt}`:""}.${document.description?` Provider summary: ${document.description.slice(0,420)}`:" The provider supplied a title but no abstract."}`).join("\n");
  const captured=selectedPages.map(page=>`• [${markdownLabel(page.title)}](${markdownUrl(page.url)})${page.description?` — Captured summary: ${page.description.slice(0,350)}`:" — Captured title only; no summary is available."}`).join("\n");
  const evidenceNote=documents.length||selectedPages.length?"These matches use provider abstracts, filing records and captured page metadata. I have not read or analyzed the full documents. Free-access labels are attributed to the providers; destination availability can change.":"";
  const status=providers.length?`Search status:\n${providerSummary(providers)}`:"";
  return {answer:[intro,notes,captured?`Previously captured pages:\n${captured}`:"",evidenceNote,status].filter(Boolean).join("\n\n"),
    sources:[],documents,pages:selectedPages,providers,searchedAt,mode:"retrieval",suggestedQueries:followupQueries(query),
    plan:{query,sourceIds:documents.map(document=>document.id),urls:[...new Set([...documents.map(document=>document.url),...selectedPages.map(page=>page.url)])]}};
}

type ChatRow={id:string;role:"user"|"assistant";content:string;metadata:string;created_at:string};
export async function readChat(db:D1Database,user:string) {
  const rows=await db.prepare("SELECT id,role,content,metadata,created_at FROM atlas_chat WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 80").bind(user).all<ChatRow>();
  return {messages:rows.results.reverse().map(row=>{
    let metadata:Record<string,unknown>={};try{metadata=JSON.parse(row.metadata);}catch{}
    return {...metadata,id:row.id,role:row.role,content:row.content,createdAt:row.created_at} as Partial<ResearchAnswer>&{id:string;role:"user"|"assistant";content:string;createdAt:string};
  })};
}
export function cleanHistory(input:unknown):ChatMessage[] {
  if(!Array.isArray(input))return [];
  return input.filter((m):m is ChatMessage=>!!m&&typeof m==="object"&&(m.role==="user"||m.role==="assistant")&&typeof m.content==="string").slice(-12).map(m=>({role:m.role,content:m.content.slice(0,3000)}));
}
export async function retrieveForUser(db:D1Database,user:string,message:string,history:ChatMessage[],catalog:ResearchSource[],options:DiscoveryOptions={}):Promise<ResearchAnswer> {
  const query=resolveResearchQuery(message,history);
  const [discovery,indexed,knownDocuments]=await Promise.all([
    discoverDocuments(query,options),
    db.prepare("SELECT id,url,title,description,source_id,domain,category,tags,fetched_at FROM atlas_pages WHERE user_id=? ORDER BY fetched_at DESC LIMIT 2000").bind(user).all<{id:string;url:string;title:string;description:string;source_id:string;domain:string;category:string;tags:string;fetched_at:string}>(),
    readKnownFreeDocumentSources(db,user),
  ]);
  const documents=discovery.documents.length?await saveDiscoveredDocuments(db,user,query,discovery.documents):[];
  const pages:ResearchPage[]=indexed.results.map(page=>{
    let tags:string[]=[];try{const parsed=JSON.parse(page.tags||"[]");if(Array.isArray(parsed))tags=parsed.filter(tag=>typeof tag==="string");}catch{}
    return {id:page.id,url:page.url,title:page.title,description:page.description,sourceId:page.source_id,domain:page.domain,category:page.category,tags,fetchedAt:page.fetched_at};
  });
  return researchAnswer(message,history,[...catalog,...knownDocuments,...documents.map(document=>({...document,exact:true}))],pages,{documents,providers:discovery.providers,searchedAt:discovery.searchedAt});
}
export async function saveChat(db:D1Database,user:string,message:string,result:ResearchAnswer) {
  const timestamp=Date.now(),{answer,...metadata}=result;
  const stmt=(role:string,content:string,meta:string,time:number)=>db.prepare("INSERT INTO atlas_chat(id,user_id,role,content,metadata,created_at) VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(),user,role,content,meta,new Date(time).toISOString());
  await db.batch([stmt("user",message,"{}",timestamp),stmt("assistant",answer,JSON.stringify(metadata),timestamp+1)]);
}
