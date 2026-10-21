'use client';
import {Check,Search,TriangleAlert} from 'lucide-react';
import type {ProviderStatus} from '../lib/discovery';
import {searchOutcome,providerExplanation} from '../lib/search-status';

export default function SearchStatus({providers,total,newCount}:{providers:ProviderStatus[];total:number;newCount?:number}){
 const outcome=searchOutcome(providers,total,newCount);
 return <div className={`search-outcome is-${outcome.state}`}>
  <div className="search-outcome-title">{outcome.state==='available'?<Check size={13}/>:outcome.state==='unavailable'?<TriangleAlert size={13}/>:<Search size={13}/>}<span>{outcome.label}</span></div>
  <p>{outcome.detail}</p>
  <details className="search-provider-details"><summary>Search coverage · {providers.length} source{providers.length===1?'':'s'}{outcome.unavailable?` · ${outcome.unavailable} unavailable`:''}</summary>
   <dl>{providers.map(provider=><div key={provider.provider}><dt>{provider.provider}<span>{provider.status==='ok'?`${provider.count} found`:provider.status==='empty'?'no matches':provider.status==='rate-limited'?'cooling down':'unavailable'}</span></dt><dd>{providerExplanation(provider)}</dd></div>)}</dl>
  </details>
 </div>;
}
