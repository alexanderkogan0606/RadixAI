'use client';
import {useEffect,useMemo,useState} from 'react';
import {Activity,ArrowUpRight,Check,Globe,Radio} from 'lucide-react';

type Event={id:string;time:string;level:string;message:string;url?:string};
const host=(url:string)=>{try{return new URL(url).hostname.replace(/^www\./,'')}catch{return 'Waiting for a request'}};

export default function CrawlDashboard({job,events,currentUrl,fetching,replay,discovered,telemetryError}:{job:any;events:Event[];currentUrl:string;fetching:boolean;replay:boolean;discovered:number;telemetryError?:boolean}){
 const [clock,setClock]=useState(Date.now());
 useEffect(()=>{if(job?.status!=='running')return;const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer)},[job?.status]);
 const requests=useMemo(()=>events.flatMap(event=>{const match=event.message.match(/^HTTP (\d+) · (\d+) ms/);return match?[{...event,status:Number(match[1]),duration:Number(match[2])}]:[]}).reverse().slice(-24),[events]);
 const durations=requests.map(event=>event.duration),maxDuration=Math.max(1,...durations);
 const points=durations.map((duration,i)=>`${10+i*180/Math.max(1,durations.length-1)},${45-duration/maxDuration*35}`).join(' ');
 const elapsed=job?Math.max(0,((job.status==='running'?clock:Date.parse(job.updatedAt))-Date.parse(job.createdAt))/1000):0;
 const percent=Math.min(100,((job?.processed||0)/(job?.maxPages||1))*100);
 const state=replay?'Recorded replay':fetching?'Fetching page':job?.status==='running'?'Waiting for next request':job?.status==='paused'?'Crawler paused':job?.status==='completed'?'Crawl complete':'Ready to crawl';
 const recent=events.filter(event=>event.url&&event.message.startsWith('Fetching')).slice(0,3);
 return <section className="crawl-dashboard" aria-label="Crawl status dashboard">
  <div className="monitor-request">
   <div className="monitor-label"><Radio size={13}/><span>Crawler status</span><span className={fetching||replay?'monitor-live':''}>{state}</span></div>
   <strong title={currentUrl}>{currentUrl?host(currentUrl):'No active destination'}</strong>
   <p className="monitor-path" title={currentUrl}>{currentUrl?new URL(currentUrl).pathname:'Start a crawl or replay a previous run.'}</p>
   {currentUrl&&<a href={currentUrl} target="_blank" rel="noreferrer">Open destination<ArrowUpRight size={11}/></a>}
   {telemetryError&&<small role="status" className="monitor-warning">Live status interrupted. Retrying…</small>}
  </div>
  <div className="monitor-counters">
   <div className="monitor-label"><Check size={13}/><span>Collection</span><span>{job?.maxPages||0} page limit</span></div>
   <div className="monitor-count-grid"><span><b>{job?.indexed||0}</b>Collected</span><span><b>{job?.queued||0}</b>Queued</span><span><b>{job?.errors||0}</b>Errors / blocked</span></div>
   <div className="monitor-progress" role="progressbar" aria-label="Page budget used" aria-valuemin={0} aria-valuemax={job?.maxPages||1} aria-valuenow={job?.processed||0}><i style={{width:`${percent}%`}}/></div>
   <small>{job?.processed||0} checked · {discovered.toLocaleString()} URLs discovered</small>
  </div>
  <div className="monitor-latency">
   <div className="monitor-label"><Activity size={13}/><span>Fetch duration</span><span>{durations.length?`${durations.at(-1)?.toLocaleString()} ms`:'No samples'}</span></div>
   {durations.length?<svg viewBox="0 0 200 54" role="img" aria-label={`Last ${durations.length} successful HTTP responses; latest took ${durations.at(-1)} milliseconds.`}><path d="M10 45H190 M10 25H190" stroke="#272c2a" fill="none"/>{durations.length>1&&<polyline points={points} fill="none" stroke="#aac7b8" strokeWidth="1.4"/>}{durations.map((duration,i)=><circle key={i} cx={10+i*180/Math.max(1,durations.length-1)} cy={45-duration/maxDuration*35} r="1.9" fill={requests[i].status<400?'#aac7b8':'#dfac92'}/>)}</svg>:<p className="monitor-no-data">Request timings appear here as pages are fetched.</p>}
   <small>{Math.floor(elapsed/60)}m {Math.floor(elapsed%60)}s since start · {requests.length} recent responses</small>
  </div>
  <div className="monitor-hosts">
   <div className="monitor-label"><Globe size={13}/><span>Recent destinations</span></div>
   {recent.length?<ol>{recent.map(event=><li key={event.id}><span title={event.url}>{host(event.url!)}</span><time>{new Date(event.time).toLocaleTimeString([],{hour12:false})}</time></li>)}</ol>:<p className="monitor-no-data">Actual request destinations, in order.</p>}
   <small>{replay?'Replaying saved activity':job?.status==='running'?'Workspace must stay open to run':'Queue and history saved to your workspace'}</small>
  </div>
 </section>;
}
