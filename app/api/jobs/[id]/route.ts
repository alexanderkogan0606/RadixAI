import { api } from "../../_shared";
import { readRun } from "@/lib/crawler";
export const dynamic="force-dynamic";
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
  return api(request,false,async(db,user)=>readRun(db,user,(await context.params).id));
}
