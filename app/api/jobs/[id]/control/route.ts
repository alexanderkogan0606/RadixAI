import { api } from "../../../_shared";
import { controlJob } from "@/lib/crawler";
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
  return api(request,true,async(db,user,body)=>controlJob(db,user,(await context.params).id,body.action));
}
