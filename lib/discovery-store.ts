/** Persistent provider evidence. Discovery does not mean the document was crawled or read. */
export interface DiscoveryInput {
  id:string;title:string;name?:string;url:string;description:string;provider:string;
  providerRecordUrl:string;publishedAt?:string;access:"Free";accessBasis:string;
  fullTextUrl?:string;doi?:string;type:string;domain:string;query:string;foundAt:string;
}
type Row=Record<string,unknown>;
function statement(db:D1Database,sql:string,...values:unknown[]){return db.prepare(sql).bind(...values);}

export function normalizeDocumentUrl(address:string):string{
  const url=new URL(address);
  if(url.protocol!=="https:"||url.username||url.password||(url.port&&url.port!=="443"))throw new Error("Documents must use public HTTPS URLs.");
  const host=url.hostname.toLowerCase().replace(/\.$/,"");
  if(host==="localhost"||host.endsWith(".localhost")||host.endsWith(".local")||host.endsWith(".internal")||host.includes(":")||/^\d+(?:\.\d+){3}$/.test(host)||!host.includes("."))throw new Error("Documents must use public HTTPS URLs.");
  url.hostname=host;url.hash="";
  for(const key of [...url.searchParams.keys()])if(/^utm_|^(fbclid|gclid|mc_cid|mc_eid)$/i.test(key))url.searchParams.delete(key);
  url.searchParams.sort();
  return url.href;
}
/** Recognize only the two observed World Bank record routes, not arbitrary redirects or host paths. */
export function canonicalEvidenceUrl(address:string):string{
  const normalized=normalizeDocumentUrl(address),url=new URL(normalized);
  if(url.hostname!=="documents.worldbank.org"||url.search)return normalized;
  const match=url.pathname.match(/^\/curated\/en\/(\d+)\/?$/)||url.pathname.match(/^\/en\/publication\/documents-reports\/documentdetail\/(\d+)\/?$/);
  return match?`https://documents.worldbank.org/en/publication/documents-reports/documentdetail/${match[1]}`:normalized;
}
export function documentEvidenceUrls(address:string):string[]{
  const original=normalizeDocumentUrl(address),canonical=canonicalEvidenceUrl(original),url=new URL(canonical);
  const match=url.hostname==="documents.worldbank.org"&&!url.search?url.pathname.match(/^\/en\/publication\/documents-reports\/documentdetail\/(\d+)$/):null;
  return [...new Set(match?[original,canonical,`https://documents.worldbank.org/curated/en/${match[1]}`]:[original])];
}
function queryHistory(value:unknown):string[]{try{const parsed=JSON.parse(String(value));return Array.isArray(parsed)?parsed.filter((item):item is string=>typeof item==="string"):[];}catch{return [];}}
function publicDocument(row:Row){
  return {id:String(row.id),title:String(row.title),name:String(row.title),url:String(row.url),description:String(row.description),provider:String(row.provider),providerId:String(row.provider_id),providerRecordUrl:String(row.provider_record_url),provenanceUrl:String(row.provider_record_url),publishedAt:row.published_at?String(row.published_at):undefined,access:"Free" as const,sourceAccess:"Free" as const,accessBasis:String(row.access_basis),accessScope:"Provider evidence",fullTextUrl:row.full_text_url?String(row.full_text_url):undefined,doi:row.doi?String(row.doi):undefined,type:"Discovered document" as const,documentType:String(row.document_type),domain:String(row.domain),category:"Discovered documents",tags:[] as string[],geography:"Global",crawlMethod:"HTML",verification:"Provider evidence",origin:"discovery" as const,sourceId:String(row.id),jobId:"",query:String(row.query),queryHistory:queryHistory(row.queries),foundAt:String(row.discovered_at),fetchedAt:String(row.discovered_at),collectedAt:String(row.discovered_at),updatedAt:String(row.updated_at),status:"discovered",depth:0,parentUrl:null,validation:"Provider metadata and open-access evidence; full document not independently fetched or read"};
}
export type StoredDiscoveredDocument=ReturnType<typeof publicDocument>;

export async function saveDiscoveredDocuments(db:D1Database,user:string,query:string,documents:readonly DiscoveryInput[]):Promise<StoredDiscoveredDocument[]>{
  const question=query.trim();
  if(!question||question.length>2000)throw new Error("A research question under 2,000 characters is required.");
  if(documents.length>200)throw new Error("Save at most 200 discovered documents at a time.");
  const unique=new Map<string,DiscoveryInput>();
  for(const document of documents){
    if(document.access!=="Free"||!document.accessBasis?.trim()||!document.provider?.trim()||!document.title?.trim())throw new Error("Discovered documents need a title, provider, and explicit free-access evidence.");
    const url=normalizeDocumentUrl(document.url);normalizeDocumentUrl(document.providerRecordUrl);
    if(document.fullTextUrl)normalizeDocumentUrl(document.fullTextUrl);
    unique.set(url,document);
  }
  const now=new Date().toISOString();
  const prepared=await Promise.all([...unique].map(async([url,document])=>{
    const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(user+"\n"+url));
    const id="document-"+[...new Uint8Array(hash)].map(value=>value.toString(16).padStart(2,"0")).join("");
    const foundAt=Number.isFinite(Date.parse(document.foundAt))?new Date(document.foundAt).toISOString():now;
    return {id,command:statement(db,`INSERT INTO atlas_documents(id,user_id,url,title,description,domain,document_type,provider,provider_id,provider_record_url,access_basis,full_text_url,doi,published_at,query,queries,discovered_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,url) DO UPDATE SET
      title=excluded.title,description=excluded.description,domain=excluded.domain,document_type=excluded.document_type,
      provider=excluded.provider,provider_id=excluded.provider_id,provider_record_url=excluded.provider_record_url,
      access_basis=excluded.access_basis,full_text_url=excluded.full_text_url,doi=excluded.doi,published_at=excluded.published_at,
      query=excluded.query,queries=CASE WHEN EXISTS(SELECT 1 FROM json_each(atlas_documents.queries) WHERE value=excluded.query) THEN atlas_documents.queries ELSE json_insert(atlas_documents.queries,'$[#]',excluded.query) END,
      updated_at=excluded.updated_at`,id,user,url,document.title.trim().slice(0,1000),document.description.slice(0,12000),document.domain,document.type,document.provider,document.id,normalizeDocumentUrl(document.providerRecordUrl),document.accessBasis.trim().slice(0,4000),document.fullTextUrl?normalizeDocumentUrl(document.fullTextUrl):null,document.doi||null,document.publishedAt||null,question,JSON.stringify([question]),foundAt,now)};
  }));
  for(let i=0;i<prepared.length;i+=50)await db.batch(prepared.slice(i,i+50).map(item=>item.command));
  const found=new Map<string,StoredDiscoveredDocument>();
  for(let i=0;i<prepared.length;i+=50){
    const ids=prepared.slice(i,i+50).map(item=>item.id);
    const result=await statement(db,`SELECT * FROM atlas_documents WHERE user_id=? AND id IN (${ids.map(()=>"?").join(",")})`,user,...ids).all<Row>();
    for(const row of result.results)found.set(String(row.id),publicDocument(row));
  }
  return prepared.flatMap(item=>found.has(item.id)?[found.get(item.id)!]:[]);
}

export async function readSavedDocuments(db:D1Database,user:string):Promise<StoredDiscoveredDocument[]>{
  const result=await statement(db,"SELECT d.* FROM atlas_documents d JOIN atlas_bookmarks b ON b.user_id=d.user_id AND b.resource_id=d.id WHERE d.user_id=? ORDER BY d.discovered_at DESC,d.id DESC",user).all<Row>();
  return result.results.map(publicDocument);
}

export async function readKnownFreeDocumentSources(db:D1Database,user:string){
  const result=await statement(db,"SELECT * FROM atlas_documents WHERE user_id=? ORDER BY discovered_at DESC,id DESC",user).all<Row>();
  return result.results.flatMap(row=>{
    const document=publicDocument(row),source={...document,exact:true as const,aliasOf:undefined as string|undefined};
    const aliases=documentEvidenceUrls(document.url).filter(url=>url!==document.url).map(url=>({...source,id:document.id+(url.includes("/documentdetail/")?":canonical":":curated"),url,aliasOf:document.id}));
    if(document.fullTextUrl&&document.fullTextUrl!==document.url&&!aliases.some(alias=>alias.url===document.fullTextUrl))aliases.push({...source,id:document.id+":fulltext",url:document.fullTextUrl,aliasOf:document.id});
    return [source,...aliases];
  });
}
export async function readKnownFreeDocumentUrls(db:D1Database,user:string):Promise<string[]>{
  const result=await statement(db,"SELECT url,full_text_url FROM atlas_documents WHERE user_id=?",user).all<{url:string;full_text_url:string|null}>();
  return [...new Set(result.results.flatMap(row=>[...documentEvidenceUrls(row.url),...(row.full_text_url?[row.full_text_url]:[])]))];
}
