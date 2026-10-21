import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync,readdirSync } from "node:fs";
// @ts-expect-error Node's native TypeScript runner needs the explicit extension.
import { saveDiscoveredDocuments,readSavedDocuments,readKnownFreeDocumentSources,readKnownFreeDocumentUrls,normalizeDocumentUrl,canonicalEvidenceUrl } from "../lib/discovery-store.ts";
// @ts-expect-error Node's native TypeScript runner needs the explicit extension.
import { classifyPageAccess } from "../lib/free-access.ts";

function database(){
  const sqlite=new DatabaseSync(":memory:");
  for(const name of readdirSync(new URL("../drizzle/",import.meta.url)).filter(name=>name.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../drizzle/${name}`,import.meta.url),"utf8"));
  class Prepared{
    sql:string;params:(string|number|null)[];
    constructor(sql:string,params:(string|number|null)[]=[]){this.sql=sql;this.params=params;}
    bind(...params:(string|number|null)[]){return new Prepared(this.sql,params);}
    async all(){return {results:sqlite.prepare(this.sql).all(...this.params),success:true};}
    async run(){const result=sqlite.prepare(this.sql).run(...this.params);return {meta:{changes:Number(result.changes)},success:true};}
  }
  const db={prepare:(sql:string)=>new Prepared(sql),batch:(commands:Prepared[])=>Promise.all(commands.map(command=>/^\s*(SELECT|WITH)\b/i.test(command.sql)?command.all():command.run()))} as unknown as D1Database;
  return {sqlite,db};
}
const document={id:"https://openalex.org/W123",title:"Bank merger integration outcomes",url:"https://repository.example/papers/mergers",description:"A quantitative comparison of bank merger integration outcomes, employment and profitability.",provider:"OpenAlex",providerRecordUrl:"https://openalex.org/W123",publishedAt:"2025-01-01",access:"Free" as const,accessBasis:"OpenAlex reports an open-access repository location; destination not independently checked.",fullTextUrl:"https://repository.example/papers/mergers.pdf",doi:"10.1234/example",type:"Research paper",domain:"Finance",query:"bank merger integration",foundAt:"2026-10-18T12:00:00.000Z"};

test("Generated migrations support stable per-owner documents, query history and bookmark persistence",async()=>{
  const {sqlite,db}=database();
  try{
    const [first]=await saveDiscoveredDocuments(db,"alice","bank merger integration",[{...document,url:document.url+"?utm_source=search#abstract"}]);
    sqlite.prepare("INSERT INTO atlas_bookmarks VALUES('alice',?)").run(first.id);
    const [updated]=await saveDiscoveredDocuments(db,"alice","bank acquisition employment",[{...document,id:"second-provider-id",description:"Updated provider metadata.",foundAt:"2026-10-21T14:00:00.000Z"}]);
    assert.equal(updated.id,first.id);assert.equal(updated.foundAt,first.foundAt);assert.equal(updated.origin,"discovery");assert.equal(updated.type,"Discovered document");assert.equal(updated.documentType,"Research paper");
    assert.deepEqual(updated.queryHistory,["bank merger integration","bank acquisition employment"]);assert.equal(updated.query,"bank acquisition employment");assert.equal(updated.providerId,"second-provider-id");
    await saveDiscoveredDocuments(db,"alice","bank acquisition employment",[document]);
    assert.equal((await readSavedDocuments(db,"alice"))[0].queryHistory.length,2);
    assert.deepEqual((await readSavedDocuments(db,"alice")).map(item=>item.id),[first.id]);
    const [bob]=await saveDiscoveredDocuments(db,"bob","private question",[document]);assert.notEqual(bob.id,first.id);
    sqlite.prepare("INSERT INTO atlas_bookmarks VALUES('bob',?)").run(first.id);
    assert.deepEqual(await readSavedDocuments(db,"bob"),[],"Guessing another owner's document ID cannot retrieve it.");
    assert.deepEqual(await readKnownFreeDocumentUrls(db,"alice"),[document.url,document.fullTextUrl]);
    assert.ok(!JSON.stringify(updated).includes("user_id"));
    assert.equal(Number(sqlite.prepare("SELECT COUNT(*) AS total FROM atlas_documents").get()?.total),2);
  }finally{sqlite.close();}
});

test("Known document sources grant access to exact discovered URLs, not a publisher or sibling path",async()=>{
  const {sqlite,db}=database();
  try{
    await saveDiscoveredDocuments(db,"alice","bank merger integration",[document]);
    const known=await readKnownFreeDocumentSources(db,"alice");
    assert.equal(known.length,2);assert.equal(known[0].exact,true);assert.equal(known[0].provider,"OpenAlex");assert.ok(known[0].accessBasis.includes("OpenAlex"));assert.equal(known[1].id,known[0].id+":fulltext");
    assert.equal(classifyPageAccess({url:document.url},known),"Free");
    assert.equal(classifyPageAccess({url:document.url+"/paid"},known),"Unknown");
    assert.equal(classifyPageAccess({url:"https://repository.example/"},known),"Unknown");
    assert.equal(classifyPageAccess({url:document.fullTextUrl},known),"Free","The provider's specific full-text URL also carries its open-access evidence.");
    assert.equal(classifyPageAccess({url:document.fullTextUrl+"?paid=true"},known),"Unknown");
    assert.deepEqual(await readKnownFreeDocumentSources(db,"bob"),[]);
  }finally{sqlite.close();}
});

test("Store rejects unqualified access and unsafe destinations before any writes",async()=>{
  const {sqlite,db}=database();
  try{
    for(const url of ["http://public.example/paper","https://localhost/paper","https://127.0.0.1/paper","https://[::1]/paper","https://user:pass@public.example/paper","https://public.example:444/paper"])assert.throws(()=>normalizeDocumentUrl(url));
    await assert.rejects(()=>saveDiscoveredDocuments(db,"alice","bank research",[{...document,accessBasis:""}]),/evidence/);
    await assert.rejects(()=>saveDiscoveredDocuments(db,"alice","bank research",[{...document,url:"https://localhost/private"}]),/public HTTPS/);
    assert.equal(Number(sqlite.prepare("SELECT COUNT(*) AS total FROM atlas_documents").get()?.total),0);
    const result=await saveDiscoveredDocuments(db,"alice","bank research",[document,{...document,url:document.url+"?utm_campaign=test"}]);assert.equal(result.length,1);
  }finally{sqlite.close();}
});

test("World Bank exact record aliases retain access without changing stored identity or bookmarks",async()=>{
  const {sqlite,db}=database(),curated="https://documents.worldbank.org/curated/en/839461489553413671",canonical="https://documents.worldbank.org/en/publication/documents-reports/documentdetail/839461489553413671";
  try{
    const [stored]=await saveDiscoveredDocuments(db,"alice","bank merger integration",[{...document,id:"worldbank-839461489553413671",url:curated,provider:"World Bank",providerRecordUrl:curated,fullTextUrl:undefined}]);
    sqlite.prepare("INSERT INTO atlas_bookmarks VALUES('alice',?)").run(stored.id);
    const known=await readKnownFreeDocumentSources(db,"alice");
    assert.equal(known.length,2);assert.equal(known[0].id,stored.id);assert.equal(known[0].url,curated);assert.equal(known[0].aliasOf,undefined);
    assert.equal(known[1].id,stored.id+":canonical");assert.equal(known[1].aliasOf,stored.id);assert.equal(known[1].url,canonical);
    for(const url of [curated,canonical])assert.equal(classifyPageAccess({url},known),"Free");
    for(const url of [canonical+"?edition=paid",canonical+"/appendix",canonical.replace(/671$/,"672"),curated.replace(/671$/,"672"),"https://documents.worldbank.org/"]){assert.equal(classifyPageAccess({url},known),"Unknown",url)}
    assert.equal(canonicalEvidenceUrl(curated),canonical);assert.equal(canonicalEvidenceUrl(canonical),canonical);
    assert.notEqual(canonicalEvidenceUrl(curated+"?record=other"),canonical);
    assert.notEqual(canonicalEvidenceUrl("https://evilworldbank.org/curated/en/839461489553413671"),canonical);
    assert.deepEqual(new Set(await readKnownFreeDocumentUrls(db,"alice")),new Set([curated,canonical]));
    assert.deepEqual((await readSavedDocuments(db,"alice")).map(item=>[item.id,item.url]),[[stored.id,curated]]);
    assert.deepEqual(await readKnownFreeDocumentSources(db,"bob"),[]);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM atlas_documents").get()?.n,1);
    const [modern]=await saveDiscoveredDocuments(db,"bob","bank merger integration",[{...document,url:canonical,provider:"World Bank",providerRecordUrl:canonical,fullTextUrl:undefined}]);
    const reverse=await readKnownFreeDocumentSources(db,"bob");assert.equal(reverse[0].id,modern.id);assert.equal(reverse[1].url,curated);assert.equal(reverse[1].id,modern.id+":curated");
  }finally{sqlite.close();}
});
