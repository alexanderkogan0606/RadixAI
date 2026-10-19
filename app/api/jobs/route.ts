import { api } from "../_shared";
import { createJob, type CatalogSource } from "@/lib/crawler";
import catalog from "@/lib/catalog.json";
export async function POST(request:Request) {
  return api(request,true,(db,user,body)=>createJob(db,user,body,catalog as CatalogSource[]));
}
