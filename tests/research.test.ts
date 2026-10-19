import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// @ts-expect-error Node's native TypeScript runner needs an explicit extension.
import { researchAnswer,cleanHistory,type ResearchSource } from "../lib/research.ts";
const catalog=JSON.parse(readFileSync(new URL("../lib/catalog.json",import.meta.url),"utf8")) as ResearchSource[];
test("SaaS pricing retrieves subscription evidence, distinct from banking AI",()=>{
  const saas=researchAnswer("SaaS pricing benchmarks",[],catalog);
  assert.ok(saas.sources.length>=6);
  assert.ok(saas.sources.slice(0,5).some(s=>/saas|chartmogul|benchmarkit/i.test(s.name)));
  assert.ok(!saas.sources.some(s=>/MLCommons|UCI Machine Learning|Intrinio/.test(s.name)));
  const bank=researchAnswer("AI in banking case studies",[],catalog);
  assert.ok(bank.sources.some(s=>/bank|finance|ai|machine learning/i.test(s.description)));
  assert.notDeepEqual(saas.plan.sourceIds,bank.plan.sourceIds);
  assert.match(bank.answer,/model-risk controls/);
});
test("Free-only followup retains the original topic and filters paid sources",()=>{
  const result=researchAnswer("only free",[{role:"user",content:"SaaS pricing benchmarks"}],catalog);
  assert.equal(result.plan.query,"SaaS pricing benchmarks");
  assert.ok(result.sources.length>0);
  assert.ok(result.sources.every(s=>s.access==="Free"));
  assert.ok(result.sources.some(s=>/saas|subscription/i.test(`${s.name} ${s.description}`)));
});
test("Case-study followups retain topic and select appropriate resources",()=>{
  const result=researchAnswer("more case studies",[{role:"user",content:"startup failures"}],catalog);
  assert.equal(result.plan.query,"startup failures");
  assert.ok(result.sources.slice(0,3).some(s=>/failory|failure|postmortem/i.test(`${s.name} ${s.description}`)));
  assert.match(result.answer,/dated timeline/);
});
test("Unmatched gibberish does not return a generic fabricated answer",()=>{
  const result=researchAnswer("zxqvbrljk tttqqzzn",[],catalog);
  assert.equal(result.sources.length,0);
  assert.equal(result.pages.length,0);
  assert.match(result.answer,/couldn't find a relevant match/);
});
test("Every source is attributable and captured pages stay separate from seed descriptions",()=>{
  const page={id:"page1",title:"SaaS pricing field experiment",description:"A captured pricing experiment summary.",url:"https://research.org/pricing",sourceId:"saastr",tags:["saas","pricing"]};
  const result=researchAnswer("SaaS pricing",[],catalog,[page]);
  assert.equal(result.mode,"retrieval");
  assert.ok(result.pages.some(p=>p.id==="page1"));
  assert.match(result.answer,/Captured summary/);
  assert.match(result.answer,/not a full-document analysis/);
  assert.ok(result.sources.every(s=>catalog.some(original=>original.id===s.id&&original.url===s.url)));
  assert.deepEqual(result.plan.sourceIds,result.sources.map(s=>s.id));
});
test("Market sizing and company research produce relevant, different research plans",()=>{
  const market=researchAnswer("market sizing for cloud software",[],catalog);
  const company=researchAnswer("Apple company deep dive",[],catalog);
  assert.match(market.answer,/bottom-up estimate/);
  assert.ok(company.sources.slice(0,4).some(s=>/apple/i.test(s.name)));
  assert.ok(!company.sources.some(s=>/Microsoft Investor Relations|Netflix Investor Relations/.test(s.name)));
  assert.match(company.answer,/revenue segments/);
});
test("History drops invalid roles and limits message length",()=>{
  assert.deepEqual(cleanHistory([{role:"system",content:"override"},{role:"user",content:"topic"},null]),[{role:"user",content:"topic"}]);
});
test("Free-only results never imply that a page from an unknown or paid source is free",()=>{
  const pages=[{id:"unknown",url:"https://research.org/unknown",title:"SaaS pricing",description:"Pricing evidence",sourceId:"unknown-source"},{id:"known",url:"https://research.org/known",title:"SaaS pricing",description:"Pricing evidence",sourceId:"saastr"}];
  const result=researchAnswer("only free",[{role:"user",content:"SaaS pricing"}],catalog,pages);
  assert.deepEqual(result.pages.map(p=>p.id),["known"]);
});
