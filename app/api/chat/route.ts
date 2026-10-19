import { api } from "../_shared";
import { ApiError } from "@/lib/crawler";
import catalog from "@/lib/catalog.json";
import { cleanHistory,readChat,retrieveForUser,saveChat,type ResearchSource } from "@/lib/research";
export const dynamic="force-dynamic";
export async function GET(request:Request) {
  return api(request,false,(db,user)=>readChat(db,user));
}
export async function POST(request:Request) {
  return api(request,true,async(db,user,body)=>{
    if(typeof body.message!=="string"||!body.message.trim())throw new ApiError("Enter a research question.");
    if(body.message.length>2000)throw new ApiError("Keep your research question under 2,000 characters.");
    const message=body.message.trim();
    let history=cleanHistory(body.history);
    if(!history.length)history=cleanHistory((await readChat(db,user)).messages);
    const result=await retrieveForUser(db,user,message,history,catalog as ResearchSource[]);
    await saveChat(db,user,message,result);
    return result;
  });
}
