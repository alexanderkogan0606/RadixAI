/** Explanations inferred from supplied metadata, never from unseen page contents. */
export interface ResourceInput {
  id?:string; url?:string; name?:string; title?:string; description?:string;
  type?:string; category?:string; domain?:string; tags?:string[]; sourceId?:string; access?:string;
}
export type ResourceKind="filings"|"dataset"|"case-study"|"research"|"analysis"|"guide"|"homepage"|"navigation"|"resource";
export interface ResourceGuideOptions {query?:string;origin:"catalog"|"page"}
export interface ResourceGuide {
  purpose:string; howToUse:string; relevance:string; matchedTerms:string[]; evidenceLabel:string; kind:ResourceKind;
}

const stop=new Set("a an and are as at be been being but by can could did do does doing for from had has have how i if in into is it its me my of on or our please should show some tell than that the their them then there these they this those through to us use using was were what when where which who why will with would you your find help explain resource resources source sources research question anything related".split(" "));
function clean(value:unknown,max=2000){return typeof value==="string"?value.replace(/<[^>]*>/g," ").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max):""}
function terms(value:string){return [...new Set((value.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]+/gu)||[]).filter(term=>term.length>1&&!stop.has(term)))];}
function excerpt(value:string,max=240){if(value.length<=max)return value;const trimmed=value.slice(0,max-1);return trimmed.slice(0,Math.max(trimmed.lastIndexOf(" "),max-35))+"…"}
function usefulDescription(value:string){return value&&!/^(?:metadata captured from this page\.?|source added to your personal research catalog\.?|url discovered by the crawler[;,. ]|discovered through a link in this crawl\.?|no (?:description|summary)(?: is)? available\.?)/i.test(value)?value:""}
function isFeedUrl(address:string){
  try{
    const url=new URL(address),path=url.pathname.toLowerCase().replace(/\/+$/,"");
    return /(?:^|\/)(?:feeds?(?:\.(?:xml|json))?|rss\d?(?:\.xml)?|atom(?:\.xml)?)(?:\/|$)|\.(?:rss|atom)$/.test(path)||
      ["feed","format","alt","output"].some(key=>/^(?:rss\d?|atom|feed)$/i.test(url.searchParams.get(key)||""));
  }catch{return false}
}
function isTechnicalTitle(title:string){return /\b(?:training|fine[\s-]?tuning|finetuning|implementation|deployment)\b/i.test(title.replace(/[‐‑–—]/g,"-"))}

function classify(resource:ResourceInput,origin:ResourceGuideOptions["origin"],title:string,description:string):ResourceKind {
  let path="",isHome=false,search=false;
  try{
    const url=new URL(resource.url||"");
    path=decodeURIComponent(url.pathname).toLowerCase().replace(/\/+$/,"");
    isHome=/^(?:\/(?:[a-z]{2}(?:-[a-z]{2})?|index\.(?:html?|php)))?$/.test(path);
    search=["q","s","search"].some(key=>url.searchParams.has(key));
  }catch{/* Incomplete metadata should still produce a useful explanation. */}
  const titleText=title.toLowerCase(),type=clean(resource.type).toLowerCase();
  const navPath=/(?:^|\/)(?:about(?:-us)?|contact(?:-us)?|privacy(?:-policy)?|terms(?:-of-(?:use|service))?|cookies?|login|log-in|sign-in|signin|sign-up|signup|register|careers?|sitemap|search)(?:\/|$)/.test(path);
  const navTitle=/^(?:about(?: us)?|contact(?: us)?|privacy(?: policy)?|terms(?: of (?:use|service))?|cookie policy|log ?in|sign ?in|sign ?up|careers?|sitemap|search results)(?:\s*[|—–-].*)?$/.test(titleText);
  if(isFeedUrl(resource.url||"")||navPath||navTitle||(origin==="page"&&isHome&&search))return "navigation";
  if(origin==="page"&&(isHome||/^(?:home|homepage|welcome)(?:\s*[|—–-].*)?$/.test(titleText)))return "homepage";
  // Page categories can be inherited from a seed; prefer page-specific title/description.
  const text=`${title} ${description}`.toLowerCase();
  if(type==="filings"||/\b(?:10-k|10-q|20-f|13f|sec filings?|annual reports?|regulatory filings?|company disclosures?)\b/.test(text))return "filings";
  if(type==="dataset"||type==="api"||/\b(?:datasets?|data portal|statistical (?:tables?|series)|economic indicators|open data)\b/.test(titleText))return "dataset";
  if(type==="case library"||/\b(?:case stud(?:y|ies)|teaching cases?|post[ -]?mortems?)\b/.test(text))return "case-study";
  if(/\b(?:how[ -]to|tutorials?|documentation|implementation guide|step[ -]by[ -]step)\b/.test(text)||/\bguide\b/.test(titleText))return "guide";
  if(/\b(?:papers?|preprints?|journals?|systematic review)\b/.test(titleText))return "research";
  if(isTechnicalTitle(title))return "guide";
  if(/\b(?:papers?|preprints?|journals?|systematic review|academic research|research librar(?:y|ies)|research archive)\b/.test(text)||type==="research library")return "research";
  if(type==="publication"||/\b(?:analysis|commentary|editorial|industry report|market report|insights?)\b/.test(text))return "analysis";
  return "resource";
}

const profiles:Record<ResourceKind,{purpose:string;use:string}>={
  filings:{purpose:"Company or regulatory disclosure material.",use:"Find the relevant filing, reporting period and table. Check accounting definitions before comparing figures."},
  dataset:{purpose:"Data, statistical series or programmatic access.",use:"Locate the table, series or API documentation. Check units, geography, dates, methodology and coverage before comparing results."},
  "case-study":{purpose:"A case study or retrospective on organizational decisions.",use:"Identify the organization, problem, actions, timeline and reported outcomes. Then cross-check outcomes against another source."},
  research:{purpose:"Research papers or related scholarly material.",use:"Read the abstract, methods, sample and limitations. Check whether the study's setting applies to your question."},
  analysis:{purpose:"Reporting, interpretation or industry analysis.",use:"Check the author and date, distinguish interpretation from facts, and follow citations to the original evidence."},
  guide:{purpose:"An explanation, tutorial or practical guide.",use:"Check the prerequisites, steps and examples. Verify that the approach fits your situation."},
  homepage:{purpose:"A website entry point.",use:"Use site search to find a specific article, dataset, case or filing. Evaluate that document before citing it."},
  navigation:{purpose:"Site navigation or information.",use:"Follow links to the original material. Use this page directly only if your question concerns the site information itself."},
  resource:{purpose:"Research material to inspect.",use:"Open the resource and check its subject, author and date. Identify the passages or references relevant to your question."},
};

export function resourceGuide(resource:ResourceInput,options:ResourceGuideOptions={origin:"catalog"}):ResourceGuide {
  const title=clean(resource.title)||clean(resource.name),description=usefulDescription(clean(resource.description));
  const query=clean(options.query,500),queryTerms=terms(query);
  const tags=Array.isArray(resource.tags)?resource.tags.map(tag=>clean(tag)).join(" "):"";
  const direct=new Set(terms(`${title} ${description}`)),context=new Set(terms(`${clean(resource.category)} ${tags}`));
  const matchedTerms=queryTerms.filter(term=>direct.has(term)||context.has(term));
  const directMatches=matchedTerms.filter(term=>direct.has(term)),contextOnly=matchedTerms.filter(term=>!direct.has(term));
  const kind=classify(resource,options.origin,title,description),profile=profiles[kind],feed=isFeedUrl(resource.url||"");
  const technical=kind==="guide"&&isTechnicalTitle(title);
  const fallback=feed?"A feed of published items.":technical?"A technical write-up on training, implementation or deployment.":profile.purpose;
  const purpose=description?excerpt(description,220):`${fallback} Summary unavailable.`;
  const lowDirect=kind==="homepage"||kind==="navigation";
  let relevance:string;
  if(lowDirect){
    relevance=feed?"Low direct relevance: a feed lists items; follow an entry to assess its evidence.":"Low direct relevance: use this page to locate the original research material.";
    if(matchedTerms.length)relevance+=" A matching label does not establish an answer.";
  }else if(!queryTerms.length){
    relevance="No specific research question supplied; topic overlap has not been assessed.";
  }else if(directMatches.length){
    relevance=`Title or description matches ${directMatches.slice(0,5).map(term=>`“${term}”`).join(", ")}. Check the original for evidence that answers your question.`;
  }else if(contextOnly.length){
    relevance=`Only category or tags match ${contextOnly.slice(0,5).map(term=>`“${term}”`).join(", ")}${options.origin==="page"?"; these may describe the collection rather than this page":""}. Direct relevance is unconfirmed.`;
  }else{
    relevance="No matching terms in the supplied metadata. Open the original to check its relevance.";
  }
  const howToUse=feed?"Open an entry's original URL and check its date and content. Use the feed to discover updates, not as the underlying evidence.":technical?"Check the model or system, configuration, compute requirements and evaluation setup. Compare those conditions with your own use case.":profile.use;
  const knownAccess=["free","freemium","mixed","paid","unknown"].includes(clean(resource.access).toLowerCase())?clean(resource.access):"";
  const evidenceLabel=`${options.origin==="page"?description?"Captured page metadata · full text not assessed":"Page title/URL only · summary unavailable":"Catalog metadata · original content not assessed"}${knownAccess?` · Reported access: ${knownAccess}`:""}`;
  return {purpose,howToUse,relevance,matchedTerms,evidenceLabel,kind};
}
