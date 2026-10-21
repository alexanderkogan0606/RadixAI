import type {ProviderStatus} from './discovery';

/** Describe the whole search, separately from individual provider diagnostics. */
export function searchOutcome(providers:ProviderStatus[],total:number,newCount=total){
 const unavailable=providers.filter(provider=>!['ok','empty'].includes(provider.status));
 const allUnavailable=providers.length>0&&unavailable.length===providers.length;
 return {
  state:total>0?'available':allUnavailable?'unavailable':'empty',
  label:total>0?(newCount>0?`${newCount} free document${newCount===1?'':'s'} added`:'No new documents in this batch'):allUnavailable?'Search sources are temporarily unavailable':'No verified matches in this batch',
  detail:total>0&&allUnavailable?'No new records could be retrieved in this batch. Your previously collected documents remain available.':total>0&&unavailable.length?'Search continued with available sources. Your collected documents are ready to use.':total>0?'Results are saved to your workspace. This is a search batch, not a count of everything available.':allUnavailable?'No results were confirmed in this attempt. Your previously saved research is still available.':'A batch with no matches does not mean no relevant documents exist.',
  unavailable:unavailable.length,
 };
}

export function providerExplanation(provider:ProviderStatus){
 if(provider.status==='rate-limited')return 'Temporarily throttled by this source. Automatic requests to it pause during its cooldown.';
 if(provider.status==='timeout')return 'This source did not finish within the batch deadline.';
 if(provider.status==='error')return 'This source could not complete its part of the search.';
 return provider.message||`${provider.count} eligible document${provider.count===1?'':'s'} returned in this batch.`;
}
