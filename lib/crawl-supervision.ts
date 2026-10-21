/** Deterministic backend agents. They review metadata, never claim full-text reasoning. */
// @ts-expect-error Node's native TypeScript tests need explicit extensions.
import {assessResource,queryTerms,type ResourceAssessment} from './resource-quality.ts';
import type {ResourceAccess} from './free-access.ts';

export type AgentVerdict='pass'|'hold'|'fail'|'not-run';
export type AgentId='source-scout'|'access-guard'|'relevance-reviewer'|'quality-reviewer';
export type AgentReport={id:AgentId;name:string;verdict:AgentVerdict;reason:string;matchedTerms?:string[]};
export type SupervisionDecision='approve'|'archive'|'discover'|'reject';
export type SupervisionReview={version:1;mode:'rule-based';supervisor:'Chief of Staff';url:string;query:string;checkedAt:string;decision:SupervisionDecision;reason:string;score:number|null;agents:AgentReport[];storeMetadata:boolean;allowDiscovery:boolean;quality:ResourceAssessment};
export type CandidateReview={url:string;title:string;description:string;query:string;access:ResourceAccess;validatedFiling?:boolean};
export const AGENT_REVIEW_PREFIX='Agent review · ';

const agentNames:Record<AgentId,string>={'source-scout':'Source scout','access-guard':'Access guard','relevance-reviewer':'Relevance reviewer','quality-reviewer':'Quality reviewer'};
const report=(id:AgentId,verdict:AgentVerdict,reason:string,matchedTerms?:string[]):AgentReport=>({id,name:agentNames[id],verdict,reason,...(matchedTerms?{matchedTerms}:{})});
const clean=(value:string,limit:number)=>value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,limit);
const normalizeSubjects=(value:string)=>value.replace(/\bsoftware[ -]as[ -]a[ -]service\b/gi,'SaaS');

/** The supervisor is the sole decision point for retaining a fetched candidate. */
export async function reviewCrawlCandidate(input:CandidateReview):Promise<SupervisionReview>{
 const candidate={url:input.url,title:clean(input.title,1000),description:clean(input.description,8000)};
 const query=clean(input.query,2000),assessmentQuery=normalizeSubjects(query);
 const normalizedCandidate={...candidate,title:normalizeSubjects(candidate.title),description:normalizeSubjects(candidate.description)};
 const structural=assessResource(candidate,''),topical=assessResource(normalizedCandidate,assessmentQuery);
 const wanted=queryTerms(assessmentQuery);
 // Specific subjects must not be replaced by incidental "customer" or "retention" matches.
 const missingSaas=wanted.includes('saas')&&!/\bsaas\b|\bsoftware[ -]as[ -]a[ -]service\b/i.test(`${candidate.title} ${candidate.description}`);
 const missingAi=wanted.includes('ai')&&!topical.matchedTerms.includes('ai');
 // assessResource scans every metadata token; queryTerms is capped at 20 query terms.
 const titleTopics=new Set(assessResource({...normalizedCandidate,description:''},assessmentQuery).matchedTerms),generic=new Set(['company','market','growth','risk','cost','price','customer','impact','effect','effects','outcome','outcomes','want','need']);
 const anchors=wanted.filter(term=>!generic.has(term)&&!/^\d+$/.test(term));
 const noTitleSubject=anchors.length>0&&!anchors.some(term=>titleTopics.has(term));
 let quality:ResourceAssessment=topical;
 if(input.validatedFiling&&topical.reason==='off-topic')quality={...structural,matchedTerms:topical.matchedTerms,score:topical.score};
 else if(topical.eligible&&(missingSaas||missingAi||noTitleSubject))quality={...topical,eligible:false,reason:'off-topic'};
 const gated=structural.reason==='access-gate'||structural.reason==='error';
 const restricted=['Paid','Mixed','Freemium'].includes(input.access);
 const relevanceVerdict:AgentVerdict=gated?'not-run':!structural.eligible||!wanted.length?'hold':quality.reason==='off-topic'?'fail':'pass';
 const relevanceReason=gated?'No usable document metadata was available to assess topical relevance.':!structural.eligible?`Topical relevance is unconfirmed because the response lacks document evidence: ${structural.reason}.`:!wanted.length?'No specific topic terms were supplied; topical relevance cannot be scored.':quality.reason==='off-topic'?'The title and summary do not establish the requested subject.':input.validatedFiling?'The provider matched this company, filing form, and requested reporting period.':'The title and summary match the research objective.';
 // Separate agents run independently on the same immutable candidate. No network or paid model calls.
 const agents=await Promise.all([
  Promise.resolve().then(()=>report('source-scout',structural.reason==='navigation'?'hold':'pass',structural.reason==='navigation'?'This is a feed or navigation page; use its links as leads.':'The candidate has a specific fetched URL.')),
  Promise.resolve().then(()=>report('access-guard',gated||restricted?'fail':input.access==='Free'?'pass':'hold',gated?'The response is an access gate or error page.':restricted?'The destination is classified as paid or mixed access.':input.access==='Free'?'Free access is supported by the source or exact-document evidence.':'Public response received, but free access is unconfirmed; keep out of free Results.')),
  Promise.resolve().then(()=>report('relevance-reviewer',relevanceVerdict,relevanceReason,quality.matchedTerms)),
  Promise.resolve().then(()=>report('quality-reviewer',gated?'fail':structural.eligible?'pass':'hold',gated?'Session, login, verification, or error content must not be indexed.':structural.eligible?'The title and summary contain substantive document metadata.':`Insufficient document evidence: ${structural.reason}.`)),
 ]);
 const decision:SupervisionDecision=gated||restricted?'reject':!quality.eligible?'discover':input.access==='Free'?'approve':'archive';
 const reason=decision==='approve'?(wanted.length?'Approved: relevant metadata and free-access evidence passed the agent checks.':'Approved: substantive metadata and free-access evidence passed. No specific topic was supplied, so topical relevance was not assessed.'):decision==='archive'?(wanted.length?'Held from free Results: metadata is relevant, but free access remains unconfirmed.':'Held from free Results: substantive metadata is available, but free access remains unconfirmed. No specific topic was supplied, so topical relevance was not assessed.'):decision==='discover'?`Not approved as research: ${quality.reason}. Relevant outgoing links may still be explored.`:'Rejected: access restrictions or unusable page content.';
 return {version:1,mode:'rule-based',supervisor:'Chief of Staff',url:input.url,query,checkedAt:new Date().toISOString(),decision,reason,score:wanted.length&&structural.eligible?Math.round(Math.max(0,Math.min(1,quality.score))*100):null,agents,storeMetadata:decision==='approve'||decision==='archive',allowDiscovery:decision!=='reject',quality};
}

/** Failures before extraction still leave an attributable supervisor decision. */
export function reviewCrawlFailure(url:string,query:string,reason:string):SupervisionReview{
 const explanation=clean(reason,700);
 return {version:1,mode:'rule-based',supervisor:'Chief of Staff',url,query:clean(query,2000),checkedAt:new Date().toISOString(),decision:'reject',reason:`No document approved: ${explanation}`,score:null,agents:[report('source-scout','not-run','The document could not complete processing.'),report('access-guard','fail',explanation),report('relevance-reviewer','not-run','No usable document metadata was available to review.'),report('quality-reviewer','not-run','No usable document metadata was available to review.')],storeMetadata:false,allowDiscovery:false,quality:{eligible:false,reason:'error',matchedTerms:[],score:0}};
}

export function parseAgentReview(message:string):SupervisionReview|null{
 if(!message.startsWith(AGENT_REVIEW_PREFIX)||message.length>16000)return null;
 try{const value=JSON.parse(message.slice(AGENT_REVIEW_PREFIX.length)) as SupervisionReview;
  const bounded=(item:unknown,limit:number,empty=false)=>typeof item==='string'&&item.length<=limit&&(empty||item.trim().length>0);
  const terms=(item:unknown)=>Array.isArray(item)&&item.length<=20&&item.every(term=>bounded(term,2000));
  const score=(item:unknown,max:number)=>typeof item==='number'&&Number.isFinite(item)&&item>=0&&item<=max;
  if(!value||value.version!==1||value.mode!=='rule-based'||value.supervisor!=='Chief of Staff'||!['approve','archive','discover','reject'].includes(value.decision)||
    !bounded(value.url,2400)||!bounded(value.query,2000,true)||!bounded(value.reason,4000)||!bounded(value.checkedAt,64)||!Number.isFinite(Date.parse(value.checkedAt))||
    (value.score!==null&&!score(value.score,100))||typeof value.storeMetadata!=='boolean'||typeof value.allowDiscovery!=='boolean'||!Array.isArray(value.agents)||value.agents.length!==4)return null;
  const url=new URL(value.url);if(url.protocol!=='https:'||url.username||url.password)return null;
  const quality=value.quality;
  if(!quality||typeof quality.eligible!=='boolean'||![null,'access-gate','error','navigation','off-topic','insufficient-content'].includes(quality.reason)||
    quality.eligible!==(quality.reason===null)||!terms(quality.matchedTerms)||!score(quality.score,1))return null;
  if(new Set(value.agents.map(agent=>agent?.id)).size!==4||!value.agents.every(agent=>agent&&Object.hasOwn(agentNames,agent.id)&&agent.name===agentNames[agent.id]&&
    ['pass','hold','fail','not-run'].includes(agent.verdict)&&bounded(agent.reason,2000)&&(agent.matchedTerms===undefined||terms(agent.matchedTerms))))return null;
  if(value.storeMetadata!==(value.decision==='approve'||value.decision==='archive')||value.allowDiscovery!==(value.decision!=='reject')||
    (value.storeMetadata&&!quality.eligible)||(value.decision==='discover'&&quality.eligible))return null;
  if(value.decision==='approve'&&(value.agents.find(agent=>agent.id==='access-guard')?.verdict!=='pass'||value.agents.find(agent=>agent.id==='quality-reviewer')?.verdict!=='pass'))return null;
  return value;
 }catch{return null;}
}
