import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's native TypeScript runner needs an explicit extension.
import {classifyPageAccess,sourceForUrl,detectPaywall,isFreeSource,isKnownRestrictedUrl} from "../lib/free-access.ts";

test("Access matches exact destinations and specific path boundaries without inheriting the seed's access",()=>{
  const catalog=[{id:"mixed",url:"https://research.org/",access:"Mixed"},{id:"free",url:"https://www.research.org/open/",access:"Free"},{id:"paid",url:"https://research.org/open/premium",access:"Paid"},{id:"feed",url:"https://different.org/library",feedUrl:"https://feeds.research.org/reports.xml",access:"Free"}];
  const cases:[[string,string],...[string,string][]]=[
    ["https://research.org/open/report","Free"],["https://www.research.org/open","Free"],
    ["https://research.org/openly/report","Mixed"],["https://research.org/open/premium/report","Paid"],
    ["https://research.org/open/premium-public","Free"],["https://evilresearch.org/open/report","Unknown"],
    ["https://sub.research.org/open/report","Unknown"],["https://research.org.evil.org/open/report","Unknown"],
    ["https://research.org/open/../paid","Mixed"],["http://research.org/open/report","Unknown"],
    ["https://research.org:444/open/report","Unknown"],["https://user:pass@research.org/open/report","Unknown"],
    ["https://feeds.research.org/reports.xml","Free"],["https://feeds.research.org/reports.xml/other","Unknown"],
    ["https://feeds.research.org/unrelated","Unknown"],["invalid URL","Unknown"],
  ];
  for(const [url,expected] of cases)assert.equal(classifyPageAccess({url,sourceId:"free"},catalog),expected,url);
  assert.equal(sourceForUrl("https://research.org/open/report",catalog)?.id,"free");
  assert.equal(isKnownRestrictedUrl("https://research.org/paid",catalog),true);
  assert.equal(isKnownRestrictedUrl("https://unknown.org/",catalog),false);
  assert.equal(isFreeSource({access:"Free"}),true);
  assert.equal(isFreeSource({access:"Freemium"}),false);
});

test("Query-scoped resources do not grant unrelated access and restricted ties win",()=>{
  const catalog=[{url:"https://research.org/library?collection=public",access:"Free"}];
  assert.equal(classifyPageAccess({url:"https://research.org/library?collection=public&page=2"},catalog),"Free");
  assert.equal(classifyPageAccess({url:"https://research.org/library?collection=private"},catalog),"Unknown");
  for(const sources of [[{url:"https://research.org/",access:"Free"},{url:"https://www.research.org/",access:"Mixed"}],[{url:"https://www.research.org/",access:"Mixed"},{url:"https://research.org/",access:"Free"}]])assert.equal(classifyPageAccess({url:"https://research.org/article"},sources),"Mixed");
});

test("Verified open documents override broad publisher access only at their exact URL and query",()=>{
  const sources=[{url:"https://publisher.org/",access:"Mixed"},{url:"https://publisher.org/article?id=42",access:"Free",exact:true}];
  assert.equal(classifyPageAccess({url:"https://publisher.org/article?id=42"},sources),"Free");
  for(const url of ["https://publisher.org/article?id=43","https://publisher.org/article?id=42&edition=premium","https://publisher.org/article/appendix?id=42","https://publisher.org/unrelated"]){assert.equal(classifyPageAccess({url},sources),"Mixed",url)}
  assert.equal(classifyPageAccess({url:"https://publisher.org/article?id=42#abstract"},sources),"Free");
  const reordered=[{url:"https://publisher.org/article?b=2&a=1",access:"Free",exact:true}];
  assert.equal(classifyPageAccess({url:"https://publisher.org/article?a=1&b=2"},reordered),"Free");
});

test("Explicit structured-data, payment and sign-in gates are detected",()=>{
  for(const body of [
    `<script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":false}</script>`,
    `<script type='application/ld+json'>{"@graph":[{"@type":"Article","hasPart":{"isAccessibleForFree":"False"}}]}</script>`,
    `<h1>Subscribe to continue reading</h1>`,
    `<p>Sign in to read this article</p>`,
    `<p>This content is for subscribers only.</p>`,
    `<p>Subscribe to unlock this report.</p>`,
    `<title>Sign in | Research</title><form><input type="password"></form>`,
  ])assert.ok(detectPaywall(body),body);
  assert.match(detectPaywall("",402,"text/plain")||"",/Payment required/);
  assert.match(detectPaywall("",401,"text/plain")||"",/Sign-in required/);
});

test("Newsletter calls, regular navigation and public subscriptions research are not paywalls",()=>{
  for(const body of [
    `<h1>Public research</h1><p>Subscribe to our newsletter.</p><a href="/login">Sign in</a>`,
    `<h1>Subscription pricing research</h1><p>Subscribers and members pay monthly subscriptions.</p>`,
    `<script type="application/ld+json">{"@type":"Article","isAccessibleForFree":true}</script>`,
    `<script>const example = {isAccessibleForFree:false};</script><p>Public article</p>`,
    `<script type="application/ld+json">invalid isAccessibleForFree:false</script>`,
    `<h1>Sign-in form tutorial</h1><p>Build a login screen</p><input type="password">`,
  ])assert.equal(detectPaywall(body),null,body);
});
