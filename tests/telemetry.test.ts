import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
// @ts-expect-error Node's native TypeScript runner requires the explicit extension.
import {readTelemetry} from "../lib/telemetry.ts";

function database(){
  const sqlite=new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE atlas_jobs(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,processed INTEGER,indexed INTEGER,errors INTEGER,max_pages INTEGER,max_depth INTEGER,created_at TEXT,updated_at TEXT);
    CREATE TABLE atlas_events(id TEXT PRIMARY KEY,user_id TEXT,job_id TEXT,time TEXT,level TEXT,message TEXT,url TEXT);
    CREATE TABLE atlas_queue(id TEXT PRIMARY KEY,user_id TEXT,job_id TEXT,url TEXT,status TEXT,depth INTEGER);
    INSERT INTO atlas_jobs VALUES('alice-run','alice','running',4,2,1,20,2,'2026-10-21','2026-10-21');
    INSERT INTO atlas_jobs VALUES('bob-run','bob','running',9,7,1,30,3,'2026-10-21','2026-10-21');
    INSERT INTO atlas_events VALUES('alice-event','alice','alice-run','2026-10-21T10:00:00Z','info','Fetching public research','https://public.org/article');
    INSERT INTO atlas_events VALUES('bob-event','bob','bob-run','2026-10-21T10:00:00Z','info','Secret research','https://private.org/secret');
    INSERT INTO atlas_events VALUES('mismatched-event','bob','alice-run','2026-10-21T11:00:00Z','info','Secret mismatched event','https://private.org/mismatch');
    INSERT INTO atlas_queue VALUES('active','alice','alice-run','https://public.org/article','processing',1);
    INSERT INTO atlas_queue VALUES('pending','alice','alice-run','https://public.org/next','queued',2);
    INSERT INTO atlas_queue VALUES('done','alice','alice-run','https://public.org/start','done',0);
    INSERT INTO atlas_queue VALUES('secret-active','bob','bob-run','https://private.org/secret','processing',0);
    INSERT INTO atlas_queue VALUES('mismatched-active','bob','alice-run','https://private.org/mismatch','processing',1);`);
  let batches=0;
  class Prepared{
    sql:string;params:(string|number|null)[];
    constructor(sql:string,params:(string|number|null)[]=[]){this.sql=sql;this.params=params}
    bind(...params:(string|number|null)[]){return new Prepared(this.sql,params)}
    async first(){return sqlite.prepare(this.sql).get(...this.params)||null}
    async all(){return {results:sqlite.prepare(this.sql).all(...this.params),success:true}}
  }
  const db={prepare:(sql:string)=>new Prepared(sql),batch:async(commands:Prepared[])=>{batches++;return Promise.all(commands.map(command=>command.all()))}} as unknown as D1Database;
  return {sqlite,db,batches:()=>batches};
}

test("Telemetry excludes another owner's events, active URL and counts even with a matching job ID",async()=>{
  const {sqlite,db,batches}=database();
  try{
    const result=await readTelemetry(db,"alice","alice-run");assert.ok(result);
    assert.equal(result.job.id,"alice-run");assert.equal(result.job.maxPages,20);assert.equal(result.job.processed,4);
    assert.deepEqual(result.events.map(event=>event.id),["alice-event"]);
    assert.equal(result.current?.url,"https://public.org/article");
    assert.deepEqual(Object.fromEntries(result.queue.map(row=>[row.status,row.count])),{done:1,processing:1,queued:1});
    assert.ok(!JSON.stringify(result).includes("private.org"));assert.ok(!JSON.stringify(result).includes("user_id"));
    assert.ok(Number.isFinite(Date.parse(result.observedAt)));assert.equal(batches(),1);
    assert.equal(await readTelemetry(db,"bob","alice-run"),null);
    assert.equal(await readTelemetry(db,"alice","bob-run"),null);
    assert.equal(await readTelemetry(db,"alice","' OR 1=1 --"),null);
    assert.equal(batches(),1,"Missing or foreign jobs must not query their event or frontier details");
  }finally{sqlite.close()}
});

test("Telemetry returns the newest 80 events and clears the current URL once processing ends",async()=>{
  const {sqlite,db}=database();
  try{
    const insert=sqlite.prepare("INSERT INTO atlas_events VALUES(?,'alice','alice-run','2026-10-21T12:00:00Z','success','HTTP 200 · 23 ms · Indexed metadata',NULL)");
    for(let i=0;i<100;i++)insert.run(`event-${String(i).padStart(3,"0")}`);
    sqlite.exec("UPDATE atlas_queue SET status='done' WHERE user_id='alice' AND status='processing'");
    const result=await readTelemetry(db,"alice","alice-run");assert.ok(result);
    assert.equal(result.events.length,80);assert.equal(result.events[0].id,"event-099");assert.equal(result.events[79].id,"event-020");
    assert.equal(result.current,null);assert.deepEqual(Object.fromEntries(result.queue.map(row=>[row.status,row.count])),{done:2,queued:1});
    assert.equal(await readTelemetry(db,"alice","missing-run"),null);
  }finally{sqlite.close()}
});
