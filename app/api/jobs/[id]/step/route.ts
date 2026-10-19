import { api } from "../../../_shared";
import { stepJob } from "@/lib/crawler";
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
  return api(request,true,async(db,user)=>stepJob(db,user,(await context.params).id));
}
