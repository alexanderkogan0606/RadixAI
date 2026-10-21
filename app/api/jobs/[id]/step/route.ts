import { api } from "../../../_shared";
import { stepJob } from "@/lib/crawler";
import catalog from "@/lib/catalog.json";
import { readKnownFreeDocumentSources } from "@/lib/discovery-store";
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
  return api(request,true,async(db,user)=>stepJob(db,user,(await context.params).id,[...catalog,...await readKnownFreeDocumentSources(db,user)]));
}
