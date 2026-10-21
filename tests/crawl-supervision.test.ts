import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Native Node test execution needs the explicit extension.
import {reviewCrawlCandidate,reviewCrawlFailure,parseAgentReview,AGENT_REVIEW_PREFIX} from '../lib/crawl-supervision.ts';

const candidate={url:'https://research.org/papers/bank-mergers',title:'Bank merger integration and profitability outcomes',description:'This study compares bank merger integration, cost savings and profitability outcomes across financial institutions.',query:'bank mergers',access:'Free' as const};
test('The Chief approves only a relevant substantive candidate with free evidence',async()=>{
 const result=await reviewCrawlCandidate(candidate);
 assert.equal(result.decision,'approve');assert.equal(result.storeMetadata,true);assert.equal(result.agents.length,4);
 assert.ok(result.agents.every(agent=>agent.verdict==='pass'));assert.equal(result.mode,'rule-based');assert.equal(result.score,100);
 assert.deepEqual(parseAgentReview(AGENT_REVIEW_PREFIX+JSON.stringify(result)),result);
});
test('Unknown access is held from free Results without losing attributable archive metadata',async()=>{
 const result=await reviewCrawlCandidate({...candidate,access:'Unknown'});
 assert.equal(result.decision,'archive');assert.equal(result.storeMetadata,true);
 assert.equal(result.agents.find(agent=>agent.id==='access-guard')?.verdict,'hold');
});
test('Session expiry, paid access, and incidental topic mentions cannot be approved',async()=>{
 for(const input of [{...candidate,description:'Your session is about to expire due to inactivity.'},{...candidate,access:'Mixed' as const}]){
  const result=await reviewCrawlCandidate(input);assert.equal(result.decision,'reject');assert.equal(result.storeMetadata,false);assert.equal(result.allowDiscovery,false);
 }
 const unrelated=await reviewCrawlCandidate({...candidate,title:'Customer retention in hotels',description:'Customer retention and subscription pricing in hotels are discussed with comparison to banking marketing methods.',query:'SaaS pricing and customer retention'});
 assert.equal(unrelated.decision,'discover');assert.equal(unrelated.storeMetadata,false);
 assert.equal(unrelated.agents.find(agent=>agent.id==='relevance-reviewer')?.verdict,'fail');
});
test('Feeds remain discovery leads and the Chief does not pretend to score a missing question',async()=>{
 const feed=await reviewCrawlCandidate({...candidate,url:'https://research.org/feed',title:'Research feed'});
 assert.equal(feed.decision,'discover');assert.equal(feed.allowDiscovery,true);assert.equal(feed.storeMetadata,false);
 const generic=await reviewCrawlCandidate({...candidate,query:'Research crawl'});
 assert.equal(generic.score,null);assert.equal(generic.agents.find(agent=>agent.id==='relevance-reviewer')?.verdict,'hold');
 assert.match(generic.reason,/No specific topic was supplied.*topical relevance was not assessed/);
 assert.doesNotMatch(generic.reason,/relevant metadata/);
 const genericArchive=await reviewCrawlCandidate({...candidate,query:'',access:'Unknown'});
 assert.equal(genericArchive.decision,'archive');assert.equal(genericArchive.score,null);
 assert.match(genericArchive.reason,/topical relevance was not assessed/);assert.doesNotMatch(genericArchive.reason,/metadata is relevant/);
});
test('A provider-validated filing may use a fiscal-period match, but still cannot bypass a gate',async()=>{
 const filing={...candidate,title:'Apple Inc. AAPL 10-Q period ended 2024-12-28',description:'Apple filed this quarterly report on form 10-Q with the SEC for the period ended December 28, 2024.',query:'AAPL Q1 FY2025',validatedFiling:true};
 assert.equal((await reviewCrawlCandidate(filing)).decision,'approve');
 assert.equal((await reviewCrawlCandidate({...filing,description:'Please sign in to continue'})).decision,'reject');
});
test('A fetch failure records unrun relevance checks and rejects malformed audit messages',()=>{
 const failure=reviewCrawlFailure(candidate.url,candidate.query,'Source returned HTTP 403');
 assert.equal(failure.decision,'reject');assert.equal(failure.storeMetadata,false);
 assert.equal(failure.agents.find(agent=>agent.id==='relevance-reviewer')?.verdict,'not-run');
 assert.equal(parseAgentReview('regular event'),null);assert.equal(parseAgentReview(AGENT_REVIEW_PREFIX+'{'),null);
 assert.equal(parseAgentReview(AGENT_REVIEW_PREFIX+JSON.stringify({...failure,agents:[]})),null);
});

test('AI and title subjects beyond twenty metadata terms remain eligible',async()=>{
 const result=await reviewCrawlCandidate({...candidate,query:'AI banking',title:'Modernizing retail banking',description:'This review covers credit scoring, risk controls, lending operations, regulatory compliance, organizational change, staff training, customer service, governance, oversight, technology procurement, evaluation, implementation, deployment and artificial intelligence.'});
 assert.equal(result.decision,'approve');assert.deepEqual(result.quality.matchedTerms,['ai','bank']);
 const longTitle='Credit scoring lending operations regulatory compliance organizational change staff training customer service governance oversight technology procurement evaluation deployment performance controls integration AI banking';
 const long=await reviewCrawlCandidate({...candidate,query:'AI banking',title:longTitle,description:'Artificial intelligence deployment is evaluated across banking institutions and lending operations.'});
 assert.equal(long.decision,'approve');assert.equal(long.agents.find(agent=>agent.id==='relevance-reviewer')?.verdict,'pass');
});

test('SaaS and its spelled-out form normalize before topical assessment without changing the stored query',async()=>{
 for(const query of ['SaaS pricing','Software-as-a-service pricing','software as a service pricing']){
  const result=await reviewCrawlCandidate({...candidate,query,title:'Software-as-a-service pricing models',description:'This study examines software as a service pricing models and customer retention across enterprise software vendors.'});
  assert.equal(result.decision,'approve',query);assert.deepEqual(result.quality.matchedTerms,['saas','price']);assert.equal(result.query,query);
 }
 const incidental=await reviewCrawlCandidate({...candidate,query:'SaaS pricing and customer retention',title:'Customer retention in hotels',description:'Customer retention and subscription pricing in hotels are compared across several hospitality businesses.'});
 assert.equal(incidental.decision,'discover');assert.equal(incidental.agents.find(agent=>agent.id==='relevance-reviewer')?.verdict,'fail');
});

test('Access gates, errors, navigation and insufficient metadata never receive passing relevance verdicts',async()=>{
 const cases=[
  {title:'Session expired',description:'Please sign in to continue',url:candidate.url,verdict:'not-run'},
  {title:'404 Not found',description:'The requested page could not be found.',url:candidate.url,verdict:'not-run'},
  {title:'Research feed',description:candidate.description,url:'https://research.org/feed',verdict:'hold'},
  {title:'Short note',description:'Brief.',url:candidate.url,verdict:'hold'},
 ];
 for(const {verdict,...input} of cases){
  const result=await reviewCrawlCandidate({...candidate,...input});
  const relevance=result.agents.find(agent=>agent.id==='relevance-reviewer')!;
  assert.equal(relevance.verdict,verdict,input.title);assert.doesNotMatch(relevance.reason,/match the research objective/);
  assert.equal(result.score,null);assert.equal(result.storeMetadata,false);
 }
});

test('Audit parser requires four distinct named agents and complete internally consistent review fields',async()=>{
 const valid=await reviewCrawlCandidate(candidate),encode=(value:unknown)=>AGENT_REVIEW_PREFIX+JSON.stringify(value);
 assert.ok(parseAgentReview(encode(valid)));
 assert.ok(parseAgentReview(encode(reviewCrawlFailure(candidate.url,candidate.query,'HTTP 403'))));
 for(const key of ['query','checkedAt','score','storeMetadata','allowDiscovery','quality']){
  const missing:Record<string,unknown>={...valid};delete missing[key];assert.equal(parseAgentReview(encode(missing)),null,`missing ${key}`);
 }
 const malformed=[
  {...valid,agents:Array(4).fill(valid.agents[0])},
  {...valid,agents:valid.agents.map((agent,index)=>index===0?{...agent,name:'Misleading label'}:agent)},
  {...valid,agents:valid.agents.map((agent,index)=>index===0?{...agent,matchedTerms:[12]}:agent)},
  {...valid,query:12},{...valid,checkedAt:'not a timestamp'},{...valid,score:101},{...valid,score:'100'},
  {...valid,storeMetadata:'true'},{...valid,storeMetadata:false},{...valid,allowDiscovery:false},
  {...valid,quality:{...valid.quality,eligible:false}},{...valid,quality:{...valid.quality,score:1.5}},
  {...valid,quality:{...valid.quality,matchedTerms:'bank'}},{...valid,quality:{...valid.quality,reason:'invented'}},
  {...valid,url:'javascript:alert(1)'},
  {...valid,agents:valid.agents.map(agent=>agent.id==='access-guard'?{...agent,verdict:'fail'}:agent)},
 ];
 for(const value of malformed)assert.equal(parseAgentReview(encode(value)),null,JSON.stringify(value));
});
