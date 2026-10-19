import { env } from "cloudflare:workers";
import { ApiError } from "@/lib/crawler";

export async function api(request:Request,write:boolean,handler:(db:D1Database,user:string,body:Record<string,unknown>)=>Promise<unknown>) {
  try {
    const url = new URL(request.url);
    const local = ["localhost","127.0.0.1","[::1]"].includes(url.hostname);
    const user = request.headers.get("oai-authenticated-user-id") || (local ? "local" : null);
    if (!user) throw new ApiError("Sign in with ChatGPT to use your research database.",401);
    if (write) {
      const origin = request.headers.get("origin");
      if ((origin && origin !== url.origin) || (!origin && !local) || request.headers.get("sec-fetch-site") === "cross-site") {
        throw new ApiError("This action must come from your Research Atlas page.",403);
      }
      if (!request.headers.get("content-type")?.includes("application/json")) throw new ApiError("Send this request as JSON.",415);
      if (Number(request.headers.get("content-length") || 0)>20_000) throw new ApiError("Request is too large.",413);
    }
    if (!env.DB) throw new ApiError("The research database is not available yet. Please retry shortly.",503);
    let body:Record<string,unknown> = {};
    if (write) {
      const raw = await request.text();
      if (raw.length > 20_000) throw new ApiError("Request is too large.",413);
      try { body = JSON.parse(raw); } catch { throw new ApiError("The request contains invalid JSON."); }
      if (!body || Array.isArray(body) || typeof body !== "object") throw new ApiError("The request must contain an object.");
    }
    const result=await handler(env.DB,user,body);
    if(result instanceof Response){
      const headers=new Headers(result.headers);
      headers.set("Cache-Control","private, no-store");
      headers.set("Vary","oai-authenticated-user-id");
      return new Response(result.body,{status:result.status,statusText:result.statusText,headers});
    }
    return Response.json(result,{headers:{"Cache-Control":"private, no-store","Vary":"oai-authenticated-user-id"}});
  } catch (error) {
    const known = error instanceof ApiError;
    if (!known) console.error("Research Atlas API failed",error);
    return Response.json({error:known?error.message:"The request could not be completed. Please retry shortly."},{status:known?error.status:500,headers:{"Cache-Control":"no-store"}});
  }
}
