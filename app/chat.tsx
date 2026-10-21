'use client';

import {useEffect,useRef,useState} from 'react';
import {ArrowUp,ArrowUpRight,Bookmark,ChevronRight,FileText,LoaderCircle,Search,Square,Layers} from 'lucide-react';
import type {Source} from './graph';
import type {StoredDiscoveredDocument} from '../lib/discovery-store';
import type {ProviderStatus} from '../lib/discovery';
import {resourceGuide} from '../lib/resource-guide';
import './chat.css';
import LoadingState from './loading-state';
import SearchStatus from './search-status';
import type {ResearchAnswer} from '../lib/research';
import {runDeepResearch} from '../lib/deep-research';

type Plan={query:string;sourceIds:string[];urls?:string[]};
type Message={id?:string;role:'user'|'assistant';content:string;documents?:StoredDiscoveredDocument[];pages?:any[];providers?:ProviderStatus[];plan?:Plan;searchedAt?:string;suggestedQueries?:string[];search?:ResearchAnswer['search'];supersededBy?:string};
type Props={sources:Source[];pages:any[];onCrawl:(ids:string[],query:string,urls?:string[])=>void;onInspect:(source:Source)=>void;onSave:(source:Source)=>void;bookmarks:string[];onRefresh:()=>void;onResults:()=>void};
const prompts=['AI in banking deployments','SaaS pricing and customer retention','Mergers and acquisitions case studies','Semiconductor supply chains','Apple latest quarterly report','Startup failure and unit economics'];
const host=(url:string)=>{try{return new URL(url).hostname.replace(/^www\./,'')}catch{return ''}};
const href=(url:string)=>{try{return /^https?:$/.test(new URL(url).protocol)?url:undefined}catch{return undefined}};
function Answer({content}:{content:string}){
 return <div className="research-answer">{content.split(/\n\s*\n/).map((paragraph,index)=><p key={index}>{paragraph.split(/(\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g).map((part,i)=>{const link=part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);return link?<a key={i} href={href(link[2])} target="_blank" rel="noreferrer">{link[1]}<ArrowUpRight size={10}/></a>:part})}</p>)}</div>;
}
export default function ResearchChat({onCrawl,onInspect,onSave,bookmarks,onRefresh,onResults}:Props){
 const [messages,setMessages]=useState<Message[]>([]),[draft,setDraft]=useState(''),[pending,setPending]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[historyError,setHistoryError]=useState(''),[selected,setSelected]=useState<string|null>(null),[historyLimit,setHistoryLimit]=useState(10),[lastPrompt,setLastPrompt]=useState('');
 const [pendingFrom,setPendingFrom]=useState<string|null>(null),[documentLimit,setDocumentLimit]=useState(24);
 const [refreshNeeded,setRefreshNeeded]=useState(false);
 const lastContinuation=useRef<string|undefined>(undefined);
 const [researchDepth,setResearchDepth]=useState(20),[deepRunning,setDeepRunning]=useState(false),[stopping,setStopping]=useState(false),[deepProgress,setDeepProgress]=useState({completed:0,budget:20,total:0}),[deepNote,setDeepNote]=useState('');
 const sequenceRef=useRef(false),stopSequence=useRef(false);
 const pendingRef=useRef(false),input=useRef<HTMLTextAreaElement>(null),end=useRef<HTMLDivElement>(null);
 const busy=pending||deepRunning;
 useEffect(()=>()=>{stopSequence.current=true},[]);
 useEffect(()=>{const controller=new AbortController();fetch('/api/chat',{signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error('Saved conversation could not be loaded.');return response.json() as Promise<{messages:Message[]}>}).then(data=>setMessages((data.messages||[]).filter((message:Message)=>['user','assistant'].includes(message.role)&&typeof message.content==='string'))).catch(cause=>{if(!controller.signal.aborted)setHistoryError(cause.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});return()=>controller.abort()},[]);
 useEffect(()=>{end.current?.scrollIntoView({block:'nearest'})},[messages.length,pending]);
 const latest=messages.findLast(message=>message.role==='assistant'&&message.providers);
 const requested=messages.find(message=>message.id===selected)||latest;
 const chosen=(requested?.supersededBy?messages.find(message=>message.id===requested.supersededBy):undefined)||requested;
 const documents=chosen?.documents||[];
 const captured=chosen?.pages||[];
 useEffect(()=>setDocumentLimit(24),[chosen?.id]);
 const continuationUsed=Boolean(chosen?.id&&messages.some(message=>message.search?.parentMessageId===chosen.id));
 async function send(text:string,continueFrom?:string):Promise<Message|undefined>{
  const message=text.trim();if(!message||pendingRef.current||loading)return;
  pendingRef.current=true;setPending(true);setError('');setRefreshNeeded(false);setDraft('');setSelected(continueFrom||null);setLastPrompt(message);setPendingFrom(continueFrom||null);lastContinuation.current=continueFrom;
  setMessages(previous=>[...previous,{id:`user-${Date.now()}`,role:'user',content:message}]);
  try{
   const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,...(continueFrom?{continueFrom}:{})})});
   const data=await response.json() as Partial<Message> & {answer?:string;error?:string};if(!response.ok||typeof data.answer!=='string'){if(response.status===409)setRefreshNeeded(true);throw new Error(data.error||'Search could not be completed.');}
   const answer=data.answer,id=data.id||`answer-${Date.now()}`;
   const result:Message={...data,id,role:'assistant',content:answer};
   setMessages(previous=>[...previous.map(old=>result.search&&old.search?.chainId===result.search.chainId?{...old,documents:[],supersededBy:id,search:{...old.search,canContinue:false}}:old),result]);setSelected(id);onRefresh();
   return result;
  }catch(cause){setError(cause instanceof Error?cause.message:'Could not reach the research service.');setDraft(message)}
  finally{pendingRef.current=false;setPending(false);setPendingFrom(null)}
 }
 async function search(text:string,continueFrom?:string,batches=researchDepth){
  if(!text.trim()||pendingRef.current||sequenceRef.current||loading)return;
  const parent=continueFrom?messages.find(message=>message.id===continueFrom):undefined;
  if(parent?.search)batches=Math.max(1,Math.min(batches,19-parent.search.batch));
  let canContinue=false;
  sequenceRef.current=true;stopSequence.current=false;setStopping(false);setDeepNote('');setDeepRunning(batches>1);setDeepProgress({completed:0,budget:batches,total:continueFrom?documents.length:0});
  try{
   const outcome=await runDeepResearch({query:text,continueFrom,batches,request:send,shouldStop:()=>stopSequence.current,onBatch:(result,completed)=>{canContinue=Boolean(result.search?.canContinue);setDeepProgress({completed,budget:batches,total:result.search?.totalDocuments??result.documents?.length??0})}});
   if(batches>1)setDeepNote(outcome.reason==='stopped'?'Stopped after saving the current batch. Continue from the collected documents below.':outcome.reason==='unavailable'?'Paused because all providers were unavailable. Your collection is saved; continue when sources recover.':outcome.reason==='error'?'Research paused. Completed batches are saved.':outcome.reason==='complete'?'This search reached its stopping point. Review source coverage and the collected documents.':canContinue?'Planned batches saved. Choose Continue deep research to keep searching this question.':'Research budget completed. The collection is saved; use a more specific question to investigate another angle.');
  }finally{sequenceRef.current=false;setDeepRunning(false);setStopping(false);input.current?.focus()}
 }
 async function refreshConversation(){
  try{const response=await fetch('/api/chat');if(!response.ok)throw new Error('Could not reload saved research.');const data=await response.json() as {messages?:Message[]};setMessages(data.messages||[]);setSelected(null);setError('');setRefreshNeeded(false)}catch(cause){setError(cause instanceof Error?cause.message:'Could not reload saved research.')}
 }
 function crawl(){if(chosen?.plan)onCrawl(chosen.plan.sourceIds,chosen.plan.query,chosen.plan.urls)}
 return <div className="research-workbench">
  <section className="research-conversation" aria-label="Research conversation">
   <div className="research-panel-title"><Search size={15}/><h2>Ask a research question</h2><span>Free public APIs</span></div>
   <div className="research-transcript" role="log" aria-live="polite" aria-busy={pending||loading}>
    {loading?<LoadingState label="Loading your conversation…" compact/>:null}
    {historyError&&<p role="alert" className="research-error">{historyError} Your new searches still work.</p>}
    {!messages.length&&!loading&&<div className="research-welcome"><span className="research-mark"><Search size={22}/></span><h3>What are you trying<br/>to understand?</h3><p>Name a topic, company, or use case. Search returns specific free documents with their abstracts and original links.</p><div className="research-prompts">{prompts.map(prompt=><button key={prompt} disabled={busy} onClick={()=>void search(prompt)}>{prompt}<ChevronRight size={13}/></button>)}</div></div>}
    {messages.length>historyLimit&&<button className="text-button history-more" onClick={()=>setHistoryLimit(value=>value+10)}>Show earlier messages</button>}
    {messages.slice(-historyLimit).map((message,i)=>message.role==='user'?<div className="research-question" key={message.id||i}>{message.content}</div>:<article className="research-reply" key={message.id||i}>
     {!message.providers?<details className="research-legacy"><summary>Earlier catalog recommendation</summary><Answer content={message.content}/><p>Run the question again to search for specific documents.</p></details>:<><div className="research-reply-label"><span>Research search</span><span>{message.searchedAt?new Date(message.searchedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):''}</span></div><Answer content={message.content.split(/\n\s*\n/)[0]}/>{(message.documents?.length||message.pages?.length)?<p className="research-evidence-note">Review the document abstracts and original links in the evidence panel. Results are saved to your workspace.</p>:null}<details className="research-search-notes"><summary>Search notes and source summaries</summary><Answer content={message.content}/></details><SearchStatus providers={message.providers} total={(message.search?.totalDocuments??message.documents?.length??0)+(message.pages?.length||0)} newCount={message.search?.newDocumentsCount}/>{(message.documents?.length||message.pages?.length)?<button className={`text-button research-view-documents ${chosen?.id===message.id?'selected':''}`} onClick={()=>setSelected(message.id||null)}>{chosen?.id===message.id?'Showing documents':'View documents from this search'}<ChevronRight size={12}/></button>:null}</>}
    </article>)}
    {pending&&<div className="research-searching"><LoadingState label={pendingFrom?'Searching the next batch of free documents…':'Searching free research and company filings…'} compact/></div>}
    {error&&<div className="research-error" role="alert"><p>{error}</p><button className="text-button" disabled={busy} onClick={()=>void (refreshNeeded?refreshConversation():search(lastPrompt,lastContinuation.current,1))}>{refreshNeeded?'Load latest results':'Retry search'}</button></div>}
    <div ref={end}/>
   </div>
   {(deepRunning||deepNote)&&<div className="deep-research-progress" role="status"><div><Layers size={15}/><strong>{deepRunning?'Deep research in progress':'Research checkpoint saved'}</strong>{deepRunning&&<button className="text-button" disabled={stopping} onClick={()=>{stopSequence.current=true;setStopping(true)}}><Square size={11}/>{stopping?'Finishing current batch…':'Stop after this batch'}</button>}</div>{deepRunning?<><progress aria-label="Research batches completed" value={deepProgress.completed} max={deepProgress.budget}/><p>{deepProgress.completed} of {deepProgress.budget} batches · {deepProgress.total} documents collected. Keep this workspace open; every batch is saved.</p></>:<p>{deepNote}</p>}</div>}
   <form className="research-composer" onSubmit={event=>{event.preventDefault();void search(draft)}}><div className="research-depth-control"><label htmlFor="research-question-input">Your question</label><label>Research depth<select aria-label="Research depth" value={researchDepth} disabled={busy} onChange={event=>setResearchDepth(Number(event.target.value))}><option value={1}>Quick · 1 batch</option><option value={6}>Deep · 6 batches</option><option value={20}>Extensive · up to 20 batches</option></select></label></div><div><textarea id="research-question-input" ref={input} value={draft} onChange={event=>setDraft(event.target.value)} placeholder="e.g. How is AI being used in banking?" rows={2} maxLength={2000} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void search(draft)}}}/><button className="research-send" type="submit" aria-label="Search research" aria-busy={busy} disabled={!draft.trim()||busy||loading}>{pending?<LoaderCircle size={16}/>:<ArrowUp size={17}/>}</button></div><small>Enter to search · Free sources only · {researchDepth===1?'One batch':`Up to ${researchDepth} batches across four indexes`}</small></form>
  </section>
  <aside className="research-documents" aria-label="Documents from your search">
   <div className="research-panel-title"><FileText size={15}/><h2>Documents</h2><span>{pending&&!pendingFrom?'—':documents.length+captured.length||'—'}</span></div>
   <div className="research-document-scroll">
    {pending&&!pendingFrom?<LoadingState label={`Finding documents for “${lastPrompt}”…`}/>:documents.length||captured.length?<><div className="research-document-context"><span>For your question</span><h3>{chosen?.plan?.query}</h3><p>Saved to Results automatically. Each link opens an individual document.</p></div><ol className="research-document-list">{documents.slice(0,documentLimit).map((document,index)=>{
     const guide=resourceGuide({...document,type:document.documentType},{query:document.query,origin:'page'});
     return <li key={document.id}><span className="document-number">{String(index+1).padStart(2,'0')}</span><div><div className="document-meta"><span>{document.provider}</span><span>{document.publishedAt?.slice(0,4)||document.documentType}</span><span>Free</span></div><h3><a href={href(document.url)} target="_blank" rel="noreferrer">{document.title}<ArrowUpRight size={13}/></a></h3><p className="document-purpose">{document.description||'No abstract supplied. Open the original document to review its content.'}</p><details className="document-guidance"><summary>How this helps & access evidence</summary><p>{guide.howToUse}</p><p>{document.accessBasis}</p><button className="text-button" onClick={()=>onInspect(document)}>Full abstract and details<ChevronRight size={11}/></button></details><div className="document-actions"><a href={href(document.url)} target="_blank" rel="noreferrer">{host(document.url)}<ArrowUpRight size={11}/></a><button title={bookmarks.includes(document.id)?'Remove from saved':'Save document'} aria-label={`${bookmarks.includes(document.id)?'Unsave':'Save'} ${document.title}`} aria-pressed={bookmarks.includes(document.id)} onClick={()=>onSave(document)}><Bookmark size={13} fill={bookmarks.includes(document.id)?'currentColor':'none'}/></button></div></div></li>
    })}</ol>{documents.length>documentLimit&&<button className="button collected-more" onClick={()=>setDocumentLimit(value=>value+24)}>Show more collected documents · {documentLimit} of {documents.length}</button>}{captured.length>0&&<div className="research-captured"><h3>From your crawls</h3>{captured.map(page=><a key={page.id} href={href(page.url)} target="_blank" rel="noreferrer">{page.title}<ArrowUpRight size={12}/></a>)}</div>}</>:chosen?.providers?<div className="research-document-empty"><Search size={25}/><h3>No documents in this batch</h3><p>For: {chosen.plan?.query}</p><SearchStatus providers={chosen.providers} total={0}/></div>:<div className="research-document-empty"><FileText size={25}/><h3>Evidence starts here</h3><p>Ask a question to find papers and reports. You’ll see what each document covers, why it matches, and where to read it for free.</p><div><span>01</span>Search a specific topic</div><div><span>02</span>Review the original documents</div><div><span>03</span>Crawl links and collect evidence</div></div>}
   </div>
   {chosen?.plan?.query&&(!pending||pendingFrom)&&<div className="research-search-more"><div><strong>{documents.length} documents collected</strong><p>{pendingFrom?'Checking more records and verifying free access…':chosen.search?`${chosen.search.candidatesChecked} records examined in batch ${chosen.search.batch+1}. Results are deduplicated.`:'Run the expanded search to look beyond this earlier batch.'}</p></div>{chosen.search?.canContinue&&!continuationUsed&&chosen.id?<button className="button primary" disabled={busy||loading} onClick={()=>void search('Find more',chosen.id,1)}>{pendingFrom?<LoaderCircle size={14}/>:<Search size={14}/>}Find more documents</button>:!chosen.search?<button className="button primary" disabled={busy||loading} onClick={()=>void search(chosen.plan!.query)}>Expand this search<Search size={14}/></button>:<p className="search-batch-note">{continuationUsed?'A newer batch is available in this conversation.':chosen.search.limitReached?'This search reached its batch limit. Refine the question to search a different angle.':'No further provider pages are available for this search.'}</p>}</div>}
   <div className="research-document-footer">{chosen?.search?.canContinue&&!continuationUsed&&chosen.id&&<button className="button" disabled={busy||loading} onClick={()=>void search('Find more',chosen.id,20)}><Layers size={13}/>Continue deep research</button>}<button className="button" onClick={onResults}>All research results<ArrowUpRight size={12}/></button><button className="button primary" disabled={busy||(!chosen?.plan?.sourceIds.length&&!chosen?.plan?.urls?.length)} onClick={crawl}>Crawl these documents<ChevronRight size={12}/></button></div>
  </aside>
 </div>;
}
