/** Read-only live crawl telemetry, scoped to the owner in every query. */
export async function readTelemetry(db:D1Database,user:string,id:string){
  const job=await db.prepare("SELECT id,status,processed,indexed,errors,max_pages AS maxPages,max_depth AS maxDepth,created_at AS createdAt,updated_at AS updatedAt FROM atlas_jobs WHERE id=? AND user_id=?").bind(id,user).first<Record<string,unknown>>();
  if(!job)return null;
  const [events,current,counts,scheduling]=await db.batch<Record<string,unknown>>([
    db.prepare("SELECT id,job_id AS jobId,time,level,message,url FROM atlas_events WHERE job_id=? AND user_id=? ORDER BY time DESC,id DESC LIMIT 80").bind(id,user),
    db.prepare("SELECT COALESCE(json_extract(fetch_state,'$.document.url'),url) AS url,status,depth FROM atlas_queue WHERE job_id=? AND user_id=? AND status='processing' LIMIT 1").bind(id,user),
    db.prepare("SELECT status,COUNT(*) AS count FROM atlas_queue WHERE job_id=? AND user_id=? GROUP BY status").bind(id,user),
    db.prepare("SELECT COUNT(*) AS pending,COALESCE(SUM(CASE WHEN next_attempt_at>? THEN 1 ELSE 0 END),0) AS deferred,MIN(next_attempt_at) AS nextAttemptAt FROM atlas_queue WHERE job_id=? AND user_id=? AND status='queued'").bind(Date.now(),id,user),
  ]);
  return {job,events:events.results,current:current.results[0]||null,queue:counts.results,scheduling:scheduling.results[0],observedAt:new Date().toISOString()};
}
