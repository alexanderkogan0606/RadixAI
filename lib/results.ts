/** Owner-scoped research results; access refers to the matched source, not a verified full article. */
export type ResultAccess="Free"|"Freemium"|"Mixed"|"Paid"|"Unknown";
export type ResultClassifier=(page:{url:string;sourceId?:string})=>ResultAccess;
type Row=Record<string,unknown>;
type Filters={jobId:string;q:string;access:"free"|"all"};
type Cursor=Filters&{v:1;time:string;id:string};
const PAGE_SIZE=40,SCAN_SIZE=250;
export class ResultsError extends Error {
  status:number;
  constructor(message:string,status=400){super(message);this.status=status;}
}
function encodeCursor(cursor:Cursor){
  const bytes=new TextEncoder().encode(JSON.stringify(cursor));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function decodeCursor(value:string,filters:Filters):Cursor|null{
  if(!value)return null;
  try{
    if(value.length>4096||!/^[A-Za-z0-9_-]+$/.test(value))throw new Error();
    const binary=atob(value.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(value.length/4)*4,"="));
    const cursor=JSON.parse(new TextDecoder().decode(Uint8Array.from(binary,c=>c.charCodeAt(0)))) as Cursor;
    if(!cursor||cursor.v!==1||typeof cursor.time!=="string"||cursor.time.length>64||Number.isNaN(Date.parse(cursor.time))||typeof cursor.id!=="string"||!cursor.id||cursor.id.length>250)throw new Error();
    if(cursor.jobId!==filters.jobId||cursor.q!==filters.q||cursor.access!==filters.access)throw new ResultsError("Reset pagination after changing the research filters.");
    return cursor;
  }catch(error){if(error instanceof ResultsError)throw error;throw new ResultsError("The results cursor is invalid. Start from the first page.");}
}
function parseFilters(params:URLSearchParams){
  for(const key of ["jobId","q","access","cursor"])if(params.getAll(key).length>1)throw new ResultsError(`Provide ${key} only once.`);
  const jobId=(params.get("jobId")||"").trim(),q=(params.get("q")||"").trim(),access=params.get("access")??"free";
  if(jobId&&(!/^[\w.:-]+$/.test(jobId)||jobId.length>250))throw new ResultsError("Choose a valid crawl run.");
  if(q.length>300)throw new ResultsError("Keep the research search under 300 characters.");
  if(access!=="free"&&access!=="all")throw new ResultsError("Access must be free or all.");
  const filters:Filters={jobId,q,access};
  return {filters,cursor:decodeCursor(params.get("cursor")||"",filters)};
}
function statement(db:D1Database,sql:string,...values:unknown[]){return db.prepare(sql).bind(...values);}
async function rows(db:D1Database,sql:string,...values:unknown[]){return (await statement(db,sql,...values).all<Row>()).results;}
function afterCursor(row:Row,cursor:Cursor|null){
  return !cursor||String(row.fetched_at)<cursor.time||(String(row.fetched_at)===cursor.time&&String(row.id)<cursor.id);
}
function serializePage(row:Row,access:ResultAccess){
  let tags:string[]=[];
  try{const parsed=JSON.parse(String(row.tags||"[]"));if(Array.isArray(parsed))tags=parsed.filter((value):value is string=>typeof value==="string");}catch{}
  return {id:String(row.id),url:String(row.url),title:String(row.title),name:String(row.title),description:String(row.description),domain:String(row.domain),category:String(row.category),sourceId:String(row.source_id),jobId:String(row.job_id),depth:Number(row.depth),parentUrl:row.parent_url??null,fetchedAt:String(row.fetched_at),collectedAt:String(row.fetched_at),status:String(row.status),tags,query:String(row.query||""),type:"Indexed page",access,sourceAccess:access,accessScope:"Source classification",validation:"Captured public metadata; full article not verified",geography:"Global",crawlMethod:"Manual",verification:"Crawled",provenanceUrl:String(row.url)};
}

export async function readResults(db:D1Database,user:string,params:URLSearchParams,classify:ResultClassifier){
  const {filters,cursor}=parseFilters(params);
  const clauses=["p.user_id=?"],values:unknown[]=[user];
  if(filters.jobId){clauses.push("p.job_id=?");values.push(filters.jobId);}
  if(filters.q){
    // instr treats %, _ and backslashes literally instead of expanding them as LIKE wildcards.
    clauses.push("instr(lower(COALESCE(p.title,'')||char(10)||COALESCE(p.description,'')||char(10)||p.url||char(10)||COALESCE(p.tags,'')||char(10)||COALESCE(p.domain,'')||char(10)||COALESCE(p.category,'')||char(10)||COALESCE(j.query,'')),lower(?))>0");
    values.push(filters.q);
  }
  const from="FROM atlas_pages p JOIN atlas_jobs j ON j.id=p.job_id AND j.user_id=p.user_id";
  const where=clauses.join(" AND ");
  const initial=await db.batch<Row>([
    statement(db,"SELECT COUNT(*) AS total FROM atlas_pages WHERE user_id=?",user),
    statement(db,`SELECT COUNT(*) AS total ${from} WHERE ${where}`,...values),
    statement(db,"SELECT id FROM atlas_jobs WHERE user_id=? AND id=?",user,filters.jobId),
  ]);
  if(filters.jobId&&!initial[2].results.length)throw new ResultsError("Crawl run not found.",404);
  const total=Number(initial[0].results[0]?.total||0),matchingTotal=Number(initial[1].results[0]?.total||0);
  let filteredTotal=matchingTotal,excludedAccessCount=0;
  let candidates:Row[]=[];
  const classifications=new Map<string,ResultAccess>();
  const classifyRow=(row:Row)=>{
    const url=String(row.url),key=url+"\n"+String(row.source_id);
    const cached=classifications.get(key);if(cached)return cached;
    const access=classify({url,sourceId:String(row.source_id)});classifications.set(key,access);return access;
  };
  if(filters.access==="free"){
    // Classify destination URLs using the shared path policy, never the originating seed alone.
    // Scan only identifiers/URLs in bounded batches to produce exact access-filtered counts.
    let boundary:Row|null=null;
    filteredTotal=0;
    while(true){
      const boundarySql=boundary?" AND (p.fetched_at<? OR (p.fetched_at=? AND p.id<?))":"";
      const boundaryValues=boundary?[boundary.fetched_at,boundary.fetched_at,boundary.id]:[];
      const batch=await rows(db,`SELECT p.id,p.url,p.source_id,p.fetched_at ${from} WHERE ${where}${boundarySql} ORDER BY p.fetched_at DESC,p.id DESC LIMIT ${SCAN_SIZE}`,...values,...boundaryValues);
      for(const row of batch){
        if(classifyRow(row)==="Free"){
          filteredTotal++;
          if(candidates.length<PAGE_SIZE+1&&afterCursor(row,cursor))candidates.push(row);
        }else excludedAccessCount++;
      }
      if(batch.length<SCAN_SIZE)break;
      boundary=batch[batch.length-1];
    }
  }else{
    const cursorSql=cursor?" AND (p.fetched_at<? OR (p.fetched_at=? AND p.id<?))":"";
    const cursorValues=cursor?[cursor.time,cursor.time,cursor.id]:[];
    candidates=await rows(db,`SELECT p.id,p.url,p.source_id,p.fetched_at ${from} WHERE ${where}${cursorSql} ORDER BY p.fetched_at DESC,p.id DESC LIMIT ${PAGE_SIZE+1}`,...values,...cursorValues);
  }
  const hasMore=candidates.length>PAGE_SIZE,selected=candidates.slice(0,PAGE_SIZE);
  const fullRows=selected.length?await rows(db,`SELECT p.*,j.query AS query ${from} WHERE p.user_id=? AND p.id IN (${selected.map(()=>"?").join(",")})`,user,...selected.map(row=>row.id)):[];
  const byId=new Map(fullRows.map(row=>[String(row.id),row]));
  const pages=selected.flatMap(row=>{const full=byId.get(String(row.id));return full?[serializePage(full,classifyRow(row))]:[];});
  const last=selected[selected.length-1];
  const nextCursor=hasMore&&last?encodeCursor({v:1,time:String(last.fetched_at),id:String(last.id),...filters}):null;
  return {pages,total,filteredTotal,excludedAccessCount,nextCursor};
}
