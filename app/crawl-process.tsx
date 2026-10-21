'use client';

type ProcessEvent={id:string;time:string;message:string;url?:string};
const steps=[['objective','Objective'],['sources','Sources'],['access','Access'],['fetch','Fetch'],['extract','Extract'],['review','Review'],['save','Save'],['complete','Complete']] as const;
export default function CrawlProcess({job,events,replay,hasPages}:{job?:{status:string};events:ProcessEvent[];replay:boolean;hasPages:boolean}){
 const observed=[...events].sort((a,b)=>b.time.localeCompare(a.time)||b.id.localeCompare(a.id)).find(event=>/^Stage · (objective|sources|access|fetch|extract|review|save|complete) · /.test(event.message));
 const code=observed?.message.split(' · ')[1];
 const selected=!job?-1:job.status==='completed'&&!replay?7:code?steps.findIndex(step=>step[0]===code):hasPages?6:1;
 const status=replay?'Recorded stages':job?.status==='paused'?'Paused':job?.status==='completed'?'Run complete':job?'Processing live':'Ready';
 return <div className="crawl-process" aria-label="Crawl processing stages">
  <ol>{steps.map(([id,label],index)=><li key={id} data-state={index===selected?'active':index<selected?'done':'pending'} aria-current={index===selected?'step':undefined} title={index===selected?observed?.message.split(' · ').slice(2).join(' · ')||status:label}><span>{String(index+1).padStart(2,'0')}</span>{label}</li>)}</ol>
  <div className="process-context"><span className={job?.status==='running'&&!replay?'process-live':''}>{status}</span><span>{observed?observed.message.split(' · ').slice(2).join(' · '):job?.status==='completed'?'Recorded results and decisions are available below.':job?'The next request starts from the saved queue.':'Choose an objective and starting documents.'}</span></div>
 </div>;
}
