'use client';

import {useEffect,useRef,useState} from 'react';
import {ArrowUp,ArrowUpRight,Bookmark,Check,ChevronRight,FileText,LoaderCircle,Search,TriangleAlert} from 'lucide-react';
import type {Source} from './graph';
import type {StoredDiscoveredDocument} from '../lib/discovery-store';
import type {ProviderStatus} from '../lib/discovery';
import {resourceGuide} from '../lib/resource-guide';
import './chat.css';
import LoadingState from './loading-state';

type Plan={query:string;sourceIds:string[];urls?:string[]};
type Message={id?:string;role:'user'|'assistant';content:string;documents?:StoredDiscoveredDocument[];pages?:any[];providers?:ProviderStatus[];plan?:Plan;searchedAt?:string;suggestedQueries?:string[]};
type Props={sources:Source[];pages:any[];onCrawl:(ids:string[],query:string,urls?:string[])=>void;onInspect:(source:Source)=>void;onSave:(source:Source)=>void;bookmarks:string[];onRefresh:()=>void;onResults:()=>void};
const prompts=['AI in banking deployments','SaaS pricing and customer retention','Mergers and acquisitions case studies','Semiconductor supply chains','Apple latest quarterly report','Startup failure and unit economics'];
const host=(url:string)=>{try{return new URL(url).hostname.replace(/^www\./,'')}catch{return ''}};
const href=(url:string)=>{try{return /^https?:$/.test(new URL(url).protocol)?url:undefined}catch{return undefined}};
function Answer({content}:{content:string}){
 return <div className="research-answer">{content.split(/\n\s*\n/).map((paragraph,index)=><p key={index}>{paragraph.split(/(\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g).map((part,i)=>{const link=part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);return link?<a key={i} href={href(link[2])} target="_blank" rel="noreferrer">{link[1]}<ArrowUpRight size={10}/></a>:part})}</p>)}</div>;
}
export default function ResearchChat({onCrawl,onInspect,onSave,bookmarks,onRefresh,onResults}:Props){
 const [messages,setMessages]=useState<Message[]>([]),[draft,setDraft]=useState(''),[pending,setPending]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[historyError,setHistoryError]=useState(''),[selected,setSelected]=useState<string|null>(null),[historyLimit,setHistoryLimit]=useState(10),[lastPrompt,setLastPrompt]=useState('');
 const pendingRef=useRef(false),input=useRef<HTMLTextAreaElement>(null),end=useRef<HTMLDivElement>(null);
 useEffect(()=>{const controller=new AbortController();fetch('/api/chat',{signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error('Saved conversation could not be loaded.');return response.json() as Promise<{messages:Message[]}>}).then(data=>setMessages((data.messages||[]).filter((message:Message)=>['user','assistant'].includes(message.role)&&typeof message.content==='string'))).catch(cause=>{if(!controller.signal.aborted)setHistoryError(cause.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});return()=>controller.abort()},[]);
 useEffect(()=>{end.current?.scrollIntoView({block:'nearest'})},[messages.length,pending]);
 const latest=messages.findLast(message=>message.role==='assistant'&&message.providers);
 const chosen=messages.find(message=>message.id===selected)||latest;
 const documents=chosen?.documents||[];
 const captured=chosen?.pages||[];
 async function send(text:string){
  const message=text.trim();if(!message||pendingRef.current||loading)return;
  pendingRef.current=true;setPending(true);setError('');setDraft('');setSelected(null);setLastPrompt(message);
  setMessages(previous=>[...previous,{id:`user-${Date.now()}`,role:'user',content:message}]);
  try{
   const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message})});
   const data=await response.json() as Partial<Message> & {answer?:string;error?:string};if(!response.ok||typeof data.answer!=='string')throw new Error(data.error||'Search could not be completed.');
   const answer=data.answer;
   setMessages(previous=>[...previous,{...data,id:`answer-${Date.now()}`,role:'assistant',content:answer}]);onRefresh();
  }catch(cause){setError(cause instanceof Error?cause.message:'Could not reach the research service.');setDraft(message)}
  finally{pendingRef.current=false;setPending(false);input.current?.focus()}
 }
 function crawl(){if(chosen?.plan)onCrawl(chosen.plan.sourceIds,chosen.plan.query,chosen.plan.urls)}
 return <div className="research-workbench">
  <section className="research-conversation" aria-label="Research conversation">
   <div className="research-panel-title"><Search size={15}/><h2>Ask a research question</h2><span>Free public APIs</span></div>
   <div className="research-transcript" role="log" aria-live="polite" aria-busy={pending||loading}>
    {loading?<LoadingState label="Loading your conversation…" compact/>:null}
    {historyError&&<p role="alert" className="research-error">{historyError} Your new searches still work.</p>}
    {!messages.length&&!loading&&<div className="research-welcome"><span className="research-mark"><Search size={22}/></span><h3>What are you trying<br/>to understand?</h3><p>Name a topic, company, or use case. Search returns specific free documents with their abstracts and original links.</p><div className="research-prompts">{prompts.map(prompt=><button key={prompt} disabled={pending} onClick={()=>void send(prompt)}>{prompt}<ChevronRight size={13}/></button>)}</div></div>}
    {messages.length>historyLimit&&<button className="text-button history-more" onClick={()=>setHistoryLimit(value=>value+10)}>Show earlier messages</button>}
    {messages.slice(-historyLimit).map((message,i)=>message.role==='user'?<div className="research-question" key={message.id||i}>{message.content}</div>:<article className="research-reply" key={message.id||i}>
     {!message.providers?<details className="research-legacy"><summary>Earlier catalog recommendation</summary><Answer content={message.content}/><p>Run the question again to search for specific documents.</p></details>:<><div className="research-reply-label"><span>Research search</span><span>{message.searchedAt?new Date(message.searchedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):''}</span></div><Answer content={message.content.split(/\n\s*\n/)[0]}/>{(message.documents?.length||message.pages?.length)?<p className="research-evidence-note">Review the document abstracts and original links in the evidence panel. Results are saved to your workspace.</p>:null}<details className="research-search-notes"><summary>Search notes and source summaries</summary><Answer content={message.content}/></details><div className="provider-statuses" aria-label="Search provider status">{message.providers.map(provider=><span key={provider.provider} className={['error','timeout','rate-limited'].includes(provider.status)?'provider-warning':''} title={provider.message||provider.status}>{provider.status==='ok'?<Check size={11}/>:provider.status==='empty'?<Search size={11}/>:<TriangleAlert size={11}/>} {provider.provider} · {provider.status==='ok'?`${provider.count} found`:provider.status==='empty'?'no matches':provider.status}</span>)}</div>{message.providers.filter(provider=>provider.message&&(!['ok','empty'].includes(provider.status)||provider.provider==='SEC EDGAR')).map(provider=><p className="provider-explanation" key={provider.provider}>{provider.message}</p>)}{(message.documents?.length||message.pages?.length)?<button className={`text-button research-view-documents ${chosen?.id===message.id?'selected':''}`} onClick={()=>setSelected(message.id||null)}>{chosen?.id===message.id?'Showing documents':'View documents from this search'}<ChevronRight size={12}/></button>:null}</>}
    </article>)}
    {pending&&<div className="research-searching"><LoadingState label="Searching free research and company filings…" compact/></div>}
    {error&&<div className="research-error" role="alert"><p>{error}</p><button className="text-button" onClick={()=>void send(lastPrompt)}>Retry search</button></div>}
    <div ref={end}/>
   </div>
   <form className="research-composer" onSubmit={event=>{event.preventDefault();void send(draft)}}><label htmlFor="research-question-input">Your question</label><div><textarea id="research-question-input" ref={input} value={draft} onChange={event=>setDraft(event.target.value)} placeholder="e.g. How is AI being used in banking?" rows={2} maxLength={2000} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void send(draft)}}}/><button className="research-send" type="submit" aria-label="Search research" aria-busy={pending} disabled={!draft.trim()||pending||loading}>{pending?<LoaderCircle size={16}/>:<ArrowUp size={17}/>}</button></div><small>Enter to search · Shift + Enter for a new line</small></form>
  </section>
  <aside className="research-documents" aria-label="Documents from your search">
   <div className="research-panel-title"><FileText size={15}/><h2>Documents</h2><span>{pending?'—':documents.length+captured.length||'—'}</span></div>
   <div className="research-document-scroll">
    {pending?<LoadingState label={`Finding documents for “${lastPrompt}”…`}/>:documents.length||captured.length?<><div className="research-document-context"><span>For your question</span><h3>{chosen?.plan?.query}</h3><p>Saved to Results automatically. Each link opens an individual document.</p></div><ol className="research-document-list">{documents.map((document,index)=>{
     const guide=resourceGuide({...document,type:document.documentType},{query:document.query,origin:'page'});
     return <li key={document.id}><span className="document-number">{String(index+1).padStart(2,'0')}</span><div><div className="document-meta"><span>{document.provider}</span><span>{document.publishedAt?.slice(0,4)||document.documentType}</span><span>Free</span></div><h3><a href={href(document.url)} target="_blank" rel="noreferrer">{document.title}<ArrowUpRight size={13}/></a></h3><p className="document-purpose">{document.description||'No abstract supplied. Open the original document to review its content.'}</p><details className="document-guidance"><summary>How this helps & access evidence</summary><p>{guide.howToUse}</p><p>{document.accessBasis}</p><button className="text-button" onClick={()=>onInspect(document)}>Full abstract and details<ChevronRight size={11}/></button></details><div className="document-actions"><a href={href(document.url)} target="_blank" rel="noreferrer">{host(document.url)}<ArrowUpRight size={11}/></a><button title={bookmarks.includes(document.id)?'Remove from saved':'Save document'} aria-label={`${bookmarks.includes(document.id)?'Unsave':'Save'} ${document.title}`} aria-pressed={bookmarks.includes(document.id)} onClick={()=>onSave(document)}><Bookmark size={13} fill={bookmarks.includes(document.id)?'currentColor':'none'}/></button></div></div></li>
    })}</ol>{captured.length>0&&<div className="research-captured"><h3>From your crawls</h3>{captured.map(page=><a key={page.id} href={href(page.url)} target="_blank" rel="noreferrer">{page.title}<ArrowUpRight size={12}/></a>)}</div>}</>:chosen?.providers?<div className="research-document-empty"><Search size={25}/><h3>No matching documents</h3><p>For: {chosen.plan?.query}</p>{chosen.providers.map(provider=><p key={provider.provider}>{provider.message||`${provider.provider} returned no usable documents.`}</p>)}</div>:<div className="research-document-empty"><FileText size={25}/><h3>Evidence starts here</h3><p>Ask a question to find papers and reports. You’ll see what each document covers, why it matches, and where to read it for free.</p><div><span>01</span>Search a specific topic</div><div><span>02</span>Review the original documents</div><div><span>03</span>Crawl links and collect evidence</div></div>}
   </div>
   <div className="research-document-footer"><button className="button" onClick={onResults}>All research results<ArrowUpRight size={12}/></button><button className="button primary" disabled={pending||(!chosen?.plan?.sourceIds.length&&!chosen?.plan?.urls?.length)} onClick={crawl}>Crawl these documents<ChevronRight size={12}/></button></div>
  </aside>
 </div>;
}
