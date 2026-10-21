/** Live document discovery plus attributable metadata from the user's captured pages. */
// @ts-expect-error Node's native TypeScript tests require the explicit extension.
import { classifyPageAccess } from "./free-access.ts";
// @ts-expect-error Node's native TypeScript tests require the explicit extension.
import { assessResource, cleanSearchQuery, queryTerms } from "./resource-quality.ts";
// @ts-expect-error Node's native TypeScript tests require the explicit extension.
import { discoverDocuments, matchesDiscoverySubject, type DiscoveryOptions, type DiscoveryResult, type ProviderStatus } from "./discovery.ts";
// @ts-expect-error Node's native TypeScript tests require the explicit extension.
import { saveDiscoveredDocuments, readKnownFreeDocumentSources, type StoredDiscoveredDocument } from "./discovery-store.ts";
// @ts-expect-error Node's native TypeScript tests require the explicit extension.
import { documentIdentityKeys } from "./document-identity.ts";
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
export interface ResearchSearch extends NonNullable<DiscoveryResult['search']> {
  chainId:string;parentMessageId?:string;newDocumentsCount:number;totalDocuments:number;canContinue:boolean;
  newCount:number;totalCount:number;continuedBy?:string;
}
export interface ResearchAnswer {
  answer:string;sources:ResearchSource[];documents:StoredDiscoveredDocument[];pages:ResearchPage[];
  providers:ProviderStatus[];searchedAt:string;suggestedQueries:string[];
  mode:"retrieval"|"ai";plan:{query:string;sourceIds:string[];urls:string[]};
  search?:ResearchSearch;
}
export interface ResearchDiscovery {documents:StoredDiscoveredDocument[];providers:ProviderStatus[];searchedAt:string;search?:ResearchSearch;newDocumentIds?:string[]}

type Followup="same"|"cases"|"outcomes"|null;
function followupKind(message:string):Followup {
  const value=message.trim().replace(/[.!?]+$/,"").toLowerCase();
  if(/^(?:(?:only|just) (?:the )?free(?: (?:sources|resources|documents|papers))?|free (?:sources|resources|only)|no paywalls?|include paid|all access|paid (?:is|are) (?:fine|okay|ok)|(?:more|other|additional) (?:sources|resources|documents|papers|examples)|(?:search |try )?again|continue|same topic|keep going|find(?: me)? more(?: (?:sources|resources|documents|papers|examples))?)$/.test(value))return "same";
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
    assessResource(document,filingQuery&&document.provider==="SEC EDGAR"?"":query).eligible&&(filingQuery?document.provider==="SEC EDGAR":matchesDiscoverySubject(document,query)));
  const documentUrls=new Set(documents.map(document=>document.url));
  const distinctPages=[...new Map(pages.map(page=>[page.url,page])).values()];
  const selectedPages=distinctPages.filter(page=>hasTopic&&!filingQuery&&!documentUrls.has(page.url)&&classifyPageAccess(page,sources)==="Free").map(page=>({page,quality:assessResource(page,query)})).filter(item=>item.quality.eligible).sort((a,b)=>b.quality.score-a.quality.score).slice(0,5).map(item=>item.page);
  const providers=discovery?.providers||[],failures=providers.filter(provider=>!["ok","empty"].includes(provider.status));
  const newIds=new Set(discovery?.newDocumentIds||documents.map(document=>document.id));
  const newCount=documents.filter(document=>newIds.has(document.id)).length;
  const search=discovery?.search?{...discovery.search,newDocumentsCount:newCount,totalDocuments:documents.length,newCount,totalCount:documents.length,canContinue:discovery.search.nextBatch!==null}:undefined;
  let intro:string;
  if(!hasTopic)intro="Enter a specific topic, company or research question to search for free documents.";
  else if(documents.length&&search)intro=`I found ${newCount} new free document${newCount===1?"":"s"} in this batch; ${documents.length} collected for “${query}”${selectedPages.length?`, plus ${selectedPages.length} relevant captured page${selectedPages.length===1?"":"s"}`:""}.`;
  else if(documents.length)intro=`I found ${documents.length} free document${documents.length===1?"":"s"} for “${query}” in the live search${selectedPages.length?`, plus ${selectedPages.length} relevant captured page${selectedPages.length===1?"":"s"}`:""}.`;
  else if(providers.length&&failures.length===providers.length)intro=`Live document search is currently unavailable for “${query}”.${selectedPages.length?` Your library has ${selectedPages.length} relevant captured page${selectedPages.length===1?"":"s"} below.`:""}`;
  else if(discovery)intro=`No matching free documents were returned for “${query}”.${selectedPages.length?` Your library has ${selectedPages.length} relevant captured page${selectedPages.length===1?"":"s"} below.`:" Try a more specific company, industry or question."}`;
  else intro=`No live document search has been performed for “${query}”.${selectedPages.length?` Your library has ${selectedPages.length} relevant captured page${selectedPages.length===1?"":"s"} below.`:""}`;
  const notes=documents.slice(0,6).map(document=>`• [${markdownLabel(document.title)}](${markdownUrl(document.url)}) — ${document.provider}${document.publishedAt?`, ${document.publishedAt}`:""}.${document.description?` Provider summary: ${document.description.slice(0,420)}`:" The provider supplied a title but no abstract."}`).join("\n");
  const captured=selectedPages.map(page=>`• [${markdownLabel(page.title)}](${markdownUrl(page.url)})${page.description?` — Captured summary: ${page.description.slice(0,350)}`:" — Captured title only; no summary is available."}`).join("\n");
  const evidenceNote=documents.length||selectedPages.length?"These matches use provider abstracts, filing records and captured page metadata. I have not read or analyzed the full documents. Free-access labels are attributed to the providers; destination availability can change.":"";
  const status=providers.length?`Search status:\n${providerSummary(providers)}`:"";
  return {answer:[intro,notes,captured?`Previously captured pages:\n${captured}`:"",evidenceNote,status].filter(Boolean).join("\n\n"),
    sources:[],documents,pages:selectedPages,providers,searchedAt,mode:"retrieval",suggestedQueries:followupQueries(query),...(search?{search}:{}),
    plan:{query,sourceIds:documents.map(document=>document.id),urls:[...new Set([...documents.map(document=>document.url),...selectedPages.map(page=>page.url)])]}};
}

type ChatRow={id:string;role:"user"|"assistant";content:string;metadata:string;created_at:string};
function metadataOf(row:ChatRow):Record<string,any>{try{const value=JSON.parse(row.metadata);return value&&typeof value==="object"&&!Array.isArray(value)?value:{};}catch{return {};}}
const stringIds=(value:unknown):string[]=>Array.isArray(value)?value.filter((id):id is string=>typeof id==="string"):[];
function ownedDocument(source:Awaited<ReturnType<typeof readKnownFreeDocumentSources>>[number]):StoredDiscoveredDocument {
  const {exact:_exact,aliasOf:_aliasOf,...document}=source;return document;
}
export async function readChat(db:D1Database,user:string) {
  const rows=await db.prepare("SELECT id,role,content,metadata,created_at FROM atlas_chat WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 80").bind(user).all<ChatRow>();
  const messages=rows.results.reverse().map(row=>({row,metadata:metadataOf(row)})),latestByChain=new Map<string,string>();
  for(const {row,metadata} of messages)if(row.role==="assistant"&&typeof metadata.search?.chainId==="string")latestByChain.set(metadata.search.chainId,row.id);
  const needsDocuments=messages.some(({metadata})=>Array.isArray(metadata.documentIds));
  const sources=needsDocuments?await readKnownFreeDocumentSources(db,user):[];
  const documentsById=new Map(sources.filter(source=>!source.aliasOf).map(source=>[source.id,ownedDocument(source)]));
  return {messages:messages.map(({row,metadata})=>{
    const {documentIds:_ids,newDocumentIds:_newIds,...publicMetadata}=metadata;
    let content=row.content;
    const latestId=typeof metadata.search?.chainId==="string"?latestByChain.get(metadata.search.chainId):undefined;
    const supersededBy=latestId&&latestId!==row.id?latestId:undefined;
    if(Array.isArray(metadata.documentIds)){
      const query=String(metadata.plan?.query||""),filing=isFilingQuery(query);
      const hydrated=stringIds(metadata.documentIds).flatMap(id=>documentsById.has(id)?[documentsById.get(id)!]:[]);
      const documents=supersededBy?[]:distinctDocuments(hydrated).filter(document=>assessResource(document,filing&&document.provider==="SEC EDGAR"?"":query).eligible&&(filing?document.provider==="SEC EDGAR":matchesDiscoverySubject(document,query)));
      publicMetadata.documents=documents;
      // Cumulative URLs are reconstructed from owned documents rather than repeated in every chat row.
      const captured=Array.isArray(metadata.pages)?metadata.pages as ResearchPage[]:[];
      publicMetadata.plan={...metadata.plan,sourceIds:documents.map(document=>document.id),urls:supersededBy?[]:[...new Set([...documents.map(document=>document.url),...captured.map(page=>page.url)])]};
      if(!supersededBy&&metadata.search){
        const newIds=Array.isArray(metadata.newDocumentIds)?stringIds(metadata.newDocumentIds):hydrated.slice(0,metadata.search.newDocumentsCount||0).map(document=>document.id);
        const newCount=documents.filter(document=>newIds.includes(document.id)).length;
        publicMetadata.search={...metadata.search,newDocumentsCount:newCount,newCount,totalDocuments:documents.length,totalCount:documents.length};
        if(newCount!==metadata.search.newDocumentsCount||documents.length!==metadata.search.totalDocuments){
          content=researchAnswer(query,[],sources,captured,{documents,providers:metadata.providers||[],searchedAt:metadata.searchedAt||row.created_at,search:publicMetadata.search,newDocumentIds:newIds}).answer;
        }
      }
    }
    if(publicMetadata.search){
      const {continuationClaim:_claim,continuationClaimedUntil:_until,...search}=publicMetadata.search;
      const expiredClaim=Boolean(_claim)&&!(typeof _until==="number"&&_until>Date.now())&&!search.continuedBy&&search.nextBatch!==null;
      publicMetadata.search={...search,...(expiredClaim?{canContinue:true}:{}),...(supersededBy?{canContinue:false}:{})};
    }
    return {...publicMetadata,...(supersededBy?{supersededBy}:{}),id:row.id,role:row.role,content,createdAt:row.created_at} as Partial<ResearchAnswer>&{id:string;role:"user"|"assistant";content:string;createdAt:string;supersededBy?:string};
  })};
}
export function cleanHistory(input:unknown):ChatMessage[] {
  if(!Array.isArray(input))return [];
  return input.filter((m):m is ChatMessage=>!!m&&typeof m==="object"&&(m.role==="user"||m.role==="assistant")&&typeof m.content==="string").slice(-12).map(m=>({role:m.role,content:m.content.slice(0,3000)}));
}
interface ResearchContinuation {query:string;batch:number;chainId:string;parentMessageId:string;documentIds:string[]}
const documentKeys=documentIdentityKeys;
function distinctDocuments<T extends {url:string;doi?:string}>(documents:readonly T[]):T[]{
  const seen=new Set<string>();return documents.filter(document=>{const keys=documentKeys(document);if(keys.some(key=>seen.has(key)))return false;keys.forEach(key=>seen.add(key));return true;});
}
const sameQuery=(left:string,right:string)=>cleanSearchQuery(left).toLowerCase().replace(/\s+/g," ")===cleanSearchQuery(right).toLowerCase().replace(/\s+/g," ");
export async function retrieveForUser(db:D1Database,user:string,message:string,history:ChatMessage[],catalog:ResearchSource[],options:DiscoveryOptions={},continuation?:ResearchContinuation):Promise<ResearchAnswer> {
  const query=continuation?.query||resolveResearchQuery(message,history);
  const chainId=continuation?.chainId||crypto.randomUUID();
  const [indexed,knownDocuments]=await Promise.all([
    db.prepare("SELECT id,url,title,description,source_id,domain,category,tags,fetched_at FROM atlas_pages WHERE user_id=? ORDER BY fetched_at DESC LIMIT 2000").bind(user).all<{id:string;url:string;title:string;description:string;source_id:string;domain:string;category:string;tags:string;fetched_at:string}>(),
    readKnownFreeDocumentSources(db,user),
  ]);
  const priorIds=new Set(continuation?.documentIds||[]);
  const priorSources=continuation?knownDocuments.filter(source=>priorIds.has(source.aliasOf||source.id)||[source.query,...source.queryHistory].some(value=>sameQuery(value,query))):[];
  const previous=distinctDocuments(priorSources.filter(source=>!source.aliasOf).map(ownedDocument));
  const previousKeys=new Set(previous.flatMap(documentKeys));
  const discovery=await discoverDocuments(query,{...options,continuationKey:chainId,...(continuation?{
    batch:continuation.batch,excludeUrls:[...new Set([...(options.excludeUrls||[]),...priorSources.flatMap(source=>[source.url,...(source.fullTextUrl?[source.fullTextUrl]:[])])])],
    excludeDois:[...new Set([...(options.excludeDois||[]),...previous.flatMap(document=>document.doi?[document.doi]:[])])],
  }:{})});
  const candidates=distinctDocuments(discovery.documents).filter(document=>!continuation||!documentKeys(document).some(key=>previousKeys.has(key)));
  const saved=candidates.length?await saveDiscoveredDocuments(db,user,query,candidates):[];
  const documents=distinctDocuments([...saved,...previous]);
  const pages:ResearchPage[]=indexed.results.map(page=>{
    let tags:string[]=[];try{const parsed=JSON.parse(page.tags||"[]");if(Array.isArray(parsed))tags=parsed.filter(tag=>typeof tag==="string");}catch{}
    return {id:page.id,url:page.url,title:page.title,description:page.description,sourceId:page.source_id,domain:page.domain,category:page.category,tags,fetchedAt:page.fetched_at};
  });
  const providerSearch=discovery.search||{batch:continuation?.batch||options.batch||0,nextBatch:null,candidatesChecked:discovery.documents.length,queryVariants:query?[query]:[]};
  const search:ResearchSearch={...providerSearch,chainId,...(continuation?{parentMessageId:continuation.parentMessageId}:{}),newDocumentsCount:saved.length,totalDocuments:documents.length,newCount:saved.length,totalCount:documents.length,canContinue:providerSearch.nextBatch!==null};
  return researchAnswer(query,[],[...catalog,...knownDocuments,...documents.map(document=>({...document,exact:true}))],pages,{documents,providers:discovery.providers,searchedAt:discovery.searchedAt,search,newDocumentIds:saved.map(document=>document.id)});
}
export class ResearchRequestError extends Error {status:number;constructor(message:string,status=400){super(message);this.name="ResearchRequestError";this.status=status;}}
type ContinuationClaim={parentId:string;token:string;parentCreatedAt:string};
const safeMetadata="CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END";
export async function saveChat(db:D1Database,user:string,message:string,result:ResearchAnswer,claim?:ContinuationClaim) {
  const timestamp=Math.max(Date.now(),claim?(Date.parse(claim.parentCreatedAt)||0)+1:0),id=crypto.randomUUID(),createdAt=new Date(timestamp+1).toISOString(),{answer,documents,...rest}=result;
  // Documents live once in atlas_documents. Cumulative abstracts must not inflate D1 chat rows.
  const metadata={...rest,plan:{query:result.plan.query,sourceIds:[],urls:result.pages.map(page=>page.url)},documents:[],documentIds:documents.map(document=>document.id),newDocumentIds:documents.slice(0,result.search?.newDocumentsCount??documents.length).map(document=>document.id)};
  const claimSql=claim?` WHERE EXISTS(SELECT 1 FROM atlas_chat WHERE id=? AND user_id=? AND json_extract(${safeMetadata},'$.search.continuationClaim')=?)`:"";
  const stmt=(rowId:string,role:string,content:string,meta:string,time:string)=>db.prepare(`INSERT INTO atlas_chat(id,user_id,role,content,metadata,created_at) SELECT ?,?,?,?,?,?${claimSql}`).bind(rowId,user,role,content,meta,time,...(claim?[claim.parentId,user,claim.token]:[]));
  const statements=[stmt(crypto.randomUUID(),"user",message,"{}",new Date(timestamp).toISOString()),stmt(id,"assistant",answer,JSON.stringify(metadata),createdAt)];
  if(claim)statements.push(db.prepare(`UPDATE atlas_chat SET metadata=json_set(json_remove(${safeMetadata},'$.search.continuationClaim','$.search.continuationClaimedUntil'),'$.search.continuedBy',?,'$.search.canContinue',json('false')) WHERE id=? AND user_id=? AND json_extract(${safeMetadata},'$.search.continuationClaim')=?`).bind(id,claim.parentId,user,claim.token));
  const saved=await db.batch(statements);
  if(claim&&!saved[1]?.meta?.changes)throw new ResearchRequestError("This search was continued in another request. Open the latest results.",409);
  return {id,createdAt};
}

function isContinuationPrompt(message:string):boolean{return /^(?:find(?: me)? more(?: (?:sources|resources|documents|papers|examples))?|(?:more|other|additional)(?: (?:sources|resources|documents|papers|examples))?|(?:search |try )?again|continue|same topic|keep going)[.!?]*$/i.test(message.trim());}
async function claimContinuation(db:D1Database,user:string,id:string):Promise<{continuation:ResearchContinuation;claim:ContinuationClaim}>{
  const row=await db.prepare("SELECT id,role,content,metadata,created_at FROM atlas_chat WHERE id=? AND user_id=? AND role='assistant'").bind(id,user).first<ChatRow>();
  if(!row)throw new ResearchRequestError("That research message was not found in your workspace.",404);
  const metadata=metadataOf(row),search=metadata.search,query=metadata.plan?.query;
  if(!search||typeof search.chainId!=="string"||typeof query!=="string"||!query.trim())throw new ResearchRequestError("This older search has no saved continuation. Run the research question again to start an expanded search.",409);
  if(search.continuedBy)throw new ResearchRequestError("This search has already been continued. Use the latest results in this search.",409);
  if(search.nextBatch===null)throw new ResearchRequestError("This search has no further batches. Try a more specific question or a different subject.",409);
  if(!Number.isInteger(search.batch)||search.batch<0||search.batch>18||!Number.isInteger(search.nextBatch)||search.nextBatch!==search.batch+1||search.nextBatch>19)throw new ResearchRequestError("The saved search position is invalid. Run the research question again.",409);
  const token=crypto.randomUUID(),now=Date.now();
  const reserved=await db.prepare(`UPDATE atlas_chat SET metadata=json_set(${safeMetadata},'$.search.continuationClaim',?,'$.search.continuationClaimedUntil',?,'$.search.canContinue',json('false')) WHERE id=? AND user_id=? AND role='assistant' AND json_extract(${safeMetadata},'$.search.continuedBy') IS NULL AND (json_extract(${safeMetadata},'$.search.continuationClaim') IS NULL OR COALESCE(json_extract(${safeMetadata},'$.search.continuationClaimedUntil'),0)<?)`).bind(token,now+120000,id,user,now).run();
  if(!reserved.meta.changes)throw new ResearchRequestError("More documents are already being searched for this message. Wait for the current request to finish.",409);
  const documentIds=Array.isArray(metadata.documentIds)?stringIds(metadata.documentIds):Array.isArray(metadata.documents)?metadata.documents.flatMap((document:any)=>typeof document?.id==="string"?[document.id]:[]):[];
  return {continuation:{query,batch:search.nextBatch,chainId:search.chainId,parentMessageId:id,documentIds},claim:{parentId:id,token,parentCreatedAt:row.created_at}};
}

/** POST's owner checks and checkpoint progression are shared with native database tests. */
export async function runResearchRequest(db:D1Database,user:string,input:Record<string,unknown>,catalog:ResearchSource[],options:DiscoveryOptions={}):Promise<ResearchAnswer&{id:string;createdAt:string}>{
  if(["batch","query","excludeUrls","excludeDois","continuationKey"].some(key=>Object.hasOwn(input,key)))throw new ResearchRequestError("Search positions and exclusions are managed by the server. Use the saved continuation button.");
  const explicit=Object.hasOwn(input,"continueFrom");
  if(explicit&&(typeof input.continueFrom!=="string"||!/^[a-zA-Z0-9_-]{1,180}$/.test(input.continueFrom)))throw new ResearchRequestError("Choose a valid saved research message to continue.");
  if(input.message!==undefined&&typeof input.message!=="string")throw new ResearchRequestError("Enter a research question.");
  const message=(typeof input.message==="string"?input.message.trim():"")||(explicit?"Find more":"");
  if(!message)throw new ResearchRequestError("Enter a research question.");
  if(message.length>2000)throw new ResearchRequestError("Keep your research question under 2,000 characters.");
  let parentId=explicit?input.continueFrom as string:undefined;
  if(!parentId&&isContinuationPrompt(message)){
    const latest=await db.prepare("SELECT id FROM atlas_chat WHERE user_id=? AND role='assistant' ORDER BY created_at DESC,id DESC LIMIT 1").bind(user).first<{id:string}>();
    if(!latest)throw new ResearchRequestError("Start with a specific research question before asking for more documents.");
    parentId=latest.id;
  }
  const checkpoint=parentId?await claimContinuation(db,user,parentId):undefined;
  try{
    let history=checkpoint?[]:cleanHistory(input.history);
    if(!checkpoint&&!history.length){const stored=await db.prepare("SELECT role,content FROM atlas_chat WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 12").bind(user).all<ChatMessage>();history=cleanHistory(stored.results.reverse());}
    const result=await retrieveForUser(db,user,message,history,catalog,options,checkpoint?.continuation);
    const saved=await saveChat(db,user,message,result,checkpoint?.claim);
    return {...result,...saved};
  }catch(error){
    if(checkpoint)await db.prepare(`UPDATE atlas_chat SET metadata=json_set(json_remove(${safeMetadata},'$.search.continuationClaim','$.search.continuationClaimedUntil'),'$.search.canContinue',json('true')) WHERE id=? AND user_id=? AND json_extract(${safeMetadata},'$.search.continuationClaim')=?`).bind(checkpoint.claim.parentId,user,checkpoint.claim.token).run();
    throw error;
  }
}
