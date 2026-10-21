'use client';
import {useEffect,useMemo,useState,type CSSProperties} from 'react';
import {ArrowUpRight} from 'lucide-react';
import {computeCrawlMetrics,computeCrawlMetadata} from '../lib/crawl-metrics';
import {parseAgentReview,AGENT_REVIEW_PREFIX} from '../lib/crawl-supervision';
import './crawl-dashboard.css';

type MetricInput=NonNullable<Parameters<typeof computeCrawlMetrics>[0]>;
type DashboardJob=NonNullable<MetricInput['job']>&{id?:string;processed?:number;indexed?:number;queued?:number;errors?:number;maxPages?:number;maxDepth?:number};
type CrawlEvent={id:string;time:string;level:string;message:string;url?:string};
type DashboardProps={
 job?:DashboardJob|null;events:CrawlEvent[];currentUrl:string;fetching:boolean;replay:boolean;
 discovered:number;telemetryError?:boolean;pages?:MetricInput['pages'];frontier?:MetricInput['frontier'];
 edges?:Array<{source:string;target:string}>;query?:string;now?:number;snapshotLimited?:boolean;
};
const EMPTY:never[]=[];
const ACCENTS=['#65f5b6','#57d9ff','#fa79d9','#edf47a','#ffad78','#b1a1ff'];
const number=(value:number|null|undefined)=>value==null?'—':Math.round(value).toLocaleString();
const host=(url:string)=>{try{return new URL(url).hostname.replace(/^www\./,'')}catch{return ''}};
const path=(url:string)=>{try{const parsed=new URL(url);return parsed.pathname+parsed.search}catch{return url}};
const elapsedTime=(ms:number|null)=>{if(ms===null)return '—';const seconds=Math.floor(ms/1000);return `${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`};
const eventTime=(value:string)=>{const date=new Date(value);return Number.isNaN(date.getTime())?'—':date.toLocaleTimeString([],{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'})};
const colorFor=(term:string)=>{let hash=0;for(const char of term.toLowerCase())hash=(hash*31+char.charCodeAt(0))>>>0;return ACCENTS[hash%ACCENTS.length]};
const accent=(color:string)=>({'--telemetry-accent':color}) as CSSProperties;
const eventColor=(event:CrawlEvent)=>event.level==='error'?'#ffad78':event.level==='warn'?'#edf47a':/save|indexed|collected|complete/i.test(event.message)?'#65f5b6':/fetch|HTTP/.test(event.message)?'#57d9ff':/review|access|skip|blocked/i.test(event.message)?'#fa79d9':'#b1a1ff';
const decisionLabel=(decision:string)=>decision==='approve'?'approved':decision==='reject'?'rejected':'held';
const eventText=(message:string)=>{if(message.startsWith(AGENT_REVIEW_PREFIX)){const review=parseAgentReview(message);return review?`Chief ${decisionLabel(review.decision)} · ${host(review.url)}`:'Agent review · unavailable'}return message.replace(/^Stage · /,'').replace(/^HTTP (\d+) · (\d+) ms.*$/,'HTTP $1 · $2 ms')};

function Sparkline({values,color,label,fixedMax}:{values:number[];color:string;label:string;fixedMax?:number}){
 const maximum=fixedMax??Math.max(1,...values),x=(i:number)=>values.length===1?90:4+i*172/(values.length-1),y=(value:number)=>34-Math.min(1,value/maximum)*29;
 return <svg className="telemetry-sparkline" viewBox="0 0 180 40" role="img" aria-label={label}>
  <path d="M4 34H176 M4 18H176" className="telemetry-chart-grid"/>
  {values.length>1&&<polyline points={values.map((value,i)=>`${x(i)},${y(value)}`).join(' ')} fill="none" stroke={color} strokeWidth="1.7" vectorEffect="non-scaling-stroke"/>}
  {values.length>0&&<circle cx={x(values.length-1)} cy={y(values[values.length-1])} r="2.5" fill={color}/>}
  {!values.length&&<text x="90" y="25" textAnchor="middle" className="telemetry-empty-mark">—</text>}
 </svg>;
}

export default function CrawlDashboard({job,events,currentUrl,fetching,replay,discovered,telemetryError,pages=EMPTY,frontier=EMPTY,edges=EMPTY,query='',now,snapshotLimited=false}:DashboardProps){
 const [clock,setClock]=useState(Date.now());
 const live=job?.status==='running'&&!replay;
 useEffect(()=>{if(!live)return;setClock(Date.now());const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer)},[live,job?.id]);
 // The clock updates the elapsed label; metadata and frontier analysis only rerun when data changes.
 const metadata=useMemo(()=>computeCrawlMetadata({pages,query}),[pages,query]);
 const snapshot=useMemo(()=>{const sampledAt=now??Date.now();return {sampledAt,metrics:computeCrawlMetrics({pages,frontier,events,edges,query,job,now:sampledAt,replay},metadata)}},[metadata,pages,frontier,events,edges,query,job,now,replay]);
 const {metrics}=snapshot;
 const elapsed=metrics.elapsedMs===null?null:metrics.elapsedMs+(live&&now===undefined?Math.max(0,clock-snapshot.sampledAt):0);
 const wordsPerMinute=elapsed&&metrics.metadataWordCount?metrics.metadataWordCount*60000/elapsed:null;
 const orderedEvents=useMemo(()=>[...events].sort((a,b)=>a.time.localeCompare(b.time)||a.id.localeCompare(b.id)),[events]);
 const logEvents=orderedEvents.slice(-7),latest=orderedEvents.at(-1);
 const latestReview=useMemo(()=>{for(let i=orderedEvents.length-1;i>=0;i--){const review=parseAgentReview(orderedEvents[i].message);if(review)return review}return null},[orderedEvents]);
 const stageEvent=[...orderedEvents].reverse().find(event=>event.message.startsWith('Stage · '));
 const stage=stageEvent?.message.split(' · ')[1]||(fetching?'fetch':job?.status==='completed'?'complete':job?.status==='paused'?'paused':null);
 const stageMessage=stageEvent?.message.split(' · ').slice(2).join(' · ')||(latest?eventText(latest.message):undefined);
 const state=replay?'recorded':fetching?'fetching':live?'running':job?.status||'idle';
 const discoveredCount=useMemo(()=>{const urls=new Set([...pages.map(page=>page.url),...frontier.map(item=>item.url),...edges.flatMap(edge=>[edge.source,edge.target])]);return urls.size||discovered||0},[pages,frontier,edges,discovered]);
 const isRecorded=replay||Boolean(job&&job.status!=='running');
 const score=metrics.metadataMatch;
 const radarRows=metrics.pagesAnalyzed?metrics.termRows:[],radarCount=radarRows.length;
 const radarPoint=(i:number,radius:number)=>{const angle=-Math.PI/2+i*Math.PI*2/Math.max(1,radarCount);return [120+Math.cos(angle)*radius,86+Math.sin(angle)*radius]};
 const radarPolygon=(radius:number)=>radarRows.map((_,i)=>radarPoint(i,radius).join(',')).join(' ');
 const circumference=2*Math.PI*47;
 const logCount=job?events.length:null;
 const processed=job?job.processed??0:null,queued=job?job.queued??0:null,errors=job?job.errors??0:null;
 const budget=job?.maxPages?Math.min(100,Math.max(0,(job.processed||0)/job.maxPages*100)):0;
 const sampled=snapshotLimited||metrics.limited;
 const endReason=job?.status==='completed'?([...orderedEvents].reverse().find(event=>/page limit|queue exhausted|complete|no .*URLs/i.test(event.message))?.message.replace(/^Stage · complete · /,'')):undefined;
 const runHint=replay?'Recorded activity: use the timeline to inspect this crawl.':job?.status==='paused'?'Queue saved. Resume this crawl when you are ready.':job?.status==='completed'?endReason||'This crawl has finished. Review the saved pages in Research results.':live?fetching?'Fetching the current destination, then checking relevance and access.':'Waiting for the next queued request. Keep the workspace open to continue.':'Choose a research objective and starting documents to begin.';
 return <div className="crawl-telemetry"><section className="crawl-run-overview" aria-label="Crawl progress overview"><div><span className="eyebrow">{replay?'Recorded crawl':live?'Live crawl':job?'Crawl summary':'Crawl dashboard'}</span><p>{runHint}</p></div><dl><div><dt>Pages checked</dt><dd>{number(processed)}<small> / {number(job?.maxPages)}</small></dd></div><div><dt>Pages saved</dt><dd>{job?number(job.indexed??pages.length):'—'}</dd></div><div><dt>Queue remaining</dt><dd>{number(queued)}</dd></div><div><dt>Depth limit</dt><dd>{job?number(job.maxDepth):'—'}<small> links</small></dd></div></dl>{sampled&&<p className="crawl-sample-note">{replay?'Replay reflects the recorded pages available in this view.':'Run totals above are exact.'} Network and website charts use a bounded view; metadata charts cover {metrics.pagesAnalyzed.toLocaleString()} loaded pages. All saved pages remain in Results and Export.</p>}</section><section className="crawl-dashboard" aria-label="Crawl telemetry">
  <section className="telemetry-panel telemetry-log" aria-label="Crawl log" style={accent(ACCENTS[0])}>
   <header className="telemetry-heading"><h2>Crawl log</h2><span title="Events loaded for this view">{number(logCount)}{job?' events':''}</span></header>
   <ol className="telemetry-event-list" aria-label="Latest recorded crawl events">
    {logEvents.map(event=><li key={event.id} title={`${eventTime(event.time)} · ${eventText(event.message)}${event.url?` · ${event.url}`:''}`}><time dateTime={event.time}>{eventTime(event.time)}</time><span style={{color:eventColor(event)}}>{eventText(event.message)}</span></li>)}
   </ol>
   {!logEvents.length&&<p className="telemetry-empty">Actual crawl events appear here.</p>}
   <div className="telemetry-elapsed"><strong>{elapsedTime(elapsed)}</strong><span>{replay?'recorded elapsed':'elapsed since start'}</span><i className={live?'telemetry-status is-live':'telemetry-status'} title={state}/></div>
   <dl className="telemetry-counts"><div><dt>checked</dt><dd>{number(processed)}</dd></div><div><dt>queued</dt><dd className="telemetry-cyan">{number(queued)}</dd></div><div><dt>blocked / errors</dt><dd className="telemetry-orange">{number(errors)}</dd></div></dl>
   {telemetryError&&<p role="status" className="telemetry-warning">Status interrupted · retrying</p>}
  </section>

  <section className="telemetry-panel telemetry-sections" aria-label="Website section progress" style={accent(ACCENTS[1])}>
   <header className="telemetry-heading"><h2>Websites</h2><span>{job?metrics.websiteCount:'—'}{job?' sites':''}</span></header>
   <div className="telemetry-site-list">
    {metrics.websites.map((site,i)=><div className="telemetry-site" key={site.hostname} style={accent(ACCENTS[i%ACCENTS.length])}>
     <div><span title={site.hostname}>{site.hostname}</span><b title={`${site.checked} checked of ${site.discovered} discovered URLs; ${site.queued} queued, ${site.processing} in progress, ${site.failed} blocked or failed, ${site.discovered-site.checked-site.queued-site.processing} unvisited or unresolved`}>{site.checked}/{site.discovered}</b></div>
     <div className="telemetry-bar" role="progressbar" aria-label={`${site.hostname} URLs checked`} aria-valuemin={0} aria-valuemax={site.discovered} aria-valuenow={site.checked}><i style={{width:`${site.percent}%`}}/></div>
    </div>)}
    {!metrics.websites.length&&<p className="telemetry-empty">Website progress appears as URLs enter the queue.</p>}
   </div>
   <footer className="telemetry-footer"><span>{sampled?'visible checked / discovered':'checked / discovered'}</span><b>{job?number(discoveredCount):'—'} URLs</b></footer>
   {metrics.websiteCount>6&&<p className="telemetry-note">Top 6 of {metrics.websiteCount} websites</p>}
   <div className="telemetry-budget" title={`${number(processed)} of ${number(job?.maxPages)} page budget used`}><i style={{width:`${budget}%`}}/></div>
  </section>

  <section className="telemetry-panel telemetry-coverage" aria-label="Coverage radar" style={accent(ACCENTS[0])}>
   <header className="telemetry-heading"><h2>Topic coverage</h2><span>{metrics.pagesAnalyzed?`${metrics.pagesAnalyzed} pages`:'—'}</span></header>
   <svg className="telemetry-radar" viewBox="0 0 240 172" role="img" aria-label={radarRows.length?`Captured metadata coverage: ${radarRows.map(row=>`${row.term} in ${Math.round(row.sharePercent)} percent of pages`).join('; ')}.`:'No captured metadata to chart.'}>
    {radarCount>=3?[16,33,49].map(radius=><polygon key={radius} points={radarPolygon(radius)} className="telemetry-radar-grid"/>):[16,33,49].map(radius=><circle key={radius} cx="120" cy="86" r={radius} className="telemetry-radar-grid"/>)}
    {radarRows.map((row,i)=>{const [x,y]=radarPoint(i,49),[lx,ly]=radarPoint(i,67);return <g key={row.term}><path d={`M120 86L${x} ${y}`} className="telemetry-radar-grid"/><text x={lx} y={ly+4} textAnchor={lx<100?'end':lx>140?'start':'middle'} fill={colorFor(row.term)}>{row.term.length>6?`${row.term.slice(0,5)}…`:row.term}<title>{row.term}: {Math.round(row.sharePercent)}% of captured metadata</title></text></g>})}
    {radarCount>=3&&<polygon points={radarRows.map((row,i)=>radarPoint(i,49*row.sharePercent/100).join(',')).join(' ')} className="telemetry-radar-value"/>}
    {radarRows.map((row,i)=>{const [x,y]=radarPoint(i,49*row.sharePercent/100);return <g key={row.term}>{radarCount<3&&<path d={`M120 86L${x} ${y}`} stroke={colorFor(row.term)} strokeWidth="2"/>}<circle cx={x} cy={y} r="2.3" fill={colorFor(row.term)}/></g>})}
    {!radarCount&&<text x="120" y="91" textAnchor="middle" className="telemetry-empty-mark">—</text>}
   </svg>
   <p className="telemetry-note">Share of titles + summaries containing each term.</p>
   <footer className="telemetry-footer"><span>{radarRows.some(row=>row.origin==='query')?'Query + metadata terms':'Metadata terms'}</span><b>0–100%</b></footer>
  </section>

  <section className="telemetry-panel telemetry-heat" aria-label="Word heatmap" style={accent(ACCENTS[2])}>
   <header className="telemetry-heading"><h2>Word heat</h2><span>{metrics.pagesAnalyzed?number(metrics.metadataWordCount):'—'} words</span></header>
   <div className="telemetry-heat-grid" role="img" aria-label={metrics.columns.length?`Term presence across the latest ${metrics.columns.length} analyzed pages. Colored cells mean the term is present; dark cells mean absent. Counts cover ${metrics.pagesAnalyzed} analyzed pages.`:'No captured metadata available for word heatmap.'}>
    {radarRows.map(row=><div className="telemetry-heat-row" key={row.term} style={accent(colorFor(row.term))}>
     <span className="telemetry-term" title={row.term}>{row.term}</span><div className="telemetry-heat-cells">{row.hits.map((hit,i)=><i key={metrics.columns[i]?.id||i} className={hit?'is-present':''} title={`${row.term}: ${hit?'present':'absent'} in ${metrics.columns[i]?.title||metrics.columns[i]?.url||'page metadata'}`}/>)}</div><b title={`Present in ${row.documentsWithTerm} of ${metrics.pagesAnalyzed} captured pages`}>{row.documentsWithTerm}</b>
    </div>)}
    {!radarRows.length&&<p className="telemetry-empty">Term presence appears after metadata is captured.</p>}
   </div>
   <div className="telemetry-heat-legend"><span>older → newer</span><span>{metrics.columns.length?`${metrics.columns.length} pages`:'—'}</span></div>
   <div className="telemetry-word-rate"><span>metadata words / min</span><strong>{number(wordsPerMinute)}</strong></div>
   <p className="telemetry-note">Colored = present · {metrics.pagesAnalyzed} pages analyzed</p>
  </section>

  <section className="telemetry-panel telemetry-score" aria-label="Metadata match score" style={accent(ACCENTS[3])}>
   <header className="telemetry-heading"><h2>Query match</h2><span>{isRecorded?'recorded':live?'live':'—'}</span></header>
   <Sparkline values={metrics.matchHistory.slice(-24).map(point=>point.score)} color={ACCENTS[3]} fixedMax={100} label={metrics.matchHistory.length?'Query term match in captured metadata, oldest to newest.':'No query match samples.'}/>
   <svg className="telemetry-gauge" viewBox="0 0 160 127" role="img" aria-label={score===null?'Metadata match unavailable until query terms and captured pages exist.':`Metadata match ${Math.round(score)} percent. Mean query term coverage in captured page titles and summaries; this does not measure source quality.`}>
    <circle cx="80" cy="63" r="47" fill="none" stroke="#33352a" strokeWidth="7" strokeDasharray={`${circumference*.75} ${circumference*.25}`} strokeLinecap="round" transform="rotate(135 80 63)"/>
    {score!==null&&score>0&&<circle cx="80" cy="63" r="47" fill="none" stroke={ACCENTS[3]} strokeWidth="7" strokeDasharray={`${circumference*.75*score/100} ${circumference}`} strokeLinecap="round" transform="rotate(135 80 63)"/>}
    <text x="80" y="70" textAnchor="middle" className="telemetry-score-value">{score===null?'—':Math.round(score)}</text>
    <text x="42" y="116" textAnchor="middle" className="telemetry-gauge-tick">0</text><text x="119" y="116" textAnchor="middle" className="telemetry-gauge-tick">100</text>
   </svg>
   <p className="telemetry-score-caption">metadata match</p>
   <p className="telemetry-note">Mean query-term coverage.<br/>Based on titles + summaries.</p>
  </section>

  <section className="telemetry-panel telemetry-code" aria-label="Crawler event trace and fetch durations" style={accent(ACCENTS[4])}>
   <header className="telemetry-heading"><h2>Live review</h2><span className={live?'telemetry-live-label':''}>{state}</span></header>
   <div className="telemetry-trace" aria-label="Actual crawler state and latest agent review">
    <span className="telemetry-code-comment">// latest rule-based review</span>
    <div className="telemetry-chief"><span>Chief of Staff</span><b className={`review-${latestReview?.decision||'waiting'}`} title={latestReview?`${latestReview.reason} ${latestReview.url}`:'No recorded review yet'}>{latestReview?decisionLabel(latestReview.decision):'—'}</b></div>
    {latestReview?<dl className="telemetry-agents">{latestReview.agents.map(agent=><div key={agent.id} title={`${agent.name}: ${agent.reason}`}><dt>{agent.name}</dt><dd className={`verdict-${agent.verdict}`}>{agent.verdict}</dd></div>)}</dl>:<p className="telemetry-review-empty">Agent verdicts appear after a candidate is processed.</p>}
    <div className="telemetry-stage" title={stageMessage}><span className="telemetry-code-key">stage</span><span className="telemetry-code-punctuation">: </span><span className="telemetry-code-value">{stage?`"${stage}"`:'—'}</span></div>
   </div>
   {currentUrl?<a className="telemetry-destination" href={currentUrl} target="_blank" rel="noreferrer" title={`Current destination: ${currentUrl}`}><span>{host(currentUrl)}{path(currentUrl)}</span><ArrowUpRight size={11}/></a>:<span className="telemetry-destination telemetry-destination-empty">No current destination</span>}
   <div className="telemetry-latency-label"><span>HTTP duration</span><b>{number(metrics.latestFetchMs)}{metrics.latestFetchMs!==null?' ms':''}</b></div>
   <Sparkline values={metrics.fetchSamples.map(sample=>sample.durationMs)} color={ACCENTS[1]} label={metrics.fetchSamples.length?`Last ${metrics.fetchSamples.length} HTTP response durations; latest ${metrics.latestFetchMs} milliseconds.`:'No HTTP timing samples yet.'}/>
   <footer className="telemetry-footer"><span>{metrics.fetchSamples.length?`${metrics.fetchSamples.length} responses`:'No responses yet'}</span><b>{metrics.averageFetchMs!==null?`${number(metrics.averageFetchMs)} ms avg`:'—'}</b></footer>
  </section>
 </section></div>;
}
