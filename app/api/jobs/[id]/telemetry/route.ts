import { api } from "../../../_shared";
import { ApiError } from "@/lib/crawler";
import { readTelemetry } from "@/lib/telemetry";
export const dynamic="force-dynamic";

export async function GET(request:Request,context:{params:Promise<{id:string}>}) {
  return api(request,false,async(db,user)=>{
    const {id}=await context.params;
    const result=await readTelemetry(db,user,id);
    if(!result)throw new ApiError("Crawl not found.",404);
    return result;
  });
}
