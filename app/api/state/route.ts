import { api } from "../_shared";
import { readState } from "@/lib/crawler";
export const dynamic = "force-dynamic";
export async function GET(request:Request) {
  return api(request,false,(db,user)=>readState(db,user));
}
