import { api } from "../_shared";
import { setBookmark } from "@/lib/crawler";
export async function POST(request:Request) {
  return api(request,true,(db,user,body)=>setBookmark(db,user,body));
}
