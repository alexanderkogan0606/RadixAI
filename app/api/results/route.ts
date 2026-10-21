import { api } from "../_shared";
import { ApiError } from "@/lib/crawler";
import { readResults,ResultsError } from "@/lib/results";
import { classifyPageAccess } from "@/lib/free-access";
import { assessResource } from "@/lib/resource-quality";
import catalog from "@/lib/catalog.json";
export const dynamic="force-dynamic";
export async function GET(request:Request){
  return api(request,false,async(db,user)=>{
    try{return await readResults(db,user,new URL(request.url).searchParams,page=>classifyPageAccess(page,catalog),assessResource);}
    catch(error){if(error instanceof ResultsError)throw new ApiError(error.message,error.status);throw error;}
  });
}
