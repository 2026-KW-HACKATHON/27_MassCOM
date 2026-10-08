// Production 렌더러와 합성 점주 게시 자료를 비교하는 loopback 전용 QA 도구.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const port=Number(process.env.COLLECTIBLE_RELIEF_QA_PORT)||4192;
const upstream=new URL(process.env.COLLECTIBLE_RELIEF_QA_UPSTREAM||'http://127.0.0.1:4191');
if(upstream.hostname!=='127.0.0.1'||upstream.protocol!=='http:')throw new Error('Only loopback fixture upstream is allowed');
createServer(async(request,response)=>{
  try{
    const path=new URL(request.url,'http://127.0.0.1').pathname;
    if(path==='/'){
      response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
      response.end(await readFile(new URL('./collectible-relief-qa.html',import.meta.url)));return;
    }
    if(request.method!=='GET'||!(path.startsWith('/api/web/merchant/')||path.startsWith('/app/assets/'))){response.writeHead(404).end();return;}
    const result=await fetch(new URL(path,upstream));
    response.writeHead(result.status,{'content-type':result.headers.get('content-type')||'application/octet-stream','cache-control':'no-store'});
    response.end(Buffer.from(await result.arrayBuffer()));
  }catch{response.writeHead(502).end('Local QA upstream unavailable');}
}).listen(port,'127.0.0.1',()=>console.log(`Relief QA: http://127.0.0.1:${port}/`));
