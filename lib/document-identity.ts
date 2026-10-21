// @ts-expect-error Native TypeScript tests require the explicit extension.
import { canonicalEvidenceUrl } from "./discovery-store.ts";

function doi(value:string|undefined):string|undefined {
  const normalized=value?.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,"").replace(/^doi:\s*/i,"").toLowerCase();
  return normalized&&/^10\.\d{4,9}\/\S+$/.test(normalized)?normalized:undefined;
}
function doiDestination(address:string):string|undefined {
  try{const url=new URL(address);return /^(?:dx\.)?doi\.org$/.test(url.hostname)&&!url.search?doi(decodeURIComponent(url.pathname.slice(1))):undefined;}catch{return;}
}
/** Identity aliases only: these do not grant access or change the stored original URL. */
export function canonicalDocumentIdentityUrl(address:string):string {
  try{
    const normalized=canonicalEvidenceUrl(address),url=new URL(normalized);
    const zenodo=url.hostname==="zenodo.org"&&!url.search?url.pathname.match(/^\/records?\/(\d+)\/?$/):null;
    return zenodo?`https://zenodo.org/records/${zenodo[1]}`:normalized;
  }catch{return address;}
}
/** Prefer a selected DOI destination over a provider's work-level PID for another version. */
export function documentIdentityKeys(document:{url:string;fullTextUrl?:string;doi?:string}):string[] {
  const identifier=doiDestination(document.url)||doi(document.doi);
  return [...new Set([`url:${canonicalDocumentIdentityUrl(document.url)}`,...(document.fullTextUrl?[`url:${canonicalDocumentIdentityUrl(document.fullTextUrl)}`]:[]),...(identifier?[`doi:${identifier}`]:[])])];
}
