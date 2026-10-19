'use client';

import {useEffect,useRef,useState} from 'react';
import {ArrowRight,ArrowUpRight,Bookmark,Check,FileText,RefreshCw,Search} from 'lucide-react';
import type {Source} from './graph';
import {resourceGuide} from '../lib/resource-guide';
import './results.css';

type ResultPage=Source & {title:string;query:string;jobId:string;fetchedAt:string;validation:string;accessScope:string};
type ResultSet={pages:ResultPage[];total:number;filteredTotal:number;excludedAccessCount:number;nextCursor:string|null};
type Props={jobs:any[];jobId:string;onJobChange:(id:string)=>void;bookmarks:string[];savingIds:Set<string>;onSave:(source:Source)=>void;onInspect:(source:Source)=>void;onAsk:()=>void;revision:number};
const host=(url:string)=>{try{return new URL(url).hostname.replace(/^www\./,'')}catch{return url}};
const date=(value:string)=>new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});

export default function ResearchResults({jobs,jobId,onJobChange,bookmarks,savingIds,onSave,onInspect,onAsk,revision}:Props){
 const [search,setSearch]=useState(''),[query,setQuery]=useState(''),[data,setData]=useState<ResultSet|null>(null),[loading,setLoading]=useState(true),[more,setMore]=useState(false),[error,setError]=useState(''),[reload,setReload]=useState(0),[loadedRevision,setLoadedRevision]=useState(revision);
 const controller=useRef<AbortController|null>(null),morePending=useRef(false);
 useEffect(()=>{const timer=setTimeout(()=>setQuery(search.trim()),250);return()=>clearTimeout(timer)},[search]);
 const selectedJob=jobs.find(job=>job.id===jobId);

 useEffect(()=>{
  controller.current?.abort();const current=new AbortController();controller.current=current;morePending.current=false;setMore(false);setLoading(true);setError('');setData(null);
  const params=new URLSearchParams({q:query});if(jobId)params.set('jobId',jobId);
  fetch(`/api/results?${params}`,{signal:current.signal}).then(async response=>{const result=await response.json() as ResultSet & {error?:string};if(!response.ok)throw new Error(result.error||'Research results could not be loaded.');return result}).then(result=>{if(!current.signal.aborted){setData(result);setLoadedRevision(revision)}}).catch(cause=>{if(!current.signal.aborted)setError(cause.message)}).finally(()=>{if(!current.signal.aborted)setLoading(false)});
  return()=>current.abort();
 },[jobId,query,reload]);

 async function loadMore(){
  if(!data?.nextCursor||morePending.current)return;morePending.current=true;setMore(true);setError('');
  const current=controller.current;const params=new URLSearchParams({q:query,cursor:data.nextCursor});if(jobId)params.set('jobId',jobId);
  try{const response=await fetch(`/api/results?${params}`,{signal:current?.signal});const result=await response.json() as ResultSet & {error?:string};if(!response.ok)throw new Error(result.error||'More results could not be loaded.');if(!current?.signal.aborted)setData(previous=>previous?{...result,pages:[...previous.pages,...result.pages.filter((page:ResultPage)=>!previous.pages.some(item=>item.id===page.id))]}:result)}catch(cause){if(!current?.signal.aborted)setError(cause instanceof Error?cause.message:'More results could not be loaded.')}finally{if(!current?.signal.aborted){morePending.current=false;setMore(false)}}
 }

 return <section className="research-results" aria-label="Collected research">
  <div className="results-intro">
   <div><span className="results-eyebrow">YOUR RESEARCH / COLLECTED EVIDENCE</span><h2>{selectedJob?.query||'All your research, in one place.'}</h2><p>Start with a resource’s purpose, see how to use it, then open the original to review the evidence.</p></div>
   <div className="results-overview"><span className="free-only-badge"><Check size={12}/>Free sources only</span><strong>{loading?'—':(data?.filteredTotal??0).toLocaleString()}</strong><span>{query?'matching links':jobId?'links in this crawl':'collected links'}</span></div>
  </div>
  <div className="results-toolbar">
   <div className="search"><Search size={15}/><input aria-label="Search collected research" placeholder="Search titles, topics, or website URLs…" value={search} onChange={event=>setSearch(event.target.value)}/>{search&&<button aria-label="Clear result search" onClick={()=>setSearch('')}>×</button>}</div>
   <select aria-label="Filter results by crawl" value={jobId} onChange={event=>onJobChange(event.target.value)}><option value="">All crawls</option>{jobs.map(job=><option key={job.id} value={job.id}>{job.query}</option>)}</select>
   <button className="button" onClick={()=>setReload(value=>value+1)} disabled={loading}><RefreshCw size={13}/>Refresh</button>
  </div>
  {loadedRevision!==revision&&!loading&&<div className="results-update" role="status">New pages have been collected.<button onClick={()=>setReload(value=>value+1)}>Update results<ArrowRight size={12}/></button></div>}
  {!!data?.excludedAccessCount&&<p className="results-access-note">{data.excludedAccessCount.toLocaleString()} captured {data.excludedAccessCount===1?'link is':'links are'} hidden because free access is unconfirmed or the source includes paid content. Your archive is preserved.</p>}
  <div className="results-list-heading"><span><FileText size={14}/>Collected resources</span><span>Newest first · page summaries</span></div>
  {error&&<div className="results-error" role="alert"><span>{error}</span><button className="button" onClick={()=>data?loadMore():setReload(value=>value+1)}>Try again</button></div>}
  {loading?<div className="results-loading" role="status">Loading your research…</div>:data?.pages.length?<>
   <div className="result-grid" aria-busy={more}>{data.pages.map(page=>{
    const guide=resourceGuide(page,{query:page.query,origin:'page'});const saved=bookmarks.includes(page.id);const directContext=guide.kind==='homepage'||guide.kind==='navigation';
    return <article className="result-card" key={page.id}>
     <div className="result-card-meta"><span>{guide.kind.replace('-',' ')}</span><span>{host(page.url)}</span><span className="result-free">Free source</span></div>
     <h3><a href={page.url} target="_blank" rel="noreferrer">{page.title||page.name}<ArrowUpRight size={15}/></a></h3>
     <div className="result-guidance"><div><span>Purpose</span><p>{guide.purpose}</p></div><div><span>How to use it</span><p>{guide.howToUse}</p></div></div>
     <div className="result-relevance"><span className={guide.matchedTerms.length&&!directContext?'matched':''}>{guide.matchedTerms.length&&!directContext?'Metadata overlap':'Context to review'}</span><p>{guide.relevance}</p></div>
     <details className="result-evidence"><summary>Captured summary & research context</summary><p>{page.description||'No description was captured. Open the original to assess its content.'}</p><dl><div><dt>Research question</dt><dd>{page.query||'General research'}</dd></div><div><dt>Collected</dt><dd>{date(page.fetchedAt)}</dd></div><div><dt>Evidence basis</dt><dd>{guide.evidenceLabel}</dd></div><div><dt>Access basis</dt><dd>Catalogued free source; full article access has not been independently verified.</dd></div></dl></details>
     <div className="result-card-actions"><a className="button result-open" href={page.url} target="_blank" rel="noreferrer">Open resource<ArrowUpRight size={13}/></a><button className="button quiet" onClick={()=>onInspect(page)}>Details</button><button className="icon-button result-save" title={saved?'Remove from saved':'Save resource'} aria-label={`${saved?'Unsave':'Save'} ${page.title||page.name}`} aria-pressed={saved} disabled={savingIds.has(page.id)} onClick={()=>onSave(page)}><Bookmark size={15} fill={saved?'currentColor':'none'}/></button></div>
    </article>
   })}</div>
   <div className="results-pagination"><span role="status" aria-live="polite">{data.pages.length.toLocaleString()} of {data.filteredTotal.toLocaleString()} links shown</span>{data.nextCursor&&<button className="button" disabled={more} onClick={loadMore}>{more?'Loading…':'Load more resources'}<ArrowRight size={13}/></button>}</div>
  </>:!error?<div className="results-empty"><FileText size={26}/><h3>{query?'No matching free resources':jobId?'No free resources collected in this crawl yet':'Your research will come together here'}</h3><p>{query?'Try a shorter search or select all crawls.':'Ask a question, choose free sources, and run a crawl. Each collected link will include its purpose and guidance.'}</p><button className="button primary" onClick={query?()=>setSearch(''):onAsk}>{query?'Clear search':'Find free sources'}<ArrowRight size={14}/></button></div>:null}
  <p className="results-footnote">Guidance is based on source descriptions and captured metadata. It helps you decide what to read; it does not claim the full article has been analyzed.</p>
 </section>;
}
