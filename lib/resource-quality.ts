/** Conservative metadata quality checks. Eligibility is not a claim that full text was read. */
export interface ResourceCandidate {url:string;title?:string;name?:string;description?:string}
export type ResourceRejection="access-gate"|"error"|"navigation"|"off-topic"|"insufficient-content";
export interface ResourceAssessment {eligible:boolean;reason:ResourceRejection|null;matchedTerms:string[];score:number}

const stop=new Set("a an and are as at be been being but by can could did do does for from had has have how i if in into is it its me my of on or our please should show some tell than that the their them then there these they this those through to us use used using was were what when where which who why will with would you your about find help explain resource resources source sources research question anything related information overview understanding understand learn explore article articles paper papers report reports document documents case cases study studies examples example business finance technology tech insights insight analysis latest recent new free paid only just relevant good best detailed comprehensive evidence".split(" "));
const forms:Record<string,string>={mergers:"merger",acquisition:"merger",acquisitions:"merger",acquired:"merger",acquire:"merger",takeover:"merger",takeovers:"merger",banking:"bank",banks:"bank",pricing:"price",prices:"price",priced:"price",costs:"cost",companies:"company",failures:"failure",failed:"failure",failing:"failure",startups:"startup",models:"model",llms:"llm",risks:"risk",datasets:"dataset",deployments:"deployment",deploying:"deployment",deployed:"deployment",implementation:"deployment",competition:"competitor",competitors:"competitor",competitive:"competitor",valuations:"valuation",returns:"return"};
const genericObjectives=/^(?:(?:live|crawl(?:er)?|spider|graph|animation|replay|playback|smoke|integration|backend|frontend|validation|test(?:ing)?|demo|check|run|research|general|sample|example|metadata|public|free|resources?|sources?)\s*)+$/i;
function clean(value:unknown){return typeof value==="string"?value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ").replace(/<[^>]*>/g," ").replace(/&amp;|&#38;/gi,"&").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,8000):""}
function normalizedText(value:string){
  return clean(value).normalize("NFKC").toLowerCase().replace(/[’']s\b/g,"")
    .replace(/\bdeep[\s-]?dive\b/g," ")
    .replace(/\bm\s*(?:&|and)\s*a\b/g," merger ").replace(/\bartificial intelligence\b/g," ai ").replace(/\bmachine learning\b/g," ai ")
    // Customer acquisition is a marketing concept, not a corporate acquisition.
    .replace(/\b(customer|user|talent|traffic|data) acquisitions?\b/g,"$1acquisition");
}
function tokens(value:string){return (normalizedText(value).match(/[\p{L}\p{N}]+/gu)||[]).filter(term=>term.length>1&&!stop.has(term)).map(term=>forms[term]||term)}
export function queryTerms(query=""):string[]{const value=clean(query);return genericObjectives.test(value)?[]:[...new Set(tokens(value))].slice(0,20)}
export function cleanSearchQuery(query=""):string {
  return clean(query).replace(/\bm\s*&\s*a\b/gi,"mergers and acquisitions").replace(/^(?:please\s+)?(?:can you\s+|could you\s+)?(?:find|show|give|tell)\s+(?:me\s+)?(?:research\s+(?:on|about)\s+|(?:information|resources?|papers?|articles?)\s+(?:on|about)\s+)?/i,"").replace(/[?]+$/g,"").trim().slice(0,300);
}

function urlInfo(address:string){try{const url=new URL(address),path=decodeURIComponent(url.pathname).toLowerCase().replace(/\/+$/,"");return {url,path}}catch{return null}}
export function isFeedUrl(address:string){const info=urlInfo(address);return !!info&&(/(?:^|\/)(?:feeds?(?:\.(?:xml|json))?|rss\d?(?:\.xml)?|atom(?:\.xml)?)(?:\/|$)|\.(?:rss|atom)$/.test(info.path)||["feed","format","alt","output"].some(key=>/^(?:rss\d?|atom|feed)$/i.test(info.url.searchParams.get(key)||"")))}
const gatePath=/(?:^|\/)(?:login|log-in|signin|sign-in|signup|sign-up|register|logout|account|accounts|auth|authenticate|authentication|session|captcha|challenge)(?:[./]|$)/;
const unhelpfulPath=/(?:^|\/)(?:about(?:-us)?|contact(?:-us)?|privacy(?:-policy)?|terms(?:-of-(?:use|service))?|cookies?|legal|accessibility|careers?|unsubscribe|preferences|settings)(?:[./]|$)/;
const collectionPath=/^(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/(?:index\.(?:html?|php|aspx)|home|blog|news|research|publications|papers|reports|resources|articles|library|case-studies|search|search-results|sitemap)(?:\.(?:html?|aspx|xml))?$/;
const gateNotice=/\b(?:your session (?:is (?:about to|going to) expire|has expired|expired)|session (?:timeout|timed out)|(?:please )?(?:sign|log)\s*in (?:again|to (?:continue|access|view|read))|authentication required|verify (?:that )?you are (?:a )?human|checking your browser|complete (?:the |this )?captcha|enable javascript and cookies to continue|please enable javascript to (?:continue|view)|access denied|robot verification|security verification required|subscribe to (?:continue reading|read (?:the full|this))|you have been (?:logged|signed) out)\b/i;
const gateTitle=/^(?:sign\s*in|log\s*in|login|register|access denied|just a moment|security check|verify you are human|captcha|session expired|request rejected)(?:\b|\s*[|—–-])/i;
const errorTitle=/^(?:(?:error\s*)?(?:404|403|500|502|503)\b|(?:page|document|file|resource) (?:not found|unavailable)|not found|service unavailable|internal server error|something went wrong|temporarily unavailable)/i;
const boilerplate=/^(?:your session|we use cookies|this (?:site|website) uses cookies|by (?:using|continuing to use) (?:this|our) (?:site|website|service)|accept (?:all )?cookies|all rights reserved|copyright\b|loading(?:\.{0,3})?$|please wait|welcome to|source added to your personal research catalog|metadata captured from this page|url discovered by the crawler|no (?:description|summary)(?: is)? available)/i;

export function assessResource(resource:ResourceCandidate,query=""):ResourceAssessment {
  const title=clean(resource.title)||clean(resource.name),description=clean(resource.description),text=`${title} ${description}`,info=urlInfo(resource.url);
  const wanted=queryTerms(query),titleTokens=new Set(tokens(title)),descriptionTokens=new Set(tokens(description));
  const matchedTerms=wanted.filter(term=>titleTokens.has(term)||descriptionTokens.has(term));
  const score=wanted.length?Math.round(matchedTerms.reduce((sum,term)=>sum+(titleTokens.has(term)?1:.75),0)/wanted.length*100)/100:0;
  const reject=(reason:ResourceRejection):ResourceAssessment=>({eligible:false,reason,matchedTerms,score});
  if(gateNotice.test(text)||gateTitle.test(title)||(info&&gatePath.test(info.path)))return reject("access-gate");
  if(errorTitle.test(title)||/^(?:the (?:page|document|file) (?:you (?:requested|are looking for) )?(?:could not|cannot) be found|an unexpected error (?:has )?occurred)/i.test(description))return reject("error");
  const home=info&&/^(?:\/[a-z]{2}(?:-[a-z]{2})?)?$/.test(info.path);
  const search=info&&(/(?:^|\/)search(?:[./]|$)/.test(info.path)||(["q","s","search"].some(key=>info.url.searchParams.has(key))&&(!info.path||collectionPath.test(info.path))));
  const navTitle=/^(?:home|welcome|about(?: us)?|contact(?: us)?|privacy(?: policy)?|terms(?: of (?:use|service))?|research|publications|resources|news|blog|search results|sitemap)(?:\s*[|—–-].*)?$/i.test(title);
  if(home||search||isFeedUrl(resource.url)||navTitle||(info&&(unhelpfulPath.test(info.path)||collectionPath.test(info.path))))return reject("navigation");
  const meaningfulSummary=description.length>=28&&description.split(/\s+/).length>=5&&new Set(tokens(description)).size>=3&&!boilerplate.test(description);
  const detailedTitle=title.length>=45&&title.split(/\s+/).length>=7&&new Set(tokens(title)).size>=4;
  if(!title||boilerplate.test(description)||(!meaningfulSummary&&!detailedTitle))return reject("insufficient-content");
  if(wanted.length){
    const needed=wanted.length===1?1:2;
    if(matchedTerms.length<needed)return reject("off-topic");
    // A generic trailing term or year cannot compensate for missing the main subject.
    const important=wanted.filter(term=>!/^\d+$/.test(term)&&!["company","market","growth","risk","cost","price"].includes(term));
    if(important.length&&!important.some(term=>matchedTerms.includes(term)))return reject("off-topic");
  }
  return {eligible:true,reason:null,matchedTerms,score};
}

/** Discovery priority can use URL/anchor text; it never establishes document relevance. */
export function linkPriority(link:{url:string;title?:string;description?:string},query=""):number {
  const info=urlInfo(link.url);if(!info||gatePath.test(info.path)||unhelpfulPath.test(info.path))return -1;
  const title=clean(link.title);if(gateTitle.test(title)||/^(?:sign\s*up|subscribe|privacy|terms|contact|about us|cookie settings)$/i.test(title))return -1;
  if([...info.url.searchParams.keys()].some(key=>/^(?:sessionid|session_id|sid|token|logout|login|auth)$/i.test(key)))return -1;
  const wanted=queryTerms(query),words=new Set(tokens(`${info.path.replace(/[-_/]/g," ")} ${title} ${clean(link.description)}`));
  const matched=wanted.filter(term=>words.has(term)).length;
  return matched*10+(isFeedUrl(link.url)?2:/(?:^|\/)(?:research|reports|publications|articles|blog|papers)(?:\/|$)/.test(info.path)?1:0);
}
