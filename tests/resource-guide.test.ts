import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's native TypeScript runner needs an explicit extension.
import {resourceGuide} from "../lib/resource-guide.ts";

test("filings guidance explains how to use disclosures without inventing findings",()=>{
  const result=resourceGuide({name:"SEC EDGAR",url:"https://www.sec.gov/search-filings",type:"Filings",description:"Public company disclosures and annual reports.",access:"Free"},{origin:"catalog",query:"company margins and annual reports"});
  assert.equal(result.kind,"filings");
  assert.match(result.howToUse,/reporting period/);
  assert.match(result.howToUse,/accounting definitions/);
  assert.deepEqual(result.matchedTerms,["company","annual","reports"]);
  assert.match(result.relevance,/Title or description matches/);
  assert.match(result.relevance,/Check the original/);
  assert.match(result.evidenceLabel,/Catalog metadata/);
  assert.match(result.evidenceLabel,/Reported access: Free/);
  assert.doesNotMatch(result.purpose,/\d+%|proves|demonstrates/i);
});

test("dataset and case-study resources give materially different research instructions",()=>{
  const dataset=resourceGuide({name:"Development indicators",type:"Dataset",description:"Country-level poverty indicators."},{origin:"catalog",query:"poverty trends"});
  const caseStudy=resourceGuide({title:"A bank AI deployment case study",url:"https://example.org/cases/bank-ai",description:"A retrospective on model deployment."},{origin:"page",query:"AI bank deployment"});
  assert.equal(dataset.kind,"dataset");
  assert.match(dataset.howToUse,/units, geography, dates, methodology/);
  assert.equal(caseStudy.kind,"case-study");
  assert.match(caseStudy.howToUse,/organization, problem, actions, timeline/);
  assert.match(caseStudy.howToUse,/cross-check outcomes/);
  assert.match(caseStudy.evidenceLabel,/full text not assessed/);
  assert.deepEqual(caseStudy.matchedTerms,["ai","bank","deployment"]);
});

test("crawled homepages remain low-direct-relevance even when source tags match",()=>{
  const result=resourceGuide({title:"Research Institute",url:"https://example.org/",category:"AI & machine learning",tags:["AI","banking"],description:"Explore our latest research."},{origin:"page",query:"AI banking"});
  assert.equal(result.kind,"homepage");
  assert.match(result.relevance,/Low direct relevance/);
  assert.match(result.relevance,/does not establish an answer/);
  assert.match(result.howToUse,/specific article, dataset, case or filing/);
});

test("navigation detection overrides inherited research classifications",()=>{
  for(const url of ["https://example.org/privacy-policy","https://example.org/en/login","https://example.org/about/team","https://example.org/?q=banking"]){
    const result=resourceGuide({url,title:"Institute",type:"Research library",category:"Banking",description:"General website information."},{origin:"page",query:"banking"});
    assert.equal(result.kind,"navigation",url);
    assert.match(result.relevance,/Low direct relevance/);
  }
  const article=resourceGuide({url:"https://example.org/articles/about-ai-pricing",title:"Analysis of AI pricing",description:"Pricing models for AI products."},{origin:"page",query:"AI pricing"});
  assert.equal(article.kind,"analysis","an article slug containing 'about' is not a navigation page");
});

test("a catalog homepage retains its documented resource purpose",()=>{
  const result=resourceGuide({url:"https://data.worldbank.org/",name:"World Bank Open Data",type:"Dataset",description:"International development indicators and country comparisons."},{origin:"catalog",query:"development indicators"});
  assert.equal(result.kind,"dataset");
  assert.equal(result.purpose,"International development indicators and country comparisons.");
  assert.match(result.evidenceLabel,/original content not assessed/);
});

test("inherited tags alone are distinguished from page-specific query matches",()=>{
  const result=resourceGuide({title:"Quarterly meeting announcement",url:"https://example.org/news/meeting",description:"The team will hold a public meeting.",category:"Banking",tags:["AI"]},{origin:"page",query:"AI banking"});
  assert.deepEqual(result.matchedTerms,["ai","banking"]);
  assert.match(result.relevance,/Only category or tags match/);
  assert.match(result.relevance,/rather than this page/);
  assert.match(result.relevance,/Direct relevance is unconfirmed/);
});

test("query matching uses whole terms and never treats the domain or URL as evidence",()=>{
  const result=resourceGuide({title:"Retail updates",url:"https://ai.example.org/bank",domain:"Finance",description:"Announcements for retail shops."},{origin:"page",query:"AI bank finance"});
  assert.deepEqual(result.matchedTerms,[]);
  assert.match(result.relevance,/No matching terms/);
  assert.match(result.relevance,/Open the original to check/);
  assert.doesNotMatch(result.relevance,/mentions “ai”/);
});

test("missing or placeholder summaries are clearly unavailable without throwing",()=>{
  for(const description of [undefined,"  ","Metadata captured from this page.","URL discovered by the crawler; page content has not been indexed."]){
    const result=resourceGuide({title:"Unclassified item",url:"not a URL",description},{origin:"page",query:"cloud economics"});
    assert.equal(result.kind,"resource");
    assert.match(result.purpose,/Summary unavailable/);
    assert.match(result.evidenceLabel,/summary unavailable/);
    assert.deepEqual(result.matchedTerms,[]);
  }
});

test("analysis, guides and papers identify distinct checks",()=>{
  const analysis=resourceGuide({title:"Cloud industry analysis",type:"Publication",description:"Commentary on the industry."},{origin:"catalog"});
  const guide=resourceGuide({title:"How-to guide for cloud capacity",url:"https://example.org/guides/capacity",description:"A practical tutorial."},{origin:"page"});
  const paper=resourceGuide({title:"A paper on distributed systems",url:"https://example.org/papers/systems",description:"Academic research on distributed execution."},{origin:"page"});
  assert.equal(analysis.kind,"analysis");
  assert.match(analysis.howToUse,/distinguish interpretation/);
  assert.equal(guide.kind,"guide");
  assert.match(guide.howToUse,/prerequisites/);
  assert.equal(paper.kind,"research");
  assert.match(paper.howToUse,/methods, sample and limitations/);
  assert.match(paper.relevance,/No specific research question/);
});

test("explanations are deterministic, bounded, and do not change input metadata",()=>{
  const input={title:"SaaS pricing report",url:"https://example.org/report",description:"Pricing evidence. ".repeat(200),tags:["saas"],access:"Paid"};
  const before=structuredClone(input),options={origin:"page" as const,query:"How does SaaS pricing work?"};
  const a=resourceGuide(input,options),b=resourceGuide(input,options);
  assert.deepEqual(a,b);
  assert.deepEqual(input,before);
  assert.ok(a.purpose.length<=220);
  assert.deepEqual(a.matchedTerms,["saas","pricing"]);
  assert.match(a.evidenceLabel,/Reported access: Paid/);
  assert.doesNotMatch(a.purpose,/free to access/i);
});

test("purpose foregrounds the supplied summary and guidance does not repeat the query",()=>{
  const description="Fine-tuning language models with a small GPU budget.";
  const result=resourceGuide({title:"Fine-tuning on consumer GPUs",url:"https://huggingface.co/blog/gpu-training",description},{origin:"page",query:"How can I fine-tune a language model cheaply?"});
  assert.equal(result.purpose,description);
  assert.doesNotMatch(result.purpose,/Captured description|Catalog description|metadata suggests|not been assessed/);
  assert.ok(result.howToUse.length<200);
  assert.doesNotMatch(result.howToUse,/For “|How can I/);
  assert.match(result.evidenceLabel,/Captured page metadata · full text not assessed/);
});

test("explicit technical titles receive practical guidance even without a description",()=>{
  for(const title of ["Training a language model","Fine-tuning on a single GPU","Fine‑tuning small models","Transformer implementation notes","Model deployment with GPUs"]){
    const result=resourceGuide({title,url:"https://huggingface.co/blog/technical-article"},{origin:"page",query:"language model costs"});
    assert.equal(result.kind,"guide",title);
    assert.match(result.howToUse,/configuration, compute requirements and evaluation/);
    assert.match(result.purpose,/Summary unavailable/);
    assert.doesNotMatch(result.purpose,/improves|reduces|\d+%/);
  }
  const paper=resourceGuide({title:"A paper on efficient model training",url:"https://example.org/papers/model"},{origin:"page"});
  assert.equal(paper.kind,"research","explicit papers retain research guidance");
});

test("feeds are collection routes, while articles about feeds remain substantive pages",()=>{
  for(const url of ["https://huggingface.co/blog/feed.xml","https://example.org/feed/","https://example.org/rss.xml","https://example.org/atom.xml","https://example.org/feeds/posts/default","https://example.org/?feed=rss2","https://example.org/news.rss"]){
    const result=resourceGuide({url,title:"AI deployment research",description:"The latest AI research articles.",type:"Research library"},{origin:"page",query:"AI deployment"});
    assert.equal(result.kind,"navigation",url);
    assert.match(result.relevance,/Low direct relevance: a feed lists items/);
    assert.match(result.howToUse,/entry's original URL/);
    assert.doesNotMatch(result.howToUse,/compute requirements/);
  }
  const article=resourceGuide({url:"https://example.org/blog/rss-feeds-for-research",title:"A guide to RSS feeds",description:"How to follow research publications."},{origin:"page"});
  assert.equal(article.kind,"guide");
});
