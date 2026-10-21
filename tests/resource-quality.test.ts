import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's native TypeScript runner needs the explicit extension.
import {assessResource,queryTerms,cleanSearchQuery,linkPriority} from "../lib/resource-quality.ts";
const article={url:"https://research.org/articles/merger",title:"Bank acquisitions and post-merger performance",description:"This study compares bank profitability and operating costs following corporate acquisitions."};

test("session notices, login and CAPTCHA captures never become research evidence",()=>{
  for(const [title,description] of [["EMMA","Your session is about to expire due to inactivity."],["Verify you are human","Complete the CAPTCHA to continue."],["Sign in","Sign in to access this article."],["Bank acquisitions","Your session has expired. Please log in again."]]){
    const result=assessResource({...article,title,description},"bank acquisitions");
    assert.equal(result.eligible,false);assert.equal(result.reason,"access-gate");
  }
});
test("error pages, navigation, feeds and generic homepages are not documents",()=>{
  assert.equal(assessResource({...article,title:"404 Page not found"}).reason,"error");
  for(const url of ["https://research.org/","https://research.org/research","https://research.org/blog/feed.xml","https://research.org/search?q=merger","https://research.org/privacy-policy"]){
    assert.equal(assessResource({...article,url},"bank acquisitions").reason,"navigation",url);
  }
});
test("strong topic matches use title and summary, not URL keywords or inherited fields",()=>{
  assert.equal(assessResource(article,"M&A in banking").eligible,true);
  assert.deepEqual(assessResource(article,"M&A in banking").matchedTerms,["merger","bank"]);
  assert.equal(assessResource({...article,title:"GPU training throughput",description:"We evaluate parallel training configurations and memory usage across several graphics processors."},"M&A in banking").reason,"off-topic");
  assert.equal(assessResource({...article,title:"AI in manufacturing",description:"This article describes artificial intelligence for automated industrial quality control."},"AI banking").reason,"off-topic");
  assert.equal(assessResource({...article,url:"https://research.org/ai-banking",title:"Retail discounts",description:"A detailed comparison of seasonal promotions across clothing retail stores."},"AI banking").eligible,false);
});
test("M&A aliases match corporate transactions without conflating customer acquisition",()=>{
  assert.deepEqual(queryTerms("M&A mergers acquisitions"),["merger"]);
  assert.equal(assessResource(article,"acquisition").eligible,true);
  const marketing={url:"https://research.org/marketing/article",title:"Customer acquisition costs",description:"A study of customer acquisition channels and paid marketing campaign performance."};
  assert.equal(assessResource(marketing,"M&A").reason,"off-topic");
  assert.match(cleanSearchQuery("Please find research on M&A banking?"),/mergers and acquisitions banking/);
});
test("short meaningful summaries are accepted but boilerplate and empty shells are rejected",()=>{
  assert.equal(assessResource({...article,description:"Bank mergers change lending and competition."},"bank mergers").eligible,true);
  for(const description of ["","Welcome to our website.","Loading...","We use cookies to improve your experience.","Metadata captured from this page."]){
    assert.equal(assessResource({url:article.url,title:"Bank merger report",description},"bank mergers").reason,"insufficient-content");
  }
});
test("operational validation objectives bypass topical rejection but never quality rejection",()=>{
  assert.deepEqual(queryTerms("Live animation validation"),[]);
  assert.equal(assessResource(article,"Live animation validation").eligible,true);
  assert.equal(assessResource({...article,description:"Your session is about to expire due to inactivity."},"Live animation validation").eligible,false);
  assert.ok(queryTerms("AI model validation in banking").includes("validation"));
});
test("request modifiers and methodological abstracts do not reject relevant provider documents",()=>{
  assert.deepEqual(queryTerms("Please find only free new documents on M&A"),["merger"]);
  const method={...article,description:"By using a structural model, we estimate how bank acquisitions change lending competition."};
  assert.equal(assessResource(method,"Please find only free new documents on M&A").eligible,true);
  assert.equal(assessResource({...article,description:"By using this website you agree to our privacy policy and terms."},"bank mergers").reason,"insufficient-content");
});
test("natural-language AI banking prompts retain only their research concepts",()=>{
  const resource={url:"https://research.org/paper/ai-banking",title:"Artificial intelligence in banking",description:"This paper evaluates machine learning adoption and operational outcomes at commercial banks."};
  for(const query of ["How is AI being used in banking?","AI banking deep dive","Deep-dive on AI banking","AI banking deepdive"]){
    assert.deepEqual(queryTerms(query),["ai","bank"]);
    assert.equal(assessResource(resource,query).eligible,true);
  }
  assert.ok(queryTerms("deep learning for banking").includes("deep"),"only the deep-dive framing is removed, not deep learning");
});
test("link discovery prioritizes related anchors and paths and rejects account/legal links",()=>{
  const query="bank mergers";
  assert.ok(linkPriority({url:"https://research.org/article?id=4",title:"Bank merger evidence"},query)>linkPriority({url:"https://research.org/article?id=5",title:"Office updates"},query));
  assert.ok(linkPriority({url:"https://research.org/bank-acquisition"},query)>0);
  for(const url of ["https://research.org/login","https://research.org/account/profile","https://research.org/privacy","https://research.org/article?sessionid=secret"]){assert.equal(linkPriority({url},query),-1)}
  assert.ok(linkPriority({url:"https://research.org/research"},query)>=0,"useful collections remain traversable");
});


test("conversational framing does not reduce topic relevance or narrow provider queries",()=>{
  const query="I want research and case studies regarding mergers and acquisitions";
  assert.deepEqual(queryTerms(query),["merger"]);
  assert.equal(cleanSearchQuery(query),"mergers and acquisitions");
  assert.equal(assessResource(article,query).eligible,true);
  assert.deepEqual(queryTerms("I need specific resources concerning AI banking"),["ai","bank"]);
  assert.equal(cleanSearchQuery("I'm looking for research on SaaS pricing"),"SaaS pricing");
  assert.equal(cleanSearchQuery("I want bank mergers"),"bank mergers");
  assert.ok(queryTerms("consumer needs and demand forecasting").includes("demand"));
});

test("SaaS and its expanded name describe the same research subject",()=>{
  assert.deepEqual(queryTerms("software-as-a-service pricing"),["saas","price"]);
  assert.equal(assessResource({url:"https://research.org/paper/42",title:"Software as a service pricing strategies",description:"This study compares subscription pricing and customer retention in software service businesses."},"SaaS pricing").eligible,true);
});
