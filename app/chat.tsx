'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, ArrowUpRight, BookOpen, Building2, ChevronDown, ChevronRight, CircleHelp, Database, FileText, Layers3, LoaderCircle, MessageSquare, RefreshCw, ScanSearch, Search, ShieldCheck, Sparkles, TrendingUp, TriangleAlert, Waypoints } from 'lucide-react';
import type { Source } from './graph';
import {resourceGuide} from '../lib/resource-guide';
import {classifyPageAccess,isFreeSource} from '../lib/free-access';
import catalog from '../lib/catalog.json';
import Graph from './graph';
import './chat.css';

type ResearchPlan = { query: string; sourceIds: string[] };
type ChatMessage = {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  pages?: any[];
  plan?: ResearchPlan;
  mode?: 'retrieval' | 'ai';
  suggestedQueries?: string[];
};
type ChatResult = {
  answer: string;
  sources: Source[];
  pages: any[];
  suggestedQueries: string[];
  mode: 'retrieval' | 'ai';
  plan: ResearchPlan;
};
type ResearchChatProps = {
  sources: Source[];
  pages: any[];
  onCrawl: (ids: string[], query: string) => void;
  onInspect: (source: Source) => void;
  onRefresh: () => void;
  onResults: () => void;
};

const useCases = [
  { title: 'Company deep dive', detail: 'Strategy, business model & financials', icon: Building2, prompt: 'Help me build a company deep dive. Find authoritative sources for its business model, strategy, financial performance, competitors, and key risks. Ask which company I want to research if I have not specified one.' },
  { title: 'SaaS pricing case studies', detail: 'Pricing models, retention & benchmarks', icon: Layers3, prompt: 'Find SaaS pricing case studies and credible benchmarks. Focus on pricing model changes, usage-based pricing, retention, expansion revenue, and measurable business outcomes. Prioritize original research and detailed cases.' },
  { title: 'Competitive landscape', detail: 'Competitors, positioning & market maps', icon: Waypoints, prompt: 'Help me map a competitive landscape using company disclosures, industry research, market maps, and credible business model analysis. Ask which industry or company to start with and suggest the most useful source categories.' },
  { title: 'AI in banking', detail: 'Real deployments, economics & risk', icon: Sparkles, prompt: 'Find research and case studies on AI in banking. Look for actual deployments, business outcomes, operating costs, model governance, and regulatory considerations, with primary sources and clearly labeled vendor case studies.' },
  { title: 'Market sizing', detail: 'Industry data & bottom-up assumptions', icon: TrendingUp, prompt: 'Help me research a market size using primary statistics, industry associations, company disclosures, and transparent bottom-up assumptions. Ask for the market, geography, and time horizon, then identify the strongest data sources.' },
  { title: 'Startup failures', detail: 'Postmortems, unit economics & lessons', icon: CircleHelp, prompt: 'Find detailed startup failure case studies and postmortems. Prioritize founder accounts, funding history, product-market fit, unit economics, competitive pressures, and useful lessons with supporting sources.' },
];
const emptySources: Source[] = [];
const emptyPages: any[] = [];

function safeHref(url?: string) {
  if (!url) return undefined;
  try { const parsed = new URL(url); return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : undefined; } catch { return undefined; }
}
function hostname(url?: string) {
  try { return new URL(url || '').hostname.replace(/^www\./, ''); } catch { return 'Research source'; }
}
function inlineText(text: string, sources: Source[]) {
  return text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|\[\d+\])/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (link) return <a key={i} href={safeHref(link[2])} target="_blank" rel="noreferrer">{link[1]}<ArrowUpRight size={10}/></a>;
    const citation = part.match(/^\[(\d+)\]$/);
    const source = citation ? sources[Number(citation[1]) - 1] : undefined;
    if (source) return <a className="rc-inline-citation" key={i} href={safeHref(source.url)} target="_blank" rel="noreferrer" title={source.name}>{part}</a>;
    return part;
  });
}
const Answer = memo(function Answer({ content, sources = emptySources }: { content: string; sources?: Source[] }) {
  const blocks: { type: 'paragraph' | 'bullet' | 'number'; lines: string[]; start?: number }[] = [];
  let current: (typeof blocks)[number] | undefined;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) { current = undefined; continue; }
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const number = line.match(/^(\d+)[.)]\s+(.*)$/);
    const type = bullet ? 'bullet' : number ? 'number' : 'paragraph';
    const text = bullet ? bullet[1] : number ? number[2] : line.replace(/^#{1,4}\s+/, '');
    if (!current || current.type !== type) {
      current = { type, lines: [], ...(number ? { start: Number(number[1]) } : {}) };
      blocks.push(current);
    }
    current.lines.push(text);
  }
  return <div className="rc-answer">{blocks.map((block, index) => {
    if (block.type === 'bullet') return <ul key={index} style={{ listStyleType: 'disc' }}>{block.lines.map((line, lineIndex) => <li key={lineIndex}>{inlineText(line, sources)}</li>)}</ul>;
    if (block.type === 'number') return <ol key={index} start={block.start} style={{ margin: '9px 0 13px', paddingLeft: 17, listStyleType: 'decimal' }}>{block.lines.map((line, lineIndex) => <li key={lineIndex}>{inlineText(line, sources)}</li>)}</ol>;
    return <p key={index} style={{ whiteSpace: 'pre-line' }}>{inlineText(block.lines.join('\n'), sources)}</p>;
  })}</div>;
});

export default function ResearchChat({ sources, pages, onCrawl, onInspect, onRefresh, onResults }: ResearchChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [lastPrompt, setLastPrompt] = useState('');
  const [networkZoom, setNetworkZoom] = useState(1);
  const [networkSelection, setNetworkSelection] = useState('');
  const [showNetwork, setShowNetwork] = useState(false);
  const [visibleMessageCount, setVisibleMessageCount] = useState(24);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const requestRef = useRef<Promise<{ messages?: ChatMessage[] }> | null>(null);
  const pendingRef = useRef(false);

  useEffect(() => {
    let active = true;
    if (!requestRef.current) requestRef.current = fetch('/api/chat').then(async response => {
      if (!response.ok) throw new Error('Saved conversation could not be loaded.');
      return response.json();
    });
    requestRef.current.then(data => {
      if (!active) return;
      const saved = Array.isArray(data.messages) ? data.messages.filter(message => ['user', 'assistant'].includes(message.role) && typeof message.content === 'string') : [];
      setMessages(saved.map(message=>{if(message.role!=='assistant')return message;const allowed=(message.sources||[]).filter(isFreeSource);const restricted=allowed.length!==(message.sources||[]).length;return {...message,content:restricted?'This earlier answer included sources outside your free-only filter. Ask the question again for updated free recommendations.':message.content,sources:allowed,pages:(message.pages||[]).filter(page=>classifyPageAccess(page,catalog)==='Free'),plan:message.plan?{...message.plan,sourceIds:message.plan.sourceIds.filter(id=>sources.some(source=>source.id===id))}:undefined}}));
    }).catch(cause => { if (active) setHistoryError(cause.message || 'Saved conversation could not be loaded.'); }).finally(() => { if (active) setLoadingHistory(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'auto', block: 'nearest' }); }, [messages.length, pending]);
  useEffect(() => {
    const input = textareaRef.current;
    if (input) { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 140)}px`; }
  }, [draft]);

  const latestIndex = messages.findLastIndex(message => message.role === 'assistant');
  const activeIndex = selectedIndex !== null && messages[selectedIndex]?.role === 'assistant' ? selectedIndex : latestIndex;
  const selectedMessage = activeIndex >= 0 ? messages[activeIndex] : undefined;
  const selectedPlan = selectedMessage?.plan;
  const suggestedQueries = selectedMessage?.suggestedQueries || [];
  const planSources = useMemo(() => {
    const all = new Map([...sources, ...(selectedMessage?.sources || [])].map(source => [source.id, source]));
    return (selectedPlan?.sourceIds || []).map(id => all.get(id)).filter((source): source is Source => Boolean(source));
  }, [sources, selectedMessage, selectedPlan]);
  const visibleSources = selectedMessage?.sources || emptySources;
  const domainCounts = useMemo(() => Object.entries(sources.reduce<Record<string, number>>((counts, source) => {
    counts[source.domain] = (counts[source.domain] || 0) + 1; return counts;
  }, {})), [sources]);
  const verifiedCount = sources.filter(source => source.verification === 'Verified page').length;
  const selectedPages = selectedMessage?.pages || [];
  const renderedMessages = messages.slice(-visibleMessageCount);
  const messageOffset = messages.length - renderedMessages.length;
  const networkPages = useMemo(() => {
    if (!selectedMessage) return emptyPages;
    const sourceIds = new Set(visibleSources.map(source => source.id));
    const resultIds = new Set((selectedMessage.pages || []).map(page => page.id));
    const resultUrls = new Set((selectedMessage.pages || []).map(page => page.url));
    return pages.filter(page => sourceIds.has(page.sourceId) || resultIds.has(page.id) || resultUrls.has(page.url)).slice(0, 50);
  }, [selectedMessage, visibleSources, pages]);
  const networkEdges = useMemo(() => networkPages.filter(page => page.parentUrl && page.parentUrl !== page.url).map(page => ({ source: page.parentUrl, target: page.url })), [networkPages]);

  async function sendMessage(text: string, retry = false) {
    const message = text.trim();
    if (!message || pendingRef.current || loadingHistory) return;
    pendingRef.current = true;
    setPending(true); setError(''); setLastPrompt(message); setDraft(''); setSelectedIndex(null);
    if (!retry) setMessages(current => [...current, { id: `user-${Date.now()}`, role: 'user', content: message }]);
    try {
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });
      const data: ChatResult & { error?: string } = await response.json();
      if (!response.ok || typeof data.answer !== 'string' || !data.answer.trim()) throw new Error(data.error || 'The research request could not be completed. Please try again.');
      setMessages(current => [...current, { id: `assistant-${Date.now()}`, role: 'assistant', content: data.answer, sources: Array.isArray(data.sources) ? data.sources : [], pages: Array.isArray(data.pages) ? data.pages : [], suggestedQueries: Array.isArray(data.suggestedQueries) ? data.suggestedQueries : [], mode: data.mode === 'ai' ? 'ai' : 'retrieval', plan: data.plan }]);
      onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reach the research service. Please try again.');
    } finally { pendingRef.current = false; setPending(false); textareaRef.current?.focus(); }
  }

  function crawlPlan(plan?: ResearchPlan) {
    if (plan?.sourceIds?.length) onCrawl(plan.sourceIds.filter(id=>sources.some(source=>source.id===id)), plan.query);
  }

  return <div className="research-chat">
    <section className="rc-conversation" aria-label="Research assistant conversation">
      <div className="rc-panel-top"><span><MessageSquare size={16}/>Research assistant</span><span className="rc-private">Free sources · Saved to this workspace</span></div>
      <div className="rc-transcript" role="log" aria-label="Research messages" aria-live="polite" aria-busy={pending || loadingHistory}>
        {loadingHistory ? <div className="rc-history-loading"><LoaderCircle size={18} className="rc-spin"/><span>Loading conversation…</span></div> : !messages.length ? <div className="rc-welcome">
          <h2>What are you researching?</h2>
          <p>Ask about a company, market, or business question. Find sources, compare evidence, and build a focused crawl.</p>
          <div className="rc-use-cases">{useCases.map(item => <button key={item.title} onClick={() => sendMessage(item.prompt)} disabled={pending} className="rc-use-case"><item.icon size={18}/><span><b>{item.title}</b><small>{item.detail}</small></span><ChevronRight size={14}/></button>)}</div>
          <p className="rc-welcome-foot">Search across {sources.length.toLocaleString()} sources and {pages.length.toLocaleString()} captured pages.</p>
        </div> : <div className="rc-message-list">
          {messageOffset > 0 && <button className="rc-earlier" onClick={() => setVisibleMessageCount(count => count + 24)}>Show earlier messages <span>{messageOffset}</span></button>}
          {renderedMessages.map((message, localIndex) => {
            const index = messageOffset + localIndex;
            return <article className={`rc-message rc-${message.role}`} key={message.id || index}>
              <div className="rc-message-heading"><span className="rc-message-avatar">{message.role === 'assistant' ? <ScanSearch size={15}/> : 'Y'}</span><b>{message.role === 'assistant' ? 'Signal' : 'You'}</b>{message.role === 'assistant' && <span className="rc-mode">{message.mode === 'ai' ? <Sparkles size={12}/> : <Search size={12}/>} {message.mode === 'ai' ? 'AI synthesis' : 'Source retrieval'}</span>}</div>
              <Answer content={message.content} sources={message.sources}/>
              {!!message.sources?.length && <div className="rc-evidence">
                <div className="rc-evidence-title"><BookOpen size={13}/>Sources<span>{message.sources.length}</span></div>
                <div className="rc-evidence-grid">{message.sources.slice(0, 6).map((source, sourceIndex) => <div className="rc-evidence-card" key={source.id}>
                  <span className="rc-evidence-number">{sourceIndex + 1}</span><div><a href={safeHref(source.url)} target="_blank" rel="noreferrer" title={source.url}>{source.name}<ArrowUpRight size={12}/></a><small>{hostname(source.url)}<span>{source.access}</span></small><p className="rc-resource-purpose">{resourceGuide(source,{query:message.plan?.query,origin:'catalog'}).purpose}</p><details className="rc-resource-use"><summary>How to use this source</summary><p>{resourceGuide(source,{query:message.plan?.query,origin:'catalog'}).howToUse}</p></details></div><button aria-label={`Inspect ${source.name}`} onClick={() => onInspect(source)}>Inspect</button>
                </div>)}</div>
                {message.sources.length > 6 && <button className="rc-more-sources" onClick={() => setSelectedIndex(index)}>View all {message.sources.length} sources</button>}
              </div>}
              {!!message.pages?.length && <div className="rc-page-evidence"><span><FileText size={13}/>Captured pages</span>{message.pages.slice(0, 3).map((page, pageIndex) => <div key={page.id || page.url || pageIndex}><a href={safeHref(page.url)} target="_blank" rel="noreferrer">{page.title || hostname(page.url)}<ArrowUpRight size={12}/></a><p className="rc-resource-purpose">{resourceGuide(page,{query:message.plan?.query,origin:'page'}).purpose}</p><details className="rc-resource-use"><summary>How to use this page</summary><p>{resourceGuide(page,{query:message.plan?.query,origin:'page'}).howToUse}</p></details></div>)}</div>}
              {!!message.plan?.sourceIds?.length && <div className="rc-message-actions"><button onClick={() => { setSelectedIndex(index); crawlPlan(message.plan); }}>Review & start crawl</button><button className="rc-brief-link" onClick={() => setSelectedIndex(index)}>View research brief</button></div>}
            </article>;
          })}
          {pending && <div className="rc-thinking"><LoaderCircle size={15} className="rc-spin"/><span>Finding sources and evidence…</span></div>}
        </div>}
        <div ref={endRef}/>
      </div>
      <div className="rc-compose-area">
        {historyError && <div className="rc-notice"><TriangleAlert size={15}/><span>{historyError} You can still ask a new question.</span><button onClick={() => setHistoryError('')} aria-label="Dismiss history notice">×</button></div>}
        {error && <div className="rc-notice rc-error" role="alert"><TriangleAlert size={15}/><span>{error}</span><button onClick={() => sendMessage(lastPrompt, true)} disabled={pending}><RefreshCw size={12}/>Retry</button></div>}
        {!!messages.length && !pending && <div className="rc-followups">{(suggestedQueries.length ? suggestedQueries.slice(0, 3) : ['Free sources only', 'Prioritize primary sources', 'Find detailed case studies']).map(query => <button key={query} onClick={() => sendMessage(query)} title={query}>{query}</button>)}</div>}
        <form className="rc-composer" onSubmit={event => { event.preventDefault(); sendMessage(draft); }}>
          <textarea ref={textareaRef} aria-label="Ask a research question" placeholder="Ask a research question…" rows={2} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); sendMessage(draft); } }} disabled={pending || loadingHistory}/>
          <div className="rc-composer-bottom"><span><Database size={13}/>Your research library</span><button type="submit" disabled={!draft.trim() || pending || loadingHistory} aria-label={pending ? 'Sending research question' : 'Send research question'}>{pending ? <LoaderCircle size={17} className="rc-spin"/> : <ArrowUp size={18}/>}</button></div>
        </form>
        <div className="rc-compose-note"><span>Searches free source descriptions and captured summaries.</span><span><kbd>Enter</kbd> to send <span>·</span> <kbd>Shift Enter</kbd> for a new line</span></div>
      </div>
    </section>

    <aside className="rc-brief" aria-label="Research brief">
      <div className="rc-panel-top"><span>Research brief</span><span className="rc-brief-state">{selectedMessage ? 'Ready' : 'Overview'}</span></div>
      <div className="rc-brief-body"><button className="rc-results-link" onClick={onResults}><FileText size={15}/><span>Open research results<small>All collected links and how to use them</small></span><ArrowUpRight size={14}/></button>
        <div className="rc-brief-intro"><h3>{selectedPlan ? 'Current question' : 'Your research workspace'}</h3><p>{selectedPlan?.query || 'Find relevant sources, capture useful pages, and keep the evidence connected to your question.'}</p></div>
        <div className="rc-brief-stats"><div><strong>{(selectedMessage ? visibleSources.length : sources.length).toLocaleString()}</strong><span>{selectedMessage ? 'Sources found' : 'Sources'}</span></div><div><strong>{(selectedMessage ? selectedPages.length : pages.length).toLocaleString()}</strong><span>{selectedMessage ? 'Related pages' : 'Captured pages'}</span></div><div><strong>{selectedMessage ? planSources.length : domainCounts.length}</strong><span>{selectedMessage ? 'Crawl sources' : 'Domains'}</span></div></div>
        {selectedMessage ? <>
          <div className="rc-section-label"><h4>Source selection</h4><span>{visibleSources.length}</span></div>
          {visibleSources.length ? <div className="rc-brief-sources">{visibleSources.map(source => <button key={source.id} onClick={() => onInspect(source)} className="rc-brief-source"><span className="rc-source-initial">{source.name.slice(0, 1)}</span><span><b>{source.name}</b><small>{source.domain}<span>{source.access}</span></small></span><ChevronRight size={14}/></button>)}</div> : <div className="rc-no-matches"><Search size={17}/><p>No matching sources yet. Add a company, industry, geography, or specific topic to your question.</p></div>}
          <div className="rc-crawl-plan"><h4>Next step</h4><p>{planSources.length ? `${planSources.length} source${planSources.length === 1 ? ' is' : 's are'} ready to crawl. Review the query and limits before collecting pages.` : 'Refine your question to select sources for a crawl.'}</p><button className="rc-crawl-button" onClick={() => crawlPlan(selectedPlan)} disabled={!selectedPlan?.sourceIds?.length}><Waypoints size={15}/>Review & start crawl</button></div>
        </> : <>
          <div className="rc-section-label"><h4>Library coverage</h4></div>
          <div className="rc-domain-coverage">{domainCounts.map(([domain, count]) => <div key={domain}><span>{domain}</span><b>{count.toLocaleString()}</b></div>)}</div>
          <div className="rc-context-note"><ShieldCheck size={16}/><p><b>{verifiedCount.toLocaleString()} verified source pages</b>The remaining entries are discovery seeds, ready to explore.</p></div>
          <div className="rc-good-question"><h4>Try a specific question</h4><p>How did B2B SaaS companies change pricing after introducing AI features?</p><button onClick={() => sendMessage('Find free case studies on how B2B SaaS companies changed pricing after introducing AI features. Prioritize documented outcomes and primary sources.')} disabled={pending || loadingHistory}>Find case studies<ArrowUpRight size={13}/></button></div>
        </>}
        <div className="rc-network">{networkPages.length ? <><button className="rc-network-toggle" onClick={() => setShowNetwork(value => !value)} aria-expanded={showNetwork} aria-controls="research-source-map"><span><Waypoints size={15}/>Crawled links</span><ChevronDown size={14} style={{ transform: showNetwork ? 'rotate(180deg)' : undefined }}/></button>{showNetwork && <div id="research-source-map"><p className="rc-network-description">{networkPages.length} captured pages. Lines show links recorded by the crawler.</p><div className="rc-network-graph"><Graph sources={sources} pages={networkPages} edges={networkEdges} select={source => { setNetworkSelection(source.id); onInspect(source); }} selected={networkSelection} zoom={networkZoom} setZoom={setNetworkZoom} layoutKey={activeIndex}/><div className="rc-network-controls"><button aria-label="Zoom out crawled links" onClick={() => setNetworkZoom(value => Math.max(.45, value - .2))}>−</button><span>{Math.round(networkZoom * 100)}%</span><button aria-label="Zoom in crawled links" onClick={() => setNetworkZoom(value => Math.min(2.7, value + .2))}>+</button></div></div></div>}</> : <p className="rc-network-empty">Review & start crawl to build the spider.</p>}</div>
        <p className="rc-evidence-note">{selectedMessage?.mode === 'ai' ? 'AI synthesis uses your research context. Verify claims against the linked sources.' : 'Matches source descriptions and captured page summaries. Open the original pages to verify claims.'}</p>
      </div>
    </aside>
  </div>;
}
