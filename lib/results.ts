/** Owner-scoped research documents and crawl captures with evidence-based filtering. */
// @ts-expect-error Node's native TypeScript runner needs the explicit extension.
import { assessResource } from "./resource-quality.ts";
// @ts-expect-error Node's native TypeScript runner needs the explicit extension.
import { canonicalEvidenceUrl } from "./discovery-store.ts";
// @ts-expect-error Node's native TypeScript runner needs the explicit extension.
import { isFilingQuery } from "./filing-discovery.ts";
// @ts-expect-error Node's native TypeScript runner needs the explicit extension.
import { documentIdentityKeys } from "./document-identity.ts";
export type ResultAccess="Free"|"Freemium"|"Mixed"|"Paid"|"Unknown";
export type ResultClassifier=(page:{url:string;sourceId?:string})=>ResultAccess;
export type ResourceAssessment={eligible:boolean;reason:string|null;matchedTerms:string[];score:number};
export type ResultAssessor=(page:{url:string;title?:string;description?:string},query?:string)=>ResourceAssessment;
type Row=Record<string,unknown>;
type Filters={jobId:string;q:string;access:"free"|"all";saved:boolean};
type Cursor=Filters&{v:2;time:string;id:string};
type Candidate={id:string;time:string;origin:string;access:ResultAccess;quality:ResourceAssessment;rank:number};
const PAGE_SIZE=40,SCAN_SIZE=250;
export class ResultsError extends Error {status:number;constructor(message:string,status=400){super(message);this.status=status;}}
function encodeCursor(cursor:Cursor){const bytes=new TextEncoder().encode(JSON.stringify(cursor));return btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");}
function decodeCursor(value:string,filters:Filters):Cursor|null{
  if(!value)return null;
  try{
    if(value.length>4096||!/^[A-Za-z0-9_-]+$/.test(value))throw new Error();
    const binary=atob(value.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(value.length/4)*4,"="));
    const cursor=JSON.parse(new TextDecoder().decode(Uint8Array.from(binary,c=>c.charCodeAt(0)))) as Cursor;
    if(!cursor||cursor.v!==2||typeof cursor.time!=="string"||cursor.time.length>64||Number.isNaN(Date.parse(cursor.time))||typeof cursor.id!=="string"||!cursor.id||cursor.id.length>250)throw new Error();
    if(cursor.jobId!==filters.jobId||cursor.q!==filters.q||cursor.access!==filters.access||cursor.saved!==filters.saved)throw new ResultsError("Reset pagination after changing the research filters.");
    return cursor;
  }catch(error){if(error instanceof ResultsError)throw error;throw new ResultsError("The results cursor is invalid. Start from the first page.");}
}
function parseFilters(params:URLSearchParams){
  for(const key of ["jobId","q","access","cursor","saved"])if(params.getAll(key).length>1)throw new ResultsError(`Provide ${key} only once.`);
  const jobId=(params.get("jobId")||"").trim(),q=(params.get("q")||"").trim(),access=params.get("access")??"free",saved=params.get("saved")??"false";
  if(jobId&&(!/^[\w.:-]+$/.test(jobId)||jobId.length>250))throw new ResultsError("Choose a valid crawl run.");
  if(q.length>300)throw new ResultsError("Keep the research search under 300 characters.");
  if(access!=="free"&&access!=="all")throw new ResultsError("Access must be free or all.");
  if(saved!=="true"&&saved!=="false")throw new ResultsError("Saved must be true or false.");
  const filters:Filters={jobId,q,access,saved:saved==="true"};
  return {filters,cursor:decodeCursor(params.get("cursor")||"",filters)};
}
function statement(db:D1Database,sql:string,...values:unknown[]){return db.prepare(sql).bind(...values);}
function canonicalKey(value:unknown){try{const u=new URL(String(value));u.hash="";u.hostname=u.hostname.replace(/^www\./,"");for(const k of [...u.searchParams.keys()])if(/^utm_|^(fbclid|gclid|mc_cid|mc_eid)$/i.test(k))u.searchParams.delete(k);u.searchParams.sort();return canonicalEvidenceUrl(u.href);}catch{return String(value);}}
function strings(value:unknown):string[]{try{const parsed=JSON.parse(String(value));return Array.isArray(parsed)?parsed.filter((item):item is string=>typeof item==="string"):[];}catch{return [];}}
function serialize(row:Row,candidate:Candidate,evidence?:Row){
  const discovery=row.origin==="discovery",provider=String(row.provider||evidence?.provider||""),accessBasis=String(row.access_basis||evidence?.access_basis||""),providerRecordUrl=String(row.provider_record_url||evidence?.provider_record_url||"");
  return {id:String(row.id),url:String(row.url),title:String(row.title),name:String(row.title),description:String(row.description),domain:String(row.domain),category:String(row.category),sourceId:String(row.source_id),jobId:String(row.job_id),depth:Number(row.depth),parentUrl:row.parent_url??null,fetchedAt:String(row.collected_at),collectedAt:String(row.collected_at),status:String(row.status),tags:strings(row.tags),query:String(row.query||""),queryHistory:discovery?strings(row.queries):[String(row.query||"")],origin:discovery?"discovery":"crawl",type:discovery?"Discovered document":"Indexed page",documentType:discovery?String(row.document_type):undefined,provider:provider||undefined,providerRecordUrl:providerRecordUrl||undefined,publishedAt:row.published_at||undefined,fullTextUrl:row.full_text_url||undefined,doi:row.doi||undefined,access:candidate.access,sourceAccess:candidate.access,accessBasis:accessBasis||"Catalogued source access classification; full article access not independently verified",accessScope:accessBasis?"Provider evidence":"Source classification",validation:discovery?"Provider metadata and open-access evidence; full document not independently fetched or read":"Captured public metadata; full article not verified",geography:"Global",crawlMethod:discovery?"API":"Manual",verification:discovery?"Provider evidence":"Crawled",provenanceUrl:providerRecordUrl||String(row.url),quality:candidate.quality,saved:Boolean(row.saved)};
}
// The two owner predicates are deliberate: neither bookmarks nor a guessed cursor grants access.
const combined=`SELECT p.id,p.url,p.title,p.description,p.domain,p.category,p.tags,p.source_id,p.job_id,p.depth,p.parent_url,p.fetched_at AS collected_at,p.status,j.query,'[]' AS queries,'crawl' AS origin,'' AS provider,'' AS provider_record_url,'' AS access_basis,'' AS document_type,NULL AS published_at,NULL AS full_text_url,NULL AS doi,
  EXISTS(SELECT 1 FROM atlas_bookmarks b WHERE b.user_id=p.user_id AND b.resource_id=p.id) AS saved
  FROM atlas_pages p JOIN atlas_jobs j ON j.id=p.job_id AND j.user_id=p.user_id WHERE p.user_id=?
  UNION ALL SELECT d.id,d.url,d.title,d.description,d.domain,'Discovered documents','[]',d.id,'',0,NULL,d.discovered_at,'discovered',d.query,d.queries,'discovery',d.provider,d.provider_record_url,d.access_basis,d.document_type,d.published_at,d.full_text_url,d.doi,
  EXISTS(SELECT 1 FROM atlas_bookmarks b WHERE b.user_id=d.user_id AND b.resource_id=d.id) AS saved
  FROM atlas_documents d WHERE d.user_id=?`;

export async function readResults(db:D1Database,user:string,params:URLSearchParams,classify:ResultClassifier,assess:ResultAssessor=assessResource){
  const {filters,cursor}=parseFilters(params);
  const initial=await db.batch<Row>([
    statement(db,"SELECT id FROM atlas_jobs WHERE user_id=? AND id=?",user,filters.jobId),
    statement(db,"SELECT url,full_text_url,provider,provider_record_url,access_basis,query,queries FROM atlas_documents WHERE user_id=?",user),
  ]);
  if(filters.jobId&&!initial[0].results.length)throw new ResultsError("Crawl run not found.",404);
  const evidence=new Map<string,Row>();
  for(const row of initial[1].results){evidence.set(canonicalKey(row.url),row);if(row.full_text_url)evidence.set(canonicalKey(row.full_text_url),row);}
  const seen=new Set<string>(),chosen=new Map<string,Candidate>(),candidatesByIdentity:{key:string;candidate:Candidate}[]=[],identityParents=new Map<string,string>();
  const identityRoot=(key:string):string=>{let root=key;while(identityParents.has(root)&&identityParents.get(root)!==root)root=identityParents.get(root)!;let next=key;while(identityParents.has(next)&&identityParents.get(next)!==root){const parent=identityParents.get(next)!;identityParents.set(next,root);next=parent;}return root;};
  const identity=(row:Row):string=>{
    const keys=[`url:${canonicalKey(row.url)}`,...documentIdentityKeys({url:String(row.url),fullTextUrl:row.full_text_url?String(row.full_text_url):undefined,doi:row.doi?String(row.doi):undefined})];
    const root=identityRoot(keys[0]);for(const key of keys)identityParents.set(identityRoot(key),root);return root;
  };
  let rawTotal=0,crawlTotal=0,discoveryTotal=0,boundary:Row|null=null;
  while(true){
    const boundarySql:string=boundary?"WHERE collected_at<? OR (collected_at=? AND id<?)":"";
    const values:unknown[]=boundary?[boundary.collected_at,boundary.collected_at,boundary.id]:[];
    const batch:Row[]=(await statement(db,`SELECT * FROM (${combined}) ${boundarySql} ORDER BY collected_at DESC,id DESC LIMIT ${SCAN_SIZE}`,user,user,...values).all<Row>()).results;
    for(const row of batch){
      rawTotal++;if(row.origin==="discovery")discoveryTotal++;else crawlTotal++;
      const key=canonicalKey(row.url),identityKey=identity(row);seen.add(identityKey);
      if(filters.jobId&&(row.origin!=="crawl"||row.job_id!==filters.jobId))continue;
      if(filters.saved&&!row.saved)continue;
      if(filters.q&&![row.title,row.description,row.url,row.tags,row.domain,row.category,row.query,row.queries,row.provider].join("\n").toLowerCase().includes(filters.q.toLowerCase()))continue;
      const access=row.origin==="discovery"||evidence.has(key)?"Free":classify({url:String(row.url),sourceId:String(row.source_id)});
      const query=String(row.query||""),providerEvidence=row.origin==="discovery"?row:evidence.get(key);
      const validatedFiling=providerEvidence?.provider==="SEC EDGAR"&&!!providerEvidence.access_basis&&isFilingQuery(query)&&
        (row.origin==="discovery"||[String(providerEvidence.query||""),...strings(providerEvidence.queries)].includes(query));
      const resource={url:String(row.url),title:String(row.title),description:String(row.description)};
      let quality=assess(resource,query);
      // SEC validates company, form and fiscal period. Metadata need not repeat request
      // wording such as "earnings" or "Q1 FY2025"; gates and empty content still fail.
      if(validatedFiling&&quality.reason==="off-topic"){
        const structural=assess(resource,"");
        quality={...structural,matchedTerms:quality.matchedTerms,score:quality.score};
      }
      const rank=(quality.eligible?4:0)+(access==="Free"?2:0)+(row.origin==="discovery"?1:0);
      const candidate:Candidate={id:String(row.id),time:String(row.collected_at),origin:String(row.origin),access,quality,rank};
      candidatesByIdentity.push({key:identityKey,candidate});
    }
    if(batch.length<SCAN_SIZE)break;boundary=batch[batch.length-1];
  }
  for(const {key,candidate} of candidatesByIdentity){
    const group=identityRoot(key),previous=chosen.get(group);
    // Keep a substantive free document in preference to a duplicate gate or navigation capture.
    if(!previous||candidate.rank>previous.rank)chosen.set(group,candidate);
  }
  let filteredTotal=0,excludedAccessCount=0,excludedQualityCount=0;
  const candidates:Candidate[]=[];
  for(const candidate of chosen.values()){
    if(filters.access==="free"){
      if(candidate.access!=="Free"){excludedAccessCount++;continue;}
      if(!candidate.quality.eligible){excludedQualityCount++;continue;}
    }
    filteredTotal++;
    if(!cursor||candidate.time<cursor.time||(candidate.time===cursor.time&&candidate.id<cursor.id))candidates.push(candidate);
  }
  candidates.sort((a,b)=>a.time===b.time?(a.id>b.id?-1:a.id<b.id?1:0):(a.time>b.time?-1:1));
  const selected=candidates.slice(0,PAGE_SIZE),ids=selected.map(item=>item.id);
  const fullRows=ids.length?(await statement(db,`SELECT * FROM (${combined}) WHERE id IN (${ids.map(()=>"?").join(",")})`,user,user,...ids).all<Row>()).results:[];
  const byId=new Map(fullRows.map(row=>[String(row.id),row]));
  const pages=selected.flatMap(candidate=>{const row=byId.get(candidate.id);return row?[serialize(row,candidate,evidence.get(canonicalKey(row.url)))]:[];});
  const last=selected[selected.length-1];
  const total=new Set([...seen].map(identityRoot)).size;
  return {pages,total,rawTotal,crawlTotal,discoveryTotal,duplicateCount:rawTotal-total,filteredTotal,excludedAccessCount,excludedQualityCount,nextCursor:candidates.length>PAGE_SIZE&&last?encodeCursor({v:2,time:last.time,id:last.id,...filters}):null};
}
