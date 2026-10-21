import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Native Node tests need explicit extensions.
import {searchOutcome,providerExplanation} from '../lib/search-status.ts';
const limited={provider:'OpenAlex' as const,status:'rate-limited' as const,count:0,message:"The provider's free search limit was reached. Try again later."};
test('Partial provider failure does not misrepresent usable search results as failure',()=>{
 const outcome=searchOutcome([limited,{provider:'Crossref',status:'ok',count:12}],12);
 assert.equal(outcome.state,'available');assert.match(outcome.label,/12 free documents/);
 assert.match(outcome.detail,/continued/);assert.doesNotMatch(outcome.detail,/try again/i);
 assert.doesNotMatch(providerExplanation(limited),/try again|your.*limit/i);
});
test('Empty, failed, and cumulative batches remain distinguishable',()=>{
 assert.equal(searchOutcome([limited],0).state,'unavailable');
 assert.equal(searchOutcome([{provider:'World Bank',status:'empty',count:0}],0).state,'empty');
 assert.equal(searchOutcome([limited],15,0).state,'available');
 assert.match(searchOutcome([limited],15,0).label,/No new/);
 assert.match(searchOutcome([{provider:'Crossref',status:'ok',count:4}],19,4).label,/4 free/);
});
