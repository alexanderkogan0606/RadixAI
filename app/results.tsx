'use client';

import {useEffect,useRef,useState} from 'react';
import {ArrowRight,ArrowUpRight,Bookmark,Check,ChevronDown,FileText,RefreshCw,Search,X} from 'lucide-react';
import type {Source} from './graph';
import {resourceGuide} from '../lib/resource-guide';
import './results.css';
import LoadingState from './loading-state';

type ResultPage=Source & {title:string;query:string;queryHistory?:string[];jobId:string;fetchedAt:string;collectedAt?:string;publishedAt?:string;validation:string;accessScope:string;accessBasis?:string;origin?:'discovery'|'crawl';documentType?:string;provider?:string;providerRecordUrl?:string;fullTextUrl?:string;quality?:{matchedTerms:string[]};saved?:boolean};
type ResultSet={pages:ResultPage[];total:number;rawTotal:number;crawlTotal:number;discoveryTotal:number;duplicateCount:number;filteredTotal:number;excludedAccessCount:number;excludedQualityCount:number;nextCursor:string|null};
type Props={jobs:{id:string;query:string}[];jobId:string;onJobChange:(id:string)=>void;bookmarks:string[];savingIds:Set<string>;onSave:(source:Source)=>void;onInspect:(source:Source)=>void;onAsk:()=>void;revision:number;savedOnly?:boolean};
const host=(url:string)=>{try{return new URL(url).hostname.replace(/^www\./,'')}catch{return url}};
const date=(value:string)=>{const parsed=new Date(value);return Number.isFinite(parsed.getTime())?parsed.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}):value};
const clean=(value:string)=>value.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();

function DocumentRow({page,saved,saving,onSave,onInspect}:{page:ResultPage;saved:boolean;saving:boolean;onSave:Props['onSave'];onInspect:Props['onInspect']}){
 const [expanded,setExpanded]=useState(false);
 const description=clean(page.description||''),long=description.length>360;
 const guide=resourceGuide({...page,type:page.documentType||page.type},{query:page.query,origin:'page'});
 const discovery=page.origin==='discovery',kind=page.documentType||(guide.kind==='research'?'Research':guide.kind==='case-study'?'Case study':guide.kind==='analysis'?'Analysis':guide.kind==='dataset'?'Dataset':'Web document');
 const published=page.publishedAt,accessBasis=page.accessBasis||'Catalogued free source; full article access has not been independently verified.';
 return <article className="research-document">
  <div className="document-main">
   <div className="document-meta"><span>{page.provider||host(page.url)}</span><span>{kind}</span>{published&&<time dateTime={published}>{date(published)}</time>}<span className="document-free"><Check size={11}/>{page.accessScope==='Provider evidence'?'Free access evidence':'Free source'}</span></div>
   <h3><a href={page.url} target="_blank" rel="noreferrer">{page.title||page.name}<ArrowUpRight size={15}/></a></h3>
   {description?<div className="document-summary"><p className={long&&!expanded?'summary-collapsed':''} id={`summary-${page.id}`}>{description}</p>{long&&<button className="document-text-action" onClick={()=>setExpanded(value=>!value)} aria-expanded={expanded} aria-controls={`summary-${page.id}`}>{expanded?'Show less':discovery?'Read full abstract':'Read full summary'}<ChevronDown size={12} className={expanded?'turned':''}/></button>}</div>:<p className="document-no-summary">No abstract was supplied. Open the document to review its findings.</p>}
   <div className="document-context-line"><span>{discovery?'Discovered document':'Captured page'}</span>{page.query&&<span className="document-question" title={page.query}>For: {page.query}</span>}</div>
   <details className="document-evidence">
    <summary>Evidence & reading notes<ChevronDown size={12}/></summary>
    <div className="document-evidence-body">
     <dl>
      <div><dt>How to use it</dt><dd>{guide.howToUse}</dd></div>
      <div><dt>Access evidence</dt><dd>{accessBasis}</dd></div>
      <div><dt>What was checked</dt><dd>{page.validation}</dd></div>
      <div><dt>Research question</dt><dd>{page.query||'General research'}</dd></div>
      {!!page.queryHistory&&page.queryHistory.length>1&&<div><dt>Also found for</dt><dd>{page.queryHistory.filter(question=>question!==page.query).join(' · ')}</dd></div>}
      <div><dt>Collected</dt><dd>{date(page.collectedAt||page.fetchedAt)}</dd></div>
      {page.providerRecordUrl&&<div><dt>Provider record</dt><dd><a href={page.providerRecordUrl} target="_blank" rel="noreferrer">View {page.provider||'source'} record<ArrowUpRight size={12}/></a></dd></div>}
     </dl>
     <button className="document-text-action" onClick={()=>onInspect(page)}>More resource details<ArrowRight size={12}/></button>
    </div>
   </details>
  </div>
  <div className="document-actions"><button className="icon-button document-save" title={saved?'Remove from saved':'Save resource'} aria-label={`${saved?'Unsave':'Save'} ${page.title||page.name}`} aria-pressed={saved} disabled={saving} onClick={()=>onSave(page)}><Bookmark size={16} fill={saved?'currentColor':'none'}/></button><a className="document-open" href={page.url} target="_blank" rel="noreferrer" aria-label={`Open ${page.title||page.name}`}>Read<ArrowUpRight size={13}/></a>{page.fullTextUrl&&page.fullTextUrl!==page.url&&<a className="document-full-text" href={page.fullTextUrl} target="_blank" rel="noreferrer">Full text<ArrowUpRight size={12}/></a>}</div>
 </article>;
}

export default function ResearchResults({jobs,jobId,onJobChange,bookmarks,savingIds,onSave,onInspect,onAsk,revision,savedOnly=false}:Props){
 const [search,setSearch]=useState(''),[query,setQuery]=useState(''),[data,setData]=useState<ResultSet|null>(null),[loading,setLoading]=useState(true),[more,setMore]=useState(false),[error,setError]=useState(''),[reload,setReload]=useState(0),[loadedRevision,setLoadedRevision]=useState(revision);
 const controller=useRef<AbortController|null>(null),morePending=useRef(false);
 const savedRevision=savedOnly?bookmarks.join('|'):'';
 useEffect(()=>{const timer=setTimeout(()=>setQuery(search.trim()),250);return()=>clearTimeout(timer)},[search]);
 const selectedJob=jobs.find(job=>job.id===jobId);

 useEffect(()=>{
  controller.current?.abort();const current=new AbortController();controller.current=current;morePending.current=false;setMore(false);setLoading(true);setError('');setData(null);
  const params=new URLSearchParams({q:query});if(jobId)params.set('jobId',jobId);if(savedOnly)params.set('saved','true');
  fetch(`/api/results?${params}`,{signal:current.signal}).then(async response=>{const result=await response.json() as ResultSet & {error?:string};if(!response.ok)throw new Error(result.error||'Research results could not be loaded.');return result}).then(result=>{if(!current.signal.aborted){setData(result);setLoadedRevision(revision)}}).catch(cause=>{if(!current.signal.aborted)setError(cause.message)}).finally(()=>{if(!current.signal.aborted)setLoading(false)});
  return()=>current.abort();
 },[jobId,query,reload,savedOnly,savedRevision]);

 async function loadMore(){
  if(!data?.nextCursor||morePending.current)return;morePending.current=true;setMore(true);setError('');
  const current=controller.current;const params=new URLSearchParams({q:query,cursor:data.nextCursor});if(jobId)params.set('jobId',jobId);if(savedOnly)params.set('saved','true');
  try{const response=await fetch(`/api/results?${params}`,{signal:current?.signal});const result=await response.json() as ResultSet & {error?:string};if(!response.ok)throw new Error(result.error||'More results could not be loaded.');if(!current?.signal.aborted)setData(previous=>previous?{...result,pages:[...previous.pages,...result.pages.filter(page=>!previous.pages.some(item=>item.id===page.id))]}:result)}catch(cause){if(!current?.signal.aborted)setError(cause instanceof Error?cause.message:'More results could not be loaded.')}finally{if(!current?.signal.aborted){morePending.current=false;setMore(false)}}
 }

 const hidden=(data?.excludedAccessCount||0)+(data?.excludedQualityCount||0);
 return <section className="research-results" aria-label={savedOnly?'Saved research documents':'Research documents'}>
  <header className="results-intro"><div><h2>{selectedJob?.query||(savedOnly?'Your reading list':'Research worth opening.')}</h2><p>{savedOnly?'The documents you saved, ready to return to.':'Specific documents found for your questions, with summaries and direct links to the evidence.'}</p></div><div className="results-overview"><span className="results-free-label"><Check size={12}/>Free resources</span><strong>{loading?'—':(data?.filteredTotal??0).toLocaleString()}<span>{query?' matching':savedOnly?' saved':' resources'}</span></strong></div></header>
  <div className="results-toolbar"><div className="search"><Search size={16}/><input aria-label="Search research documents" placeholder="Search documents, questions, or URLs…" maxLength={300} value={search} onChange={event=>setSearch(event.target.value)}/>{search&&<button aria-label="Clear search" onClick={()=>setSearch('')}><X size={14}/></button>}</div><select aria-label="Filter research by crawl" value={jobId} onChange={event=>onJobChange(event.target.value)}><option value="">All research</option>{jobs.map(job=><option key={job.id} value={job.id}>{job.query}</option>)}</select><button className="button" onClick={()=>setReload(value=>value+1)} disabled={loading} title="Refresh research results"><RefreshCw size={13}/><span>Refresh</span></button></div>
  {loadedRevision!==revision&&!loading&&<div className="results-update" role="status"><span>Your research has new records.</span><button onClick={()=>setReload(value=>value+1)}>Update results<ArrowRight size={12}/></button></div>}
  <div className="results-list-heading"><span>{savedOnly?'Saved documents':'Documents & reports'}</span><span>Newest collected first</span></div>
  {!loading&&data&&(hidden>0||data.duplicateCount>0)&&<details className="results-filter-details"><summary>{hidden>0?`${hidden.toLocaleString()} ${hidden===1?'record':'records'} withheld by quality or access checks`:'Repeated URLs combined'}<ChevronDown size={12}/></summary><div><p>{data.discoveryTotal.toLocaleString()} discovered documents and {data.crawlTotal.toLocaleString()} captured pages in your research archive.</p>{data.duplicateCount>0&&<p>{data.duplicateCount.toLocaleString()} repeated URL records are combined so each resource appears once.</p>}{data.excludedQualityCount>0&&<p>{data.excludedQualityCount.toLocaleString()} records in this view were withheld because their metadata indicates a gate, navigation page, insufficient content, or poor relevance to the original question.</p>}{data.excludedAccessCount>0&&<p>{data.excludedAccessCount.toLocaleString()} records in this view were withheld because free access is unconfirmed.</p>}<p>The original records remain in your archive.</p></div></details>}
  {error&&<div className="results-error" role="alert"><span>{error}</span><button className="button" onClick={()=>data?loadMore():setReload(value=>value+1)}>Try again</button></div>}
  {loading?<LoadingState label="Loading your research documents…"/>:data?.pages.length?<><div className="document-list" aria-busy={more}>{data.pages.map(page=><DocumentRow key={page.id} page={page} saved={bookmarks.includes(page.id)} saving={savingIds.has(page.id)} onSave={onSave} onInspect={onInspect}/>)}</div><div className="results-pagination"><span role="status" aria-live="polite">{data.pages.length.toLocaleString()} of {data.filteredTotal.toLocaleString()} resources</span>{data.nextCursor&&<button className="button" disabled={more} onClick={loadMore}>{more?'Loading…':'Load more'}<ArrowRight size={13}/></button>}</div></>:!error?<div className="results-empty"><FileText size={25}/><h3>{query?'No documents match this search':savedOnly?'Your reading list is empty':jobId?'No relevant free documents in this crawl':'Find your first research documents'}</h3><p>{query?'Try a shorter phrase or select All research.':savedOnly?'Save a document from Research to keep it here.':'Ask a specific question to search for papers and reports. Relevant free documents will appear here with their source evidence.'}</p><button className="button" onClick={query?()=>setSearch(''):onAsk}>{query?'Clear search':'Search for research'}<ArrowRight size={13}/></button></div>:null}
  <p className="results-footnote">Discovery records contain provider metadata; crawl records contain captured page metadata. Open the original to assess the full document.</p>
 </section>;
}
