import { api } from "../_shared";
import { exportDataChunks,type CatalogSource } from "@/lib/crawler";
import catalog from "@/lib/catalog.json";
export const dynamic="force-dynamic";
export async function GET(request:Request){
  return api(request,false,async(db,user)=>{
    const kind=new URL(request.url).searchParams.get("kind") === "pages" ? "pages" : "workspace";
    const chunks=exportDataChunks(db,user,kind,catalog as CatalogSource[]);
    const encoder=new TextEncoder();
    const stream=new ReadableStream<Uint8Array>({
      async pull(controller){
        try{
          const chunk=await chunks.next();
          if(chunk.done)controller.close();
          else controller.enqueue(encoder.encode(chunk.value));
        }catch(error){controller.error(error);}
      },
      async cancel(){await chunks.return(undefined);},
    });
    return new Response(stream,{headers:{
      "Content-Type":"application/json; charset=utf-8",
      "Content-Disposition":`attachment; filename="radixai-${kind}-${new Date().toISOString().slice(0,10)}.json"`,
      "X-Content-Type-Options":"nosniff",
    }});
  });
}
