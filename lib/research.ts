/** Local evidence retrieval. Catalog descriptions are discovery metadata, not article content. */
export interface ResearchSource {
  id:string; name:string; url:string; domain:string; category:string; type:string; access:string;
  description:string; tags:string[]; geography:string; crawlMethod:string; feedUrl?:string;
  verification:string; provenanceUrl?:string|null; checkedAt?:string;
}
export interface ResearchPage {
  id:string; url:string; title:string; description:string; sourceId?:string; domain?:string;
  category?:string; tags?:string[]; fetchedAt?:string; [key:string]:unknown;
}
export interface ChatMessage { role:"user"|"assistant"; content:string }
export interface ResearchAnswer {
  answer:string; sources:ResearchSource[]; pages:ResearchPage[]; suggestedQueries:string[];
  mode:"retrieval"|"ai"; plan:{query:string;sourceIds:string[]};
}
const stop = new Set("a an and are as at about all any anything be best business can case cases could do every example examples find for from get give help how i in include information into is it its just learn like looking me more my need of on only or our please possible related research resource resources show some source sources studies study than that the their these they this those to understand use using want what which with would you your free paid".split(" "));
const normalize:Record<string,string>={banking:"bank",banks:"bank",financial:"finance",companies:"company",businesses:"business",pricing:"price",prices:"price",competition:"competitor",competitive:"competitor",competitors:"competitor",failures:"failure",failed:"failure",failing:"failure",startups:"startup",datasets:"dataset",papers:"paper",reports:"report",filings:"filing",benchmarks:"benchmark",intelligence:"intelligence",ai:"ai",llms:"llm"};
function tokens(value:string):string[] {
  return value.toLowerCase().replace(/artificial intelligence/g,"ai").replace(/machine learning/g,"machinelearning").replace(/market sizing/g,"marketsizing").replace(/deep dives?/g,"deepdive").match(/[\p{L}\p{N}]+/gu)?.filter(t=>!stop.has(t)).map(t=>normalize[t] || (t.length>5&&t.endsWith("s")?t.slice(0,-1):t)).filter(t=>t.length>1&&!stop.has(t)) || [];
}
const synonyms:Record<string,string[]>={
  ai:["machinelearning","llm","automation","model"],bank:["bank","finance","fintech","credit","regulation","risk"],
  saas:["subscription","cloud","software","arr","retention"],price:["monetization","subscription","revenue","benchmark"],
  competitor:["strategy","market","positioning","company","industry"],marketsizing:["market","industry","statistic","forecast","census"],
  startup:["founder","venture","company"],failure:["postmortem","closed","failure","turnaround"],
  company:["filing","disclosure","earnings","investor","annual"],deepdive:["company","filing","earnings","strategy","business"],
  security:["vulnerability","cybersecurity","breach"],dataset:["data","statistic"],
};
type Intent="pricing"|"bank-ai"|"competition"|"market"|"failure"|"company"|"general";
function intentFor(query:string):Intent {
  const t=tokens(query); const has=(...words:string[])=>words.some(w=>t.includes(w));
  if(has("bank")&&has("ai","machinelearning","llm"))return "bank-ai";
  if(has("failure","postmortem")&&has("startup","founder","company","business"))return "failure";
  if(has("saas")||(has("price","monetization")&&has("software","subscription","cloud")))return "pricing";
  if(has("marketsizing","tam","sam","som"))return "market";
  if(has("competitor"))return "competition";
  if(has("company","deepdive","earnings","valuation","apple","microsoft","netflix","alphabet","airbnb","shopify","amazon","tesla","nvidia"))return "company";
  return "general";
}
const intentTerms:Record<Intent,string[]>={
  pricing:["saas","price","subscription","benchmark","retention","revenue"],
  "bank-ai":["ai","bank","fintech","risk","regulation","model"],
  competition:["competitor","strategy","industry","company","market"],
  market:["marketsizing","market","industry","statistic","forecast","census"],
  failure:["failure","startup","postmortem","founder","closed"],
  company:["company","filing","earnings","disclosure","investor"],general:[],
};
function resolveContext(message:string,history:ChatMessage[]) {
  let query="",freeOnly=false,cases=false;
  for(const turn of [...history.filter(m=>m.role==="user").slice(-12),{role:"user",content:message}]) {
    const text=turn.content.trim();
    if(/\b(?:only|just)\s+(?:the\s+)?free\b|\bfree\s+(?:sources|resources|only)\b|\bno paywalls?\b/i.test(text))freeOnly=true;
    if(/\b(?:include paid|all access|paid (?:is|are) (?:fine|okay|ok))\b/i.test(text))freeOnly=false;
    if(/\bcase stud(?:y|ies)\b|\bpostmortems?\b/i.test(text))cases=true;
    const remaining=tokens(text).filter(t=>!["paywall","paywalls","access","fine","okay","ok","same","topic","again"].includes(t));
    if(remaining.length)query=text;
  }
  return {query:query || message,freeOnly,cases,intent:intentFor(query || message)};
}
function expand(query:string,intent:Intent) {
  const weights=new Map<string,number>();
  for(const t of [...new Set(tokens(query))]) {
    if(t!=="deepdive")weights.set(t,2);
    for(const related of synonyms[t] || [])if(!weights.has(related))weights.set(related,.65);
  }
  for(const t of intentTerms[intent])if(!weights.has(t))weights.set(t,.45);
  return weights;
}
interface SearchDocument<T>{item:T;fields:[string,number][]}
/** Weighted BM25 over title, tags, category and descriptive metadata. */
function rank<T>(documents:SearchDocument<T>[],weights:Map<string,number>) {
  const indexed=documents.map(doc=>{
    const frequencies=new Map<string,number>();let length=0;
    for(const [field,weight] of doc.fields)for(const t of tokens(field)){frequencies.set(t,(frequencies.get(t)||0)+weight);length+=weight;}
    return {...doc,frequencies,length};
  });
  const avg=indexed.reduce((n,d)=>n+d.length,0)/Math.max(indexed.length,1) || 1;
  const df=new Map<string,number>();for(const term of weights.keys())df.set(term,indexed.filter(d=>d.frequencies.has(term)).length);
  return indexed.map(doc=>{
    let score=0,matched=0;
    for(const [term,weight] of weights){
      const tf=doc.frequencies.get(term)||0;if(!tf)continue;matched++;
      const idf=Math.log(1+(indexed.length-(df.get(term)||0)+.5)/((df.get(term)||0)+.5));
      score+=weight*idf*(tf*2.2)/(tf+1.2*(.25+.75*doc.length/avg));
    }
    return {item:doc.item,score,matched};
  }).filter(d=>d.score>0).sort((a,b)=>b.score-a.score);
}
const questions:Record<Intent,string[]>={
  pricing:["Compare published pricing pages: billing unit, plan limits, annual discounts and add-ons; record the capture date.","Separate acquisition, retention and expansion: compare growth, churn, net revenue retention and gross margin for a matched SaaS cohort.","Test a pricing hypothesis against customer segments and willingness to pay; distinguish vendor claims from measured outcomes."],
  "bank-ai":["Choose a banking use case—fraud, underwriting, service or compliance—and identify the bank, deployment date and AI approach.","Look for measured outcomes, evaluation methods, human oversight and model-risk controls; separate a pilot from a production deployment.","Cross-check vendor case studies against bank disclosures and regulator research, noting privacy, bias and operating-cost constraints."],
  competition:["Define the customer segment and competitors; compare product scope, pricing, distribution and switching costs on the same date.","Use company disclosures for revenue and economics, then compare independent industry estimates and customer evidence.","Build a competitor matrix with a citation and confidence note for each claim; flag missing evidence instead of filling gaps."],
  market:["Define the product, customer, geography and year; keep total, serviceable and obtainable markets separate.","Build a bottom-up estimate: eligible customers × adoption × annual spend, and cite each input and unit.","Compare against industry reports and official statistics; reconcile definitions and show a low/base/high sensitivity range."],
  failure:["Build a dated timeline from founding and financing through the shutdown, sale or restructuring.","Compare founder accounts with contemporary reporting and filings; examine demand, burn, unit economics and distribution.","Separate documented causes from hindsight and compare against a surviving peer to avoid treating correlation as explanation."],
  company:["Start with the company's own filings and investor materials; map revenue segments, growth, margins and cash generation.","Compare customer value, competitors, distribution and unit economics; distinguish current evidence from older business-model descriptions.","Build a dated thesis with evidence for and against it, including risks, management claims and the next unanswered questions."],
  general:["Define the entity, geography, date range and question that would change your decision.","Start with primary documents and datasets, then use case studies to explain implementation and outcomes.","Save the original URL, publication date, method and limitations for each finding; cross-check consequential claims."],
};
function suggestions(query:string,intent:Intent):string[] {
  const base=query.replace(/\s+/g," ").slice(0,180);
  if(intent==="pricing")return [`${base}: retention and pricing benchmarks`,"Only free sources","More case studies"];
  if(intent==="bank-ai")return [`${base}: production deployments and measured outcomes`,`${base}: model risk and regulatory evidence`,"Only free sources"];
  if(intent==="failure")return [`${base}: founder postmortems and unit economics`,"More case studies","Only free sources"];
  return [`${base}: primary datasets and disclosures`,"Only free sources","More case studies"];
}
export function researchAnswer(message:string,history:ChatMessage[],sources:ResearchSource[],pages:ResearchPage[]=[]):ResearchAnswer {
  const context=resolveContext(message,history),weights=expand(context.query,context.intent);
  const caseLike=(s:ResearchSource)=>/case|postmortem|failure|stories|interview/i.test(`${s.type} ${s.description} ${s.tags.join(" ")}`);
  const queryTokens=tokens(context.query);
  const knownCompanies=["apple","microsoft","netflix","alphabet","airbnb","shopify","amazon","tesla","nvidia","tencent","alibaba","samsung","tsmc","toyota"];
  const entities=queryTokens.filter(t=>knownCompanies.includes(t));
  const topical=(s:ResearchSource)=>{
    const text=`${s.name} ${s.description} ${s.tags.join(" ")}`.toLowerCase();
    if(context.intent==="pricing"&&queryTokens.includes("saas"))return /saas|subscription|monetization|cloud software|software-as-a-service/.test(text);
    if(context.intent==="failure")return /startup|founder|venture|entrepreneur/.test(text);
    return true;
  };
  const eligible=sources.filter(s=>(!context.freeOnly||s.access==="Free")&&topical(s));
  let ranked=rank(eligible.map(item=>({item,fields:[[item.name,4],[item.tags.join(" "),3],[item.category,1.8],[item.description,1.6],[item.domain,.35]] as [string,number][]})),weights);
  ranked=ranked.map(r=>{
    let score=r.score;
    if(context.cases)score*=caseLike(r.item)?1.8:.85;
    if(context.intent==="bank-ai"&&/bank|financial institution/i.test(`${r.item.name} ${r.item.description}`))score*=2;
    if(context.intent==="company"&&entities.length&&/investor relations/i.test(r.item.name)&&!entities.some(t=>tokens(`${r.item.name} ${r.item.description}`).includes(t)))score*=.025;
    return {...r,score};
  }).sort((a,b)=>b.score-a.score);
  const threshold=(ranked[0]?.score||0)*(context.intent==="failure"?.04:.16);
  const selected=ranked.filter(r=>r.score>=threshold).slice(0,8).map(r=>r.item);
  const eligibleIds=new Set(eligible.map(s=>s.id));
  const distinctPages=[...new Map(pages.map(p=>[p.url,p])).values()];
  const pageRanked=rank(distinctPages.filter(p=>!context.freeOnly||(p.sourceId&&eligibleIds.has(p.sourceId))).map(item=>({item,fields:[[item.title,4],[item.description,2],[(item.tags||[]).join(" "),2]] as [string,number][]})),weights);
  const selectedPages=pageRanked.filter(r=>r.score>=(pageRanked[0]?.score||0)*.2).slice(0,5).map(r=>r.item);
  const query=context.query.slice(0,300);
  if(!selected.length&&!selectedPages.length)return {
    answer:`I couldn't find a relevant match for “${query}” in the current source catalog or your indexed page metadata${context.freeOnly?" with the free-only filter":""}. Try a company name, industry, technology or a concrete research question. A source not in this catalog can be added by its public URL.`,
    sources:[],pages:[],mode:"retrieval",plan:{query,sourceIds:[]},suggestedQueries:["SaaS pricing and retention benchmarks","AI in banking case studies","Startup failures and founder postmortems"],
  };
  const filters=[context.freeOnly?"free sources only":"",context.cases?"case-study sources prioritized":""].filter(Boolean);
  const intro=`I matched “${query}” to ${selected.length} source${selected.length===1?"":"s"}${selectedPages.length?` and ${selectedPages.length} indexed page${selectedPages.length===1?"":"s"}`:""}${filters.length?` (${filters.join("; ")})`:""}.`;
  const provenance=selectedPages.length?"Source recommendations use catalog descriptions. Indexed-page evidence below is limited to captured titles and summary metadata; it is not a full-document analysis.":"These are research starting points matched from catalog descriptions and tags. I have not read their underlying documents for this answer.";
  const sourceNotes=selected.slice(0,4).map(s=>`• [${s.name}](${s.url}) — ${s.description}`).join("\n");
  const pageNotes=selectedPages.slice(0,3).map(p=>`• [${p.title}](${p.url})${p.description?` — Captured summary: ${p.description.slice(0,280)}`:" — Title indexed; no summary captured."}`).join("\n");
  const steps=questions[context.intent].map((q,i)=>`${i+1}. ${q}`).join("\n");
  return {answer:`${intro}\n\n${provenance}\n\n${sourceNotes}${pageNotes?`\n\nIndexed evidence:\n${pageNotes}`:""}\n\nResearch plan:\n${steps}\n\nUse the crawl action on these sources to collect public page metadata and follow their links.`,sources:selected,pages:selectedPages,suggestedQueries:suggestions(query,context.intent),mode:"retrieval",plan:{query,sourceIds:selected.map(s=>s.id)}};
}
type ChatRow={id:string;role:"user"|"assistant";content:string;metadata:string;created_at:string};
export async function readChat(db:D1Database,user:string) {
  const rows=await db.prepare("SELECT id,role,content,metadata,created_at FROM atlas_chat WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 80").bind(user).all<ChatRow>();
  return {messages:rows.results.reverse().map(row=>{
    let metadata:Record<string,unknown>={};try{metadata=JSON.parse(row.metadata);}catch{}
    return {...metadata,id:row.id,role:row.role,content:row.content,createdAt:row.created_at};
  })};
}
export function cleanHistory(input:unknown):ChatMessage[] {
  if(!Array.isArray(input))return [];
  return input.filter((m):m is ChatMessage=>!!m&&typeof m==="object"&&(m.role==="user"||m.role==="assistant")&&typeof m.content==="string").slice(-12).map(m=>({role:m.role,content:m.content.slice(0,3000)}));
}
export async function retrieveForUser(db:D1Database,user:string,message:string,history:ChatMessage[],catalog:ResearchSource[]):Promise<ResearchAnswer> {
  const [custom,indexed]=await Promise.all([
    db.prepare("SELECT id,name,url,domain FROM atlas_sources WHERE user_id=?").bind(user).all<{id:string;name:string;url:string;domain:string}>(),
    db.prepare("SELECT id,url,title,description,source_id,domain,category,tags,fetched_at FROM atlas_pages WHERE user_id=? ORDER BY fetched_at DESC LIMIT 2000").bind(user).all<{id:string;url:string;title:string;description:string;source_id:string;domain:string;category:string;tags:string;fetched_at:string}>(),
  ]);
  const customSources:ResearchSource[]=custom.results.map(s=>({...s,category:"Custom sources",type:"Research library",access:"Mixed",description:"Source added to your personal research catalog.",tags:["custom"],geography:"Global",crawlMethod:"Manual",verification:"Discovery seed"}));
  const pages:ResearchPage[]=indexed.results.map(p=>{let tags:string[]=[];try{const parsed=JSON.parse(p.tags||"[]");if(Array.isArray(parsed))tags=parsed.filter(t=>typeof t==="string");}catch{}return {id:p.id,url:p.url,title:p.title,description:p.description,sourceId:p.source_id,domain:p.domain,category:p.category,tags,fetchedAt:p.fetched_at};});
  return researchAnswer(message,history,[...catalog,...customSources],pages);
}
export async function saveChat(db:D1Database,user:string,message:string,result:ResearchAnswer) {
  const timestamp=Date.now(),{answer,...metadata}=result;
  const stmt=(role:string,content:string,meta:string,time:number)=>db.prepare("INSERT INTO atlas_chat(id,user_id,role,content,metadata,created_at) VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(),user,role,content,meta,new Date(time).toISOString());
  await db.batch([stmt("user",message,"{}",timestamp),stmt("assistant",answer,JSON.stringify(metadata),timestamp+1)]);
}
