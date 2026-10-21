import { api } from "../_shared";
import { createJob, type CatalogSource } from "@/lib/crawler";
import catalog from "@/lib/catalog.json";
import { readKnownFreeDocumentSources } from "@/lib/discovery-store";
export async function POST(request:Request) {
  return api(request,true,async(db,user,body)=>createJob(db,user,body,[...catalog,...await readKnownFreeDocumentSources(db,user)] as CatalogSource[]));
}
