import { api } from "../_shared";
import { addSource } from "@/lib/crawler";
export async function POST(request:Request) {
  return api(request,true,(db,user,body)=>addSource(db,user,body));
}
