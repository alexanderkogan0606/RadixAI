import type {DiscoveredDocument,DiscoveryOptions,ProviderStatus} from "./discovery";

type Row=Record<string,unknown>;
type Company={cik:string;name:string;tickers:string[];aliases?:string[]};
type Intent={forms:string[];year?:number;quarter?:number;periodEnd?:string;calendar:boolean;latest:boolean};
export interface FilingDiscoveryResult {documents:DiscoveredDocument[];status:ProviderStatus}
const PROVIDER="SEC EDGAR" as const;
const USER_AGENT="RadixAI/1.0 (+https://radixai.sk1616.chatgpt.site/)";
const MAX_BYTES=2_000_000, MAX_COMPANIES=2, MAX_DOCUMENTS=6;
const defaultFetcher:typeof fetch=(input,init)=>globalThis.fetch(input,init);
const row=(value:unknown):Row=>value&&typeof value==="object"&&!Array.isArray(value)?value as Row:{};
const text=(value:unknown)=>typeof value==="string"?value.replace(/<[^>]*>/g," ").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim():"";
const normalize=(value:string)=>value.toLowerCase().replace(/[’']s\b/g,"").replace(/[^a-z0-9]+/g," ").trim();
const phrase=(query:string,value:string)=>!!value&&` ${normalize(query)} `.includes(` ${normalize(value)} `);
const validDate=(value:unknown)=>{const date=text(value);return /^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))?date:undefined;};
// Stable CIK identifiers, verified against the SEC's company_tickers.json. The submissions
// response must independently confirm the CIK before any document is returned.
const common:Company[]=[
  {cik:"320193",name:"Apple",tickers:["AAPL"]},{cik:"789019",name:"Microsoft",tickers:["MSFT"]},
  {cik:"1045810",name:"NVIDIA",tickers:["NVDA"]},{cik:"1018724",name:"Amazon",tickers:["AMZN"]},
  {cik:"1652044",name:"Alphabet",tickers:["GOOGL","GOOG"],aliases:["Google"]},
  {cik:"1326801",name:"Meta Platforms",tickers:["META"],aliases:["Facebook","Meta"]},
  {cik:"1318605",name:"Tesla",tickers:["TSLA"]},{cik:"19617",name:"JPMorgan Chase",tickers:["JPM"],aliases:["JPMorgan"]},
  {cik:"1065280",name:"Netflix",tickers:["NFLX"]},{cik:"2488",name:"Advanced Micro Devices",tickers:["AMD"]},
  {cik:"1341439",name:"Oracle",tickers:["ORCL"]},{cik:"51143",name:"International Business Machines",tickers:["IBM"]},
  {cik:"1108524",name:"Salesforce",tickers:["CRM"]},{cik:"50863",name:"Intel",tickers:["INTC"]},
];
const ambiguousTickers=new Set("A AI ON IT ARE FOR NOW ALL AS BE BY CAN DO GO HAS HOW IN IS NEW OF OR SO THE TO USE WE WITH YOU AN AT CEO CFO Q1 Q2 Q3 Q4 SEC USA USD FIND SHOW GIVE TELL FORM FORMS YEAR YEARS LATEST RECENT CURRENT ANNUAL QUARTER QUARTERLY REPORT REPORTS FINANCIAL STATEMENT STATEMENTS EARNINGS COMPANY COMPANIES".split(" "));

/** Filing requests are routed to public company filings, never academic-paper substitutes. */
export function isFilingQuery(query:string):boolean {
  return /\b(?:10[ -]?[qk]|20[ -]?f|40[ -]?f|quarterly(?:\s+(?:financial\s+)?reports?)?|annual\s+(?:financial\s+)?reports?|financial\s+(?:statements?|reports?)|earnings(?:\s+(?:reports?|results?|releases?))?|sec\s+filings?|q[1-4]\s+(?:fy\s*)?(?:19|20)\d{2})\b/i.test(query);
}
function intentFor(query:string):Intent {
  const annual=/\b(?:annual|10[ -]?k|20[ -]?f|40[ -]?f)\b/i.test(query),quarterly=/\b(?:quarterly|10[ -]?q|q[1-4])\b/i.test(query);
  return {forms:annual&&!quarterly?["10-K","20-F","40-F"]:quarterly&&!annual?["10-Q"]:["10-Q","10-K","20-F","40-F"],
    year:Number(query.match(/\b(?:fy\s*)?((?:19|20)\d{2})\b/i)?.[1])||undefined,quarter:Number(query.match(/\bq([1-4])\b/i)?.[1])||undefined,
    periodEnd:validDate(query.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0]),
    calendar:/\bcalendar\b/i.test(query),latest:/\b(?:latest|most recent|current)\b/i.test(query)};
}
function tickerMatch(query:string,ticker:string):boolean {
  const escaped=ticker.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  if(new RegExp(`(?:\\$|\\bticker\\s*[:=]?\\s*)${escaped}(?![a-z0-9])`,"i").test(query))return true;
  return ticker.length>1&&!ambiguousTickers.has(ticker.toUpperCase())&&phrase(query,ticker);
}
function matchesCompany(query:string,company:Company):boolean {
  return company.tickers.some(ticker=>tickerMatch(query,ticker))||[company.name,...(company.aliases||[])].some(name=>phrase(query,name));
}
function cleanCompanyName(value:string):string {
  return normalize(value).replace(/\b(?:incorporated|inc|corporation|corp|company|co|limited|ltd|holdings?|plc|llc|group)\b/g," ").replace(/\s+/g," ").trim();
}
function lookupCompanies(payload:unknown,query:string):Company[] {
  const entries=Object.values(row(payload));if(!entries.length)throw new SecFailure("error","SEC returned an empty company directory.");
  const companies=new Map<string,Company>();
  for(const value of entries.slice(0,20000)){
    const item=row(value),cik=String(item.cik_str??"").replace(/^0+/,""),ticker=text(item.ticker),name=text(item.title);
    if(!/^\d{1,10}$/.test(cik)||!ticker||!name)continue;
    const shortName=cleanCompanyName(name),nameWords=shortName.split(" ");
    const company={cik,name,tickers:[ticker]};
    // A one-word name must be distinctive; ordinary query words cannot identify a company.
    const nameMatch=shortName.length>=4&&!ambiguousTickers.has(shortName.toUpperCase())&&phrase(query,shortName);
    if(tickerMatch(query,ticker)||nameMatch||(nameWords.length>1&&phrase(query,name)))companies.set(cik,company);
  }
  return [...companies.values()];
}
class SecFailure extends Error {
  status:ProviderStatus["status"];httpStatus?:number;
  constructor(status:ProviderStatus["status"],message:string,httpStatus?:number){super(message);this.status=status;this.httpStatus=httpStatus;}
}
// Serial start slots keep each Worker isolate below five SEC requests/second; caching
// and in-flight coalescing avoid repeated directory/submission downloads.
type NetworkState={nextStart:number;cache:Map<string,{expires:number;value:Promise<unknown>}>};
const networkStates=new WeakMap<typeof fetch,NetworkState>();
function networkState(fetcher:typeof fetch){let state=networkStates.get(fetcher);if(!state){state={nextStart:0,cache:new Map()};networkStates.set(fetcher,state);}return state;}
async function secJson(url:string,fetcher:typeof fetch,deadline:number,ttl:number):Promise<unknown> {
  const state=networkState(fetcher),cached=state.cache.get(url);
  if(cached&&cached.expires>Date.now())return cached.value;
  const controller=new AbortController();let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,timer:ReturnType<typeof setTimeout>|undefined;
  const remaining=deadline-Date.now();if(remaining<=0)throw new SecFailure("timeout","SEC did not respond before the search deadline. Try again later.");
  const value=(async()=>{
    const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();void reader?.cancel().catch(()=>{});reject(new SecFailure("timeout","SEC did not respond before the search deadline. Try again later."));},remaining);});
    try{return await Promise.race([timeout,(async()=>{
      const start=Math.max(Date.now(),state.nextStart);state.nextStart=start+210;
      if(start>=deadline)throw new SecFailure("timeout","SEC request capacity is busy. Try again shortly.");
      if(start>Date.now())await new Promise(resolve=>setTimeout(resolve,start-Date.now()));
      if(controller.signal.aborted)throw new SecFailure("timeout","SEC did not respond before the search deadline. Try again later.");
      const response=await fetcher(url,{headers:{Accept:"application/json","User-Agent":USER_AGENT},redirect:"manual",signal:controller.signal});
      if(!response.ok){void response.body?.cancel();throw new SecFailure(response.status===429?"rate-limited":"error",response.status===403?"SEC denied this request (HTTP 403). No filing links were substituted. Try again later.":response.status===429?"SEC's public access rate limit was reached. Try again later.":`SEC returned HTTP ${response.status}.`,response.status);}
      if(Number(response.headers.get("content-length")||0)>MAX_BYTES){void response.body?.cancel();throw new SecFailure("error","SEC's response exceeded the two-megabyte search limit.");}
      const contentType=response.headers.get("content-type")||"";
      if(contentType&&!/\bjson\b/i.test(contentType)){void response.body?.cancel();throw new SecFailure("error","SEC returned a non-JSON response.");}
      if(!response.body)throw new SecFailure("error","SEC returned an empty response.");
      reader=response.body.getReader();const decoder=new TextDecoder();let bytes=0,body="";
      while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>MAX_BYTES){void reader.cancel();throw new SecFailure("error","SEC's response exceeded the two-megabyte search limit.");}body+=decoder.decode(chunk.value,{stream:true});}
      reader.releaseLock();reader=undefined;body+=decoder.decode();
      try{return JSON.parse(body);}catch{throw new SecFailure("error","SEC returned malformed JSON.");}
    })()]);}finally{if(timer)clearTimeout(timer);}
  })();
  if(state.cache.size>80)state.cache.clear();
  state.cache.set(url,{value,expires:Date.now()+ttl});
  try{return await value;}catch(error){state.cache.delete(url);throw error;}
}
function fiscalPeriod(reportDate:string,fiscalYearEnd:string):{year:number;quarter:number}|undefined {
  if(!/^\d{4}$/.test(fiscalYearEnd))return;
  const month=Number(fiscalYearEnd.slice(0,2)),day=Number(fiscalYearEnd.slice(2)),date=new Date(`${reportDate}T00:00:00Z`);
  if(month<1||month>12||day<1||day>31)return;
  let closest:{year:number;quarter:number;distance:number}|undefined;
  for(let year=date.getUTCFullYear()-1;year<=date.getUTCFullYear()+1;year++)for(let quarter=1;quarter<=4;quarter++){
    const target=new Date(Date.UTC(year,month-1-(4-quarter)*3,1));
    const lastDay=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();target.setUTCDate(Math.min(day,lastDay));
    const distance=Math.abs(date.valueOf()-target.valueOf());if(!closest||distance<closest.distance)closest={year,quarter,distance};
  }
  return closest&&closest.distance<=15*86400000?{year:closest.year,quarter:closest.quarter}:undefined;
}
function filingDocuments(payload:Row,columns:Row,company:Company,intent:Intent,query:string,foundAt:string):DiscoveredDocument[] {
  if(!Array.isArray(columns.form))throw new SecFailure("error","SEC returned an unexpected filing history.");
  const name=text(payload.name).slice(0,300),cik=String(payload.cik??"").replace(/^0+/,"");
  if(cik!==company.cik||!name)throw new SecFailure("error","SEC's company identifier did not match the requested company.");
  const tickers=Array.isArray(payload.tickers)?payload.tickers.filter(t=>typeof t==="string").slice(0,4).join(", "):company.tickers.join(", ");
  const get=(key:string,index:number)=>Array.isArray(columns[key])?columns[key][index]:undefined;
  const documents:DiscoveredDocument[]=[];
  for(let i=0;i<Math.min(columns.form.length,5000);i++){
    const form=text(get("form",i));if(!intent.forms.includes(form))continue;
    const accession=text(get("accessionNumber",i)),primary=text(get("primaryDocument",i)),reportDate=validDate(get("reportDate",i)),filingDate=validDate(get("filingDate",i));
    if(!/^\d{10}-\d{2}-\d{6}$/.test(accession)||!primary||primary.length>220||!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.(?:htm|html|txt|pdf)$/i.test(primary)||primary.includes("..")||!reportDate||!filingDate)continue;
    const period=intent.calendar?{year:Number(reportDate.slice(0,4)),quarter:Math.ceil(Number(reportDate.slice(5,7))/3)}:fiscalPeriod(reportDate,text(payload.fiscalYearEnd));
    if(intent.periodEnd&&reportDate!==intent.periodEnd)continue;
    if(!intent.periodEnd&&intent.year&&(period?.year||Number(reportDate.slice(0,4)))!==intent.year)continue;
    if(intent.quarter&&period?.quarter!==intent.quarter)continue;
    const type=form==="10-Q"?"Quarterly report":"Annual report",url=`https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g,"")}/${primary}`;
    const title=`${name}${tickers?` (${tickers})`:""} — ${type}, ${form}, period ended ${reportDate}`;
    const description=`${name}${tickers?` (${tickers})`:""} filed this ${type.toLowerCase()} on Form ${form} with the U.S. Securities and Exchange Commission. Reporting period ended ${reportDate}; filed ${filingDate}. Accession ${accession}. This is filing metadata; the document's financial results have not been read or analyzed.`;
    documents.push({id:`sec-${cik}-${accession}`,title,name:title,url,fullTextUrl:url,description,provider:PROVIDER,
      providerRecordUrl:`https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g,"")}/${accession}-index.html`,publishedAt:filingDate,
      access:"Free",accessBasis:"SEC EDGAR makes public filings available without payment or authentication. The SEC submissions API supplied this company's CIK, form, accession number, reporting date and primary document filename. The linked document has not been independently fetched or read.",
      type,domain:"Finance",query,foundAt});
  }
  return documents.sort((a,b)=>(b.title.match(/\d{4}-\d{2}-\d{2}$/)?.[0]||"").localeCompare(a.title.match(/\d{4}-\d{2}-\d{2}$/)?.[0]||"")||(b.publishedAt||"").localeCompare(a.publishedAt||""));
}

/** At most two explicit companies, one directory and one historical page per company. */
export async function discoverFilings(query:string,options:DiscoveryOptions={},foundAt=new Date().toISOString()):Promise<FilingDiscoveryResult> {
  const empty=(message:string):FilingDiscoveryResult=>({documents:[],status:{provider:PROVIDER,status:"empty",count:0,message}});
  if(!isFilingQuery(query))return empty("This question does not request a company filing.");
  const fetcher=options.fetcher||defaultFetcher,deadline=Date.now()+Math.max(50,Math.min(options.timeoutMs||8000,8000)),intent=intentFor(query);
  try{
    const explicitCik=query.match(/\bcik\s*[:#]?\s*(\d{1,10})\b/i)?.[1]?.replace(/^0+/,"");
    let companies=explicitCik?[{cik:explicitCik,name:"",tickers:[]}]:common.filter(company=>matchesCompany(query,company));
    if(!companies.length)companies=lookupCompanies(await secJson("https://www.sec.gov/files/company_tickers.json",fetcher,deadline,86400000),query);
    if(!companies.length)return empty("Name a specific SEC-reporting company or stock ticker, such as Apple (AAPL), and optionally a year or quarter. No company matched this request.");
    const documents:DiscoveredDocument[]=[],issues:string[]=[];let lastError:SecFailure|undefined;
    for(const company of companies.slice(0,MAX_COMPANIES)){
      try{
        const padded=company.cik.padStart(10,"0"),payload=row(await secJson(`https://data.sec.gov/submissions/CIK${padded}.json`,fetcher,deadline,60000)),filings=row(payload.filings);
        let found=filingDocuments(payload,row(filings.recent),company,intent,query,foundAt);
        if(!found.length&&intent.year&&Array.isArray(filings.files)){
          const requestedYear=intent.year;
          const older=filings.files.map(row).find(file=>typeof file.name==="string"&&new RegExp(`^CIK${padded}-submissions-\\d{3}\\.json$`).test(file.name)&&String(file.filingFrom)<=`${requestedYear+1}-06-30`&&String(file.filingTo)>=`${requestedYear}-01-01`);
          if(older)found=filingDocuments(payload,row(await secJson(`https://data.sec.gov/submissions/${older.name}`,fetcher,deadline,60000)),company,intent,query,foundAt);
        }
        documents.push(...found.slice(0,intent.latest?1:companies.length>1?3:MAX_DOCUMENTS));
      }catch(error){lastError=error instanceof SecFailure?error:new SecFailure("error","SEC could not be reached. Try again later.");issues.push(`${company.name||company.cik}: ${lastError.message}`);}
    }
    const unique=[...new Map(documents.map(document=>[document.url,document])).values()].slice(0,MAX_DOCUMENTS);
    if(!unique.length&&lastError)return {documents:[],status:{provider:PROVIDER,status:lastError.status,count:0,message:issues.join(" "),...(lastError.httpStatus?{httpStatus:lastError.httpStatus}:{})}};
    if(!unique.length)return empty(`No matching ${intent.forms.join(" / ")} filing was returned for this company and period. ${intent.quarter===4?"U.S. companies generally report their fourth quarter in an annual 10-K rather than a 10-Q. ":""}Searches cover recent filings and at most one historical filing page per company; try a different period or explicit ticker.`);
    return {documents:unique,status:{provider:PROVIDER,status:"ok",count:unique.length,...(issues.length||companies.length>MAX_COMPANIES?{message:[...issues,...(companies.length>MAX_COMPANIES?["Only the first two matching companies were searched; narrow the question for other companies."]:[])].join(" ")}:{})}};
  }catch(error){
    const failure=error instanceof SecFailure?error:new SecFailure("error","SEC could not be reached. Try again later.");
    return {documents:[],status:{provider:PROVIDER,status:failure.status,count:0,message:failure.message,...(failure.httpStatus?{httpStatus:failure.httpStatus}:{})}};
  }
}
