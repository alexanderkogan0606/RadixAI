import { api } from "../_shared";
import { readState } from "@/lib/crawler";
import { readKnownFreeDocumentSources,readSavedDocuments } from "@/lib/discovery-store";
export const dynamic = "force-dynamic";
export async function GET(request:Request) {
  return api(request,false,async(db,user)=>{
    const [state,documents,savedDocuments]=await Promise.all([readState(db,user),readKnownFreeDocumentSources(db,user),readSavedDocuments(db,user)]);
    return {...state,documents:documents.filter(document=>!document.aliasOf),documentAliases:documents.filter(document=>document.aliasOf),savedDocuments};
  });
}
