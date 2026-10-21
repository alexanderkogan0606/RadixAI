import { api } from "../_shared";
import { ApiError } from "@/lib/crawler";
import catalog from "@/lib/catalog.json";
import { readChat,runResearchRequest,ResearchRequestError,type ResearchSource } from "@/lib/research";
export const dynamic="force-dynamic";
export async function GET(request:Request) {
  return api(request,false,(db,user)=>readChat(db,user));
}
export async function POST(request:Request) {
  return api(request,true,async(db,user,body)=>{
    try{return await runResearchRequest(db,user,body,catalog as ResearchSource[]);}
    catch(error){if(error instanceof ResearchRequestError)throw new ApiError(error.message,error.status);throw error;}
  });
}
