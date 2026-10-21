'use client';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {classifyPageAccess} from '../lib/free-access';
import GraphLayoutWorker from './graph-layout.worker?worker';
import { GraphMotion, hashPhase, stepSpring, type Spring } from './graph-motion';

export const colors:Record<string,string>={Finance:'#d6d6d6',Business:'#b5b5b5',Technology:'#9c9c9c','Case studies':'#c6c6c6'};
export type Source={id:string;sourceId?:string;name:string;url:string;domain:string;category:string;type:string;access:string;description:string;tags:string[];geography:string;crawlMethod:string;feedUrl?:string;verification:string;provenanceUrl?:string;checkedAt?:string};
export type CrawlFrontier={id?:string;url:string;parentUrl?:string|null;sourceId?:string;status?:string;depth?:number;jobId?:string};
type PageRecord=CrawlFrontier&{title?:string;name?:string;description?:string;domain?:string;category?:string;tags?:string[];fetchedAt?:string};
type CrawlEdge={source:string;target:string;jobId?:string};
type Node={key:string;id:string;label:string;url:string;x:number;y:number;depth:number;root:boolean;status:string;resource:Source};
type Line={source:string;target:string;tree:boolean};
type Scene={nodes:Node[];lines:Line[];bounds:{left:number;right:number;top:number;bottom:number}};
type Position={key:string;x:number;y:number};
type Props={sources:Source[];pages:PageRecord[];edges:CrawlEdge[];select:(s:Source)=>void;selected:string;zoom:number;setZoom:(z:number)=>void;layoutKey:number;frontier?:CrawlFrontier[];seedUrls?:string[];active?:boolean;crawlerUrl?:string;layoutPages?:PageRecord[];layoutEdges?:CrawlEdge[];layoutFrontier?:CrawlFrontier[]};
const EMPTY_FRONTIER:CrawlFrontier[]=[];
const EMPTY_SEEDS:string[]=[];
const MONO='10px ui-monospace, SFMono-Regular, Menlo, monospace';
function keyOf(url:string){try{const u=new URL(url);u.hash='';return u.href}catch{return url}}
function shortUrl(url:string){try{const u=new URL(url);return u.hostname.replace(/^www\./,'')+(u.pathname==='/'?'':u.pathname)}catch{return url}}
function random(key:string){let hash=2166136261;for(let i=0;i<key.length;i++)hash=Math.imul(hash^key.charCodeAt(i),16777619);return (hash>>>0)/4294967295}
function positionScene(scene:Scene,positions:Map<string,{x:number;y:number}>):Scene{
  let left=-70,right=70,top=-70,bottom=70;
  const nodes=scene.nodes.map(node=>{const point=positions.get(node.key),next=point?{...node,x:point.x,y:point.y}:node;left=Math.min(left,next.x);right=Math.max(right,next.x);top=Math.min(top,next.y);bottom=Math.max(bottom,next.y);return next});
  return {...scene,nodes,bounds:{left,right,top,bottom}};
}

/** A deterministic branching layout of real discoveries, with irregular lengths and local fans. */
function buildScene(sources:Source[],pages:PageRecord[],edges:CrawlEdge[],frontier:CrawlFrontier[],seedUrls:string[]):Scene {
  const bySource=new Map(sources.map(s=>[s.id,s]));
  const namedUrls=new Map<string,Source>();
  for(const s of sources){namedUrls.set(keyOf(s.url),s);if(s.feedUrl)namedUrls.set(keyOf(s.feedUrl),s)}
  const nodes=new Map<string,Node>(),links=new Map<string,Line>(),suggestedRoots=new Set<string>();
  function add(url:string,record?:PageRecord,indexed=false){
    if(!url)return;
    const key=keyOf(url),existing=nodes.get(key),source=(record?.sourceId?bySource.get(record.sourceId):undefined)||namedUrls.get(key);
    if(existing&&!record)return existing;
    const title=record?.title||record?.name||(namedUrls.has(key)?source?.name:undefined)||shortUrl(url);
    const id=record?.id||existing?.id||`discovered:${key}`;
    const status=indexed?'indexed':record?.status||existing?.status||'discovered';
    const resource:Source={...(record?.jobId?{jobId:record.jobId}:{}),id,sourceId:record?.sourceId||source?.id,name:title,url,domain:record?.domain||source?.domain||'Research',category:record?.category||source?.category||'Crawled links',type:indexed?'Indexed page':'Discovered URL',access:classifyPageAccess({url},sources),description:record?.description||(indexed?'Metadata captured from this page.':'URL discovered by the crawler; page content has not been indexed.'),tags:record?.tags||[],geography:source?.geography||'Global',crawlMethod:source?.crawlMethod||'Manual',verification:indexed?'Crawled':status==='processing'?'Fetching':status==='blocked'?'Blocked':'Discovered'};
    const node:Node={key,id,label:title,url,x:0,y:0,depth:0,root:false,status,resource};
    nodes.set(key,node);if(record?.depth===0&&!record.parentUrl)suggestedRoots.add(key);
    return node;
  }
  function connect(source:string,target:string){
    if(!source||!target)return;
    const a=add(source),b=add(target);if(!a||!b||a.key===b.key)return;
    links.set(`${a.key}\n${b.key}`,{source:a.key,target:b.key,tree:false});
  }
  for(const p of frontier)add(p.url,p);
  for(const p of pages)add(p.url,p,true);
  for(const url of seedUrls){const node=add(url);if(node)suggestedRoots.add(node.key)}
  for(const p of [...frontier,...pages])if(p.parentUrl)connect(p.parentUrl,p.url);
  for(const edge of edges)connect(edge.source,edge.target);
  const children=new Map<string,string[]>(),incoming=new Set<string>();
  for(const link of links.values()){const list=children.get(link.source)||[];list.push(link.target);children.set(link.source,list);incoming.add(link.target)}
  const candidates=[...suggestedRoots,...[...nodes.keys()].filter(k=>!incoming.has(k))];
  const tree=new Map<string,string[]>(),seen=new Set<string>(),order:string[]=[],roots:string[]=[];
  function traverse(root:string){
    if(seen.has(root))return;
    roots.push(root);seen.add(root);nodes.get(root)!.root=true;
    const queue=[root];
    for(let i=0;i<queue.length;i++){
      const current=queue[i];order.push(current);
      for(const child of children.get(current)||[]){
        if(seen.has(child)||suggestedRoots.has(child))continue;
        seen.add(child);nodes.get(child)!.depth=nodes.get(current)!.depth+1;
        const branch=tree.get(current)||[];branch.push(child);tree.set(current,branch);
        const link=links.get(`${current}\n${child}`);if(link)link.tree=true;
        queue.push(child);
      }
    }
  }
  for(const root of candidates)traverse(root);
  for(const root of nodes.keys())traverse(root);
  const weights=new Map<string,number>();
  for(let i=order.length-1;i>=0;i--){const key=order[i],branch=tree.get(key)||[];weights.set(key,branch.length?branch.reduce((n,c)=>n+(weights.get(c)||1),0):1)}
  const total=roots.reduce((n,key)=>n+(weights.get(key)||1),0)||1;
  let start=-Math.PI;
  const placements:{key:string;start:number;end:number;parent?:string}[]=[];
  for(const root of roots){const span=(weights.get(root)||1)/total*Math.PI*2;placements.push({key:root,start,end:start+span});start+=span}
  for(let i=0;i<placements.length;i++){
    const p=placements[i],node=nodes.get(p.key)!,mid=(p.start+p.end)/2;
    if(p.parent){
      const parent=nodes.get(p.parent)!,branchWeight=weights.get(p.key)||1;
      const length=(node.depth===1?90:45)+random(p.key)*95+Math.min(100,Math.sqrt(branchWeight)*12);
      const angle=mid+(random(p.key+'angle')-.5)*Math.min(.34,(p.end-p.start)*.4);
      node.x=parent.x+Math.cos(angle)*length;node.y=parent.y+Math.sin(angle)*length;
    }else if(roots.length>1){
      const radius=110+Math.sqrt(roots.length)*40+random(p.key)*80;node.x=Math.cos(mid)*radius;node.y=Math.sin(mid)*radius;
    }
    let angle=p.start;
    for(const child of tree.get(p.key)||[]){const span=(p.end-p.start)*(weights.get(child)||1)/(weights.get(p.key)||1);placements.push({key:child,start:angle,end:angle+span,parent:p.key});angle+=span}
  }
  const list=[...nodes.values()];let left=-70,right=70,top=-70,bottom=70;
  for(const n of list){left=Math.min(left,n.x);right=Math.max(right,n.x);top=Math.min(top,n.y);bottom=Math.max(bottom,n.y)}
  return {nodes:list,lines:[...links.values()],bounds:{left,right,top,bottom}};
}

function Graph({sources,pages,edges,select,selected,zoom,setZoom,layoutKey,frontier=EMPTY_FRONTIER,seedUrls=EMPTY_SEEDS,active=false,crawlerUrl='',layoutPages,layoutEdges,layoutFrontier}:Props){
  const canvasRef=useRef<HTMLCanvasElement>(null);
  const scene=useMemo(()=>buildScene(sources,pages,edges,frontier,seedUrls),[sources,pages,edges,frontier,seedUrls]);
  // Replay reveals a subset of one complete layout, so every tick keeps the same geometry and camera.
  const completePages=layoutPages??pages,completeEdges=layoutEdges??edges,completeFrontier=layoutFrontier??frontier;
  const layoutScene=useMemo(()=>buildScene(sources,completePages,completeEdges,completeFrontier,seedUrls),[sources,completePages,completeEdges,completeFrontier,seedUrls]);
  const visibleSceneRef=useRef(scene),sceneRef=useRef(scene),layoutSceneRef=useRef(layoutScene);
  const zoomRef=useRef(zoom),selectedRef=useRef(selected),hoverRef=useRef(''),onZoomRef=useRef(setZoom),activeRef=useRef(active);
  const crawlerRef=useRef(crawlerUrl);
  const offset=useRef({x:0,y:0}),size=useRef({width:900,height:500});
  const drag=useRef<{x:number;y:number;startX:number;startY:number;moved:boolean}|null>(null);
  const rendered=useRef<{node:Node;x:number;y:number}[]>([]),schedule=useRef<()=>void>(()=>{});
  const motion=useRef(new GraphMotion()),edgeBirths=useRef(new Map<string,number>());
  const positionsRef=useRef(new Map<string,{x:number;y:number}>()),topologyRef=useRef(''),settledTopologyRef=useRef('');
  const settledPositionsRef=useRef(new Map<string,{x:number;y:number}>());
  const workerRef=useRef<{worker:Worker;timeout:ReturnType<typeof setTimeout>}|null>(null);
  const retarget=useRef<()=>void>(()=>{});
  const [hover,setHover]=useState<{label:string;url:string;status:string}|null>(null);
  retarget.current=()=>{
    const next=positionScene(visibleSceneRef.current,positionsRef.current),now=performance.now();
    sceneRef.current=next;
    motion.current.update(next.nodes,new Map(next.lines.filter(line=>line.tree).map(line=>[line.target,line.source])),now);
    const visibleEdges=new Set<string>();
    for(const line of next.lines){const key=line.source+'\n'+line.target;visibleEdges.add(key);if(!edgeBirths.current.has(key))edgeBirths.current.set(key,now)}
    for(const key of edgeBirths.current.keys())if(!visibleEdges.has(key))edgeBirths.current.delete(key);
    schedule.current();
  };
  useEffect(()=>{visibleSceneRef.current=scene;retarget.current()},[scene]);
  useEffect(()=>{
    const previous=settledPositionsRef.current,positions=new Map(positionsRef.current),parents=new Map(layoutScene.lines.filter(line=>line.tree).map(line=>[line.target,line.source]));
    for(const node of layoutScene.nodes)if(!positions.has(node.key)){
      const parent=positions.get(parents.get(node.key)||'');
      const angle=random(node.key)*Math.PI*2,length=35+random(node.key+'distance')*45;
      positions.set(node.key,parent?{x:parent.x+Math.cos(angle)*length,y:parent.y+Math.sin(angle)*length}:{x:node.x,y:node.y});
    }
    positionsRef.current=positions;layoutSceneRef.current=positionScene(layoutScene,positions);retarget.current();
    const topology=layoutScene.nodes.map(node=>node.key).sort().join('\n')+'\0'+layoutScene.lines.map(line=>line.source+'\t'+line.target).sort().join('\n');
    if(topology===topologyRef.current&&(workerRef.current||settledTopologyRef.current===topology))return;
    topologyRef.current=topology;
    if(workerRef.current){workerRef.current.worker.terminate();clearTimeout(workerRef.current.timeout);workerRef.current=null}
    if(layoutScene.nodes.length<2)return;
    const canvas=canvasRef.current;
    try{
      const worker=new GraphLayoutWorker();
      const stop=()=>{worker.terminate();if(workerRef.current?.worker===worker){clearTimeout(workerRef.current.timeout);workerRef.current=null}};
      const timeout=setTimeout(()=>{if(canvas){canvas.dataset.layoutState='fallback-timeout';canvas.dataset.layoutError='Worker startup exceeded 10 seconds.'}stop()},10_000);
      workerRef.current={worker,timeout};if(canvas){canvas.dataset.layoutState='relaxing';delete canvas.dataset.layoutError}
      worker.onmessage=(event:MessageEvent<{positions:Position[];iterations:number;durationMs:number}>)=>{
        if(workerRef.current?.worker!==worker)return;
        const coordinates=new Map<string,{x:number;y:number}>();
        for(const point of event.data.positions)if(Number.isFinite(point.x)&&Number.isFinite(point.y)&&Math.abs(point.x)<1e6&&Math.abs(point.y)<1e6)coordinates.set(point.key,{x:point.x,y:point.y});
        // Retain complete run positions when only a replay subset is visible.
        for(const [key,point] of coordinates){positionsRef.current.set(key,point);settledPositionsRef.current.set(key,point)}
        settledTopologyRef.current=topology;layoutSceneRef.current=positionScene(layoutSceneRef.current,positionsRef.current);
        if(canvas){canvas.dataset.layoutState='settled';canvas.dataset.layoutMs=String(event.data.durationMs);canvas.dataset.layoutSteps=String(event.data.iterations);delete canvas.dataset.layoutError}
        stop();retarget.current();
      };
      worker.onerror=(event)=>{if(workerRef.current?.worker!==worker)return;if(canvas){canvas.dataset.layoutState='fallback-error';canvas.dataset.layoutError=event.message||'Worker script failed to load or execute.'}stop()};
      worker.postMessage({nodes:layoutSceneRef.current.nodes.map(node=>({key:node.key,x:node.x,y:node.y,root:node.root,settled:previous.has(node.key)})),edges:layoutScene.lines,warmStart:previous.size>layoutScene.nodes.length*.6});
    }catch(error){if(canvas){canvas.dataset.layoutState='fallback-error';canvas.dataset.layoutError=error instanceof Error?error.message:String(error)}}
  },[layoutScene]);
  useEffect(()=>()=>{if(workerRef.current){workerRef.current.worker.terminate();clearTimeout(workerRef.current.timeout);workerRef.current=null}},[]);
  useEffect(()=>{zoomRef.current=zoom;schedule.current()},[zoom]);
  useEffect(()=>{selectedRef.current=selected;schedule.current()},[selected]);
  useEffect(()=>{activeRef.current=active;schedule.current()},[active]);
  useEffect(()=>{crawlerRef.current=crawlerUrl;schedule.current()},[crawlerUrl]);
  useEffect(()=>{onZoomRef.current=setZoom},[setZoom]);
  useEffect(()=>{offset.current={x:0,y:0};schedule.current()},[layoutKey]);
  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;const ctx=canvas.getContext('2d');if(!ctx)return;
    const preference=window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame:number|null=null,disposed=false,renderCount=0,lastTime=0,flowTime=0;
    let reducedMotion=preference.matches,onScreen=true,cameraReady=false,focusReady=false,crawlerReady=false;
    const camera={x:{value:0,velocity:0},y:{value:0,velocity:0},scale:{value:1,velocity:0}},activity:Spring={value:0,velocity:0};
    const focusPosition={x:{value:0,velocity:0},y:{value:0,velocity:0}};
    const crawlerPosition={x:{value:0,velocity:0},y:{value:0,velocity:0}};
    const trail:{x:number;y:number}[]=[];
    const drawTimes:number[]=[];
    function draw(now:number){
      frame=null;if(disposed||document.hidden||!onScreen){lastTime=0;return}
      const started=performance.now(),seconds=lastTime?Math.min(.1,(now-lastTime)/1000):1/60;lastTime=now;
      const {width:w,height:h}=size.current,{nodes,lines}=sceneRef.current,bounds=layoutSceneRef.current.bounds;
      let moving=motion.current.advance(seconds,now,reducedMotion);
      const fit=Math.max(.03,Math.min((w-100)/Math.max(140,bounds.right-bounds.left),(h-120)/Math.max(140,bounds.bottom-bounds.top),1.6));
      moving=stepSpring(camera.x,(bounds.left+bounds.right)/2,seconds,reducedMotion||!cameraReady)||moving;
      moving=stepSpring(camera.y,(bounds.top+bounds.bottom)/2,seconds,reducedMotion||!cameraReady)||moving;
      moving=stepSpring(camera.scale,fit,seconds,reducedMotion||!cameraReady,.00002)||moving;cameraReady=true;
      moving=stepSpring(activity,activeRef.current&&!reducedMotion?1:0,seconds,reducedMotion,.001)||moving;
      flowTime+=seconds*activity.value;
      const scale=camera.scale.value*zoomRef.current,points=new Map<string,{node:Node;x:number;y:number;alpha:number}>();
      for(const node of nodes){
        const point=motion.current.points.get(node.key);if(!point)continue;
        points.set(node.key,{node,x:w/2+offset.current.x+(point.x.value-camera.x.value)*scale,y:h/2+offset.current.y+(point.y.value-camera.y.value)*scale,alpha:point.alpha});
      }
      rendered.current=[...points.values()].filter(p=>p.alpha>.15&&p.x>-20&&p.x<w+20&&p.y>-20&&p.y<h+20);
      const agentPoint=points.get(keyOf(crawlerRef.current));
      const focus=nodes.find(n=>n.id===selectedRef.current||n.key===selectedRef.current||n.url===selectedRef.current)?.key||hoverRef.current||agentPoint?.node.key||'';
      const connected=new Set<string>(),rootCount=nodes.reduce((n,node)=>n+Number(node.root),0);
      for(const line of lines)if(line.source===focus||line.target===focus){connected.add(line.source);connected.add(line.target)}
      const dpr=Math.min(window.devicePixelRatio||1,2);ctx!.setTransform(dpr,0,0,dpr,0,0);ctx!.clearRect(0,0,w,h);
      // Batch stable edges, then overlay just the growing branches and travelling activity markers.
      const growing:{a:{x:number;y:number};b:{x:number;y:number};progress:number;role:string}[]=[],travellers:{a:{x:number;y:number};b:{x:number;y:number};phase:number}[]=[];
      for(const role of ['cross','tree','focus']){
        ctx!.beginPath();ctx!.lineWidth=role==='focus'?.8:.55;
        ctx!.strokeStyle=role==='focus'?(activeRef.current?'rgba(155,221,208,.50)':'rgba(230,230,230,.64)'):role==='tree'?'rgba(182,182,182,.34)':'rgba(153,153,153,.12)';
        for(const line of lines){
          const highlighted=line.source===focus||line.target===focus;
          if((role==='focus'&&!highlighted)||(role!=='focus'&&highlighted)||(role==='tree'&&!line.tree)||(role==='cross'&&line.tree))continue;
          const a=points.get(line.source),b=points.get(line.target);if(!a||!b)continue;
          if((a.x<0&&b.x<0)||(a.x>w&&b.x>w)||(a.y<0&&b.y<0)||(a.y>h&&b.y>h))continue;
          const progress=reducedMotion?1:Math.min(1,Math.max(0,(now-(edgeBirths.current.get(line.source+'\n'+line.target)??now))/750));
          if(progress<1){growing.push({a,b,progress,role});moving=true}else{ctx!.moveTo(a.x,a.y);ctx!.lineTo(b.x,b.y)}
          if(activity.value>.01&&highlighted&&travellers.length<24)travellers.push({a,b,phase:hashPhase(line.target)});
        }
        ctx!.stroke();
      }
      const growthBatches=new Map<string,typeof growing>();
      for(const edge of growing){const key=edge.role+':'+Math.ceil(edge.progress*8),batch=growthBatches.get(key);if(batch)batch.push(edge);else growthBatches.set(key,[edge])}
      for(const batch of growthBatches.values()){
        const {role}=batch[0];ctx!.globalAlpha=1-(1-batch[0].progress)**3;ctx!.lineWidth=role==='focus'?.8:.55;
        ctx!.strokeStyle=role==='focus'?(activeRef.current?'#9bddd0':'#c2c2c2'):role==='tree'?'#555555':'#303030';ctx!.beginPath();
        for(const {a,b,progress} of batch){const eased=1-(1-progress)**3;ctx!.moveTo(a.x,a.y);ctx!.lineTo(a.x+(b.x-a.x)*eased,a.y+(b.y-a.y)*eased)}ctx!.stroke();
      }
      ctx!.globalAlpha=1;
      if(travellers.length){
        ctx!.fillStyle=`rgba(192,242,229,${activity.value*.9})`;ctx!.beginPath();
        for(const {a,b,phase} of travellers){const t=(flowTime*.48+phase/(Math.PI*2))%1,x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;ctx!.moveTo(x+1.35,y);ctx!.arc(x,y,1.35,0,Math.PI*2)}ctx!.fill();
      }
      for(const p of rendered.current){
        const node=p.node,focused=node.key===focus,near=connected.has(node.key),indexed=node.status==='indexed';
        const failed=['blocked','error','skipped'].includes(node.status),radius=node.root?3.3:focused?3:indexed?1.9:1.15;
        ctx!.globalAlpha=points.get(node.key)!.alpha;
        if(focused){const halo=ctx!.createRadialGradient(p.x,p.y,1,p.x,p.y,26);halo.addColorStop(0,'rgba(155,221,208,.20)');halo.addColorStop(1,'rgba(155,221,208,0)');ctx!.fillStyle=halo;ctx!.fillRect(p.x-26,p.y-26,52,52)}
        ctx!.beginPath();ctx!.arc(p.x,p.y,radius,0,Math.PI*2);
        ctx!.fillStyle=focused?'#c3f2e8':node.root?'#f0f0f0':near?'#d1d1d1':indexed?'#b1b1b1':'#747474';
        if(failed){ctx!.lineWidth=.7;ctx!.strokeStyle='#7c7c7c';ctx!.stroke()}else ctx!.fill();
        if(!focused&&node.status==='processing'){
          // A quiet tracking ring, like the reference, marks the page currently being visited.
          ctx!.lineWidth=.8;ctx!.strokeStyle=focused?'#9bddd0':'#8b8b8b';ctx!.beginPath();ctx!.arc(p.x,p.y,7+Math.sin(flowTime*2.4)*activity.value,0,Math.PI*2);ctx!.stroke();
          if(activity.value>.01){const pulse=(flowTime*.5)%1;ctx!.globalAlpha*=activity.value*(1-pulse)*.35;ctx!.beginPath();ctx!.arc(p.x,p.y,9+pulse*13,0,Math.PI*2);ctx!.stroke();ctx!.globalAlpha=points.get(node.key)!.alpha}
        }
        if((focused&&(selectedRef.current||hoverRef.current))||(node.root&&rootCount<=6&&(!agentPoint||Math.hypot(p.x-agentPoint.x,p.y-agentPoint.y)>70))){
          const raw=focused?node.label:shortUrl(node.url),text=raw.length>48?raw.slice(0,47)+'…':raw;
          ctx!.font=MONO;const textWidth=ctx!.measureText(text).width;
          const x=Math.max(8,Math.min(w-textWidth-16,p.x+12)),y=Math.max(45,Math.min(h-45,p.y-9));
          ctx!.fillStyle='rgba(18,18,18,.93)';ctx!.fillRect(x-4,y-11,textWidth+8,17);ctx!.fillStyle=focused?'#efefef':'#9c9c9c';ctx!.fillText(text,x,y);
        }
      }
      ctx!.globalAlpha=1;
      const focusPoint=points.get(focus);
      if(focusPoint){
        moving=stepSpring(focusPosition.x,focusPoint.x,seconds,reducedMotion||!focusReady)||moving;
        moving=stepSpring(focusPosition.y,focusPoint.y,seconds,reducedMotion||!focusReady)||moving;focusReady=true;
        const x=focusPosition.x.value,y=focusPosition.y.value;
        ctx!.lineWidth=.85;ctx!.strokeStyle='#9bddd0';ctx!.beginPath();ctx!.arc(x,y,7+Math.sin(flowTime*2.4)*activity.value,0,Math.PI*2);ctx!.stroke();
        if(activity.value>.01){const pulse=(flowTime*.5)%1;ctx!.globalAlpha=activity.value*(1-pulse)*.4;ctx!.beginPath();ctx!.arc(x,y,9+pulse*13,0,Math.PI*2);ctx!.stroke();ctx!.globalAlpha=1}
      }else focusReady=false;
      // The crawler is an independent agent. Only request events change its destination.
      if(agentPoint){
        moving=stepSpring(crawlerPosition.x,agentPoint.x,seconds,reducedMotion||!crawlerReady)||moving;
        moving=stepSpring(crawlerPosition.y,agentPoint.y,seconds,reducedMotion||!crawlerReady)||moving;
        crawlerReady=true;
        const x=crawlerPosition.x.value,y=crawlerPosition.y.value;
        canvas!.dataset.crawlerUrl=crawlerRef.current;
        canvas!.dataset.crawlerPosition=`${x.toFixed(1)},${y.toFixed(1)}`;
        if(!reducedMotion){trail.push({x,y});if(trail.length>34)trail.shift();}
        if(trail.length>1){
          ctx!.lineWidth=1;
          for(let i=1;i<trail.length;i++){ctx!.strokeStyle=`rgba(137,230,202,${i/trail.length*.26})`;ctx!.beginPath();ctx!.moveTo(trail[i-1].x,trail[i-1].y);ctx!.lineTo(trail[i].x,trail[i].y);ctx!.stroke();}
        }
        const halo=ctx!.createRadialGradient(x,y,3,x,y,52);
        halo.addColorStop(0,'rgba(121,230,191,.23)');halo.addColorStop(1,'rgba(121,230,191,0)');ctx!.fillStyle=halo;ctx!.fillRect(x-52,y-52,104,104);
        // Radial articulated legs echo the reference while the web itself stays still.
        ctx!.lineWidth=.9;
        for(let i=0;i<24;i++){
          const angle=i/24*Math.PI*2,bend=Math.sin(flowTime*3+i*.8)*activity.value*.15;
          const reach=27+(i%3)*5+Math.sin(flowTime*2.5+i)*activity.value*3;
          ctx!.strokeStyle=i%3===0?'rgba(180,255,224,.85)':'rgba(118,221,180,.52)';
          ctx!.beginPath();ctx!.moveTo(x+Math.cos(angle)*9,y+Math.sin(angle)*9);
          ctx!.lineTo(x+Math.cos(angle+bend)*20,y+Math.sin(angle+bend)*20);
          ctx!.lineTo(x+Math.cos(angle+bend+.12)*reach,y+Math.sin(angle+bend+.12)*reach);ctx!.stroke();
        }
        ctx!.fillStyle='#182d27';ctx!.strokeStyle='#a8efd1';ctx!.lineWidth=1;ctx!.beginPath();ctx!.arc(x,y,10,0,Math.PI*2);ctx!.fill();ctx!.stroke();
        ctx!.fillStyle='#c4ffe3';ctx!.beginPath();ctx!.arc(x,y,3.5,0,Math.PI*2);ctx!.fill();
        if(activity.value>.01){const pulse=(flowTime*.7)%1;ctx!.strokeStyle=`rgba(154,235,200,${(1-pulse)*.32})`;ctx!.beginPath();ctx!.arc(x,y,16+pulse*35,0,Math.PI*2);ctx!.stroke();}
        ctx!.font=MONO;ctx!.fillStyle='#c2e6d8';const label=activeRef.current?'crawler / active':'crawler / resting';
        ctx!.fillText(label,Math.max(12,Math.min(w-125,x+42)),Math.max(65,Math.min(h-60,y-15)));
      }else{crawlerReady=false;trail.length=0;delete canvas!.dataset.crawlerUrl;delete canvas!.dataset.crawlerPosition;}
      const duration=performance.now()-started;drawTimes.push(duration);if(drawTimes.length>120)drawTimes.shift();
      canvas!.dataset.renderCount=String(++renderCount);canvas!.dataset.drawMs=String(Math.round(duration*100)/100);
      canvas!.dataset.averageDrawMs=String(Math.round(drawTimes.reduce((sum,time)=>sum+time,0)/drawTimes.length*100)/100);
      canvas!.dataset.motionState=reducedMotion?'reduced':activeRef.current?'live':moving?'settling':'idle';
      if(moving||(activeRef.current&&!reducedMotion&&nodes.length>0))schedule.current();else lastTime=0;
    }
    schedule.current=()=>{if(frame===null&&!disposed&&!document.hidden&&onScreen)frame=requestAnimationFrame(draw)};
    function resize(){const r=canvas!.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);size.current={width:Math.max(1,r.width),height:Math.max(1,r.height)};canvas!.width=Math.round(r.width*dpr);canvas!.height=Math.round(r.height*dpr);schedule.current()}
    const observer=new ResizeObserver(resize);observer.observe(canvas);resize();
    function visibility(){if(document.hidden||!onScreen){if(frame!==null)cancelAnimationFrame(frame);frame=null;lastTime=0}else schedule.current()}
    const intersection=new IntersectionObserver(entries=>{onScreen=entries[0]?.isIntersecting??true;visibility()});intersection.observe(canvas);
    const preferenceChanged=()=>{reducedMotion=preference.matches;schedule.current()};preference.addEventListener('change',preferenceChanged);document.addEventListener('visibilitychange',visibility);
    function wheel(e:WheelEvent){
      e.preventDefault();const old=zoomRef.current,next=Math.max(.45,Math.min(2.7,old*Math.exp(-Math.max(-120,Math.min(120,e.deltaY))*.002)));
      const rect=canvas!.getBoundingClientRect(),px=e.clientX-rect.left-size.current.width/2,py=e.clientY-rect.top-size.current.height/2,ratio=next/old;
      offset.current={x:px-(px-offset.current.x)*ratio,y:py-(py-offset.current.y)*ratio};zoomRef.current=next;onZoomRef.current(next);schedule.current();
    }
    canvas.addEventListener('wheel',wheel,{passive:false});
    return()=>{disposed=true;if(frame!==null)cancelAnimationFrame(frame);observer.disconnect();intersection.disconnect();canvas.removeEventListener('wheel',wheel);document.removeEventListener('visibilitychange',visibility);preference.removeEventListener('change',preferenceChanged);schedule.current=()=>{}};
  },[]);
  function hit(clientX:number,clientY:number){
    const rect=canvasRef.current!.getBoundingClientRect(),x=clientX-rect.left,y=clientY-rect.top;
    let closest:Node|undefined,distance=9;
    for(const point of rendered.current){const d=Math.hypot(point.x-x,point.y-y);if(d<distance){closest=point.node;distance=d}}
    return closest;
  }
  function clearHover(){if(hoverRef.current){hoverRef.current='';setHover(null);schedule.current()}}
  function fit(){offset.current={x:0,y:0};zoomRef.current=1;setZoom(1);schedule.current()}
  return <div className="graph-canvas" style={{background:'#121212'}}>
    <canvas ref={canvasRef} tabIndex={0} aria-label={`Crawl spider: ${scene.nodes.length} discovered URLs and ${scene.lines.length} real hyperlinks. Drag to pan, scroll to zoom, press F to fit.`} style={{backgroundImage:'radial-gradient(#272727 .65px,transparent .65px)',backgroundSize:'24px 24px',touchAction:'none'}}
      onPointerDown={e=>{if(e.button!==0)return;drag.current={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,moved:false};e.currentTarget.setPointerCapture(e.pointerId);e.currentTarget.style.cursor='grabbing';clearHover()}}
      onPointerMove={e=>{
        if(drag.current){const d=drag.current;offset.current.x+=e.clientX-d.x;offset.current.y+=e.clientY-d.y;d.moved ||= Math.hypot(e.clientX-d.startX,e.clientY-d.startY)>3;d.x=e.clientX;d.y=e.clientY;schedule.current();return}
        const node=hit(e.clientX,e.clientY),key=node?.key||'';e.currentTarget.style.cursor=node?'pointer':'grab';
        if(key!==hoverRef.current){hoverRef.current=key;setHover(node?{label:node.label,url:node.url,status:node.status}:null);schedule.current()}
      }}
      onPointerUp={e=>{if(drag.current&&!drag.current.moved){const node=hit(e.clientX,e.clientY);if(node)select(node.resource)}drag.current=null;e.currentTarget.style.cursor='grab';if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)}}
      onPointerCancel={()=>{drag.current=null;clearHover()}} onPointerLeave={()=>{if(!drag.current)clearHover()}}
      onDoubleClick={fit}
      onKeyDown={e=>{if(e.key.toLowerCase()==='f'||e.key==='0'){e.preventDefault();fit()}else if(['+','=','-'].includes(e.key)){e.preventDefault();setZoom(Math.max(.45,Math.min(2.7,zoomRef.current*(e.key==='-'?.85:1.15))))}else if(e.key.startsWith('Arrow')){e.preventDefault();offset.current.x+=e.key==='ArrowLeft'?30:e.key==='ArrowRight'?-30:0;offset.current.y+=e.key==='ArrowUp'?30:e.key==='ArrowDown'?-30:0;schedule.current()}}}/>
    {!scene.nodes.length&&<div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:12,transform:'translateY(-30px)',pointerEvents:'none',color:'#8e8e8e'}}><svg width="58" height="58" viewBox="0 0 58 58" fill="none" aria-hidden="true"><circle cx="29" cy="29" r="6" stroke="#9c9c9c"/><circle cx="29" cy="29" r="2" fill="#cecece"/><path d="M29 23V9M35 29h14M29 35v14M23 29H9M33.3 24.7l10-10M24.7 33.3l-10 10M24.7 24.7l-10-10M33.3 33.3l10 10" stroke="#4c4c4c"/><circle cx="29" cy="8" r="2" fill="#737373"/><circle cx="50" cy="29" r="2" fill="#737373"/><circle cx="29" cy="50" r="2" fill="#737373"/><circle cx="8" cy="29" r="2" fill="#737373"/></svg><span style={{fontSize:13,color:'#c1c1c1'}}>Your crawl starts here.</span><span style={{fontSize:10,maxWidth:290,textAlign:'center',lineHeight:1.7}}>Launch a crawl to see real pages and the links they reveal.</span></div>}
    {hover&&<div className="graph-tooltip" style={{maxWidth:'calc(100% - 32px)',background:'#1d1d1d',borderColor:'#424242',color:'#dcdcdc',zIndex:3,lineHeight:1.6,overflowWrap:'anywhere'}}><div style={{fontSize:9,color:'#9c9c9c',textTransform:'uppercase',letterSpacing:1}}>{hover.status}</div>{hover.label}<div style={{fontSize:9,color:'#898989',maxWidth:460,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{hover.url}</div></div>}
  </div>;
}
function sameList<T>(a:T[]|undefined,b:T[]|undefined,equal:(a:T,b:T)=>boolean){
  if(a===b)return true;if((a?.length||0)!==(b?.length||0))return false;
  return (a||[]).every((item,i)=>equal(item,b![i]));
}
function samePage(a:PageRecord,b:PageRecord){
  return a.id===b.id&&a.url===b.url&&a.parentUrl===b.parentUrl&&a.sourceId===b.sourceId&&a.status===b.status&&a.depth===b.depth&&a.title===b.title&&a.name===b.name&&a.description===b.description&&a.domain===b.domain&&a.category===b.category&&sameList(a.tags,b.tags,(x,y)=>x===y);
}
// Polling returns fresh objects; unchanged evidence must not recompute the layout or repaint.
export default memo(Graph,(a,b)=>a.active===b.active&&a.crawlerUrl===b.crawlerUrl&&a.selected===b.selected&&a.zoom===b.zoom&&a.layoutKey===b.layoutKey&&a.select===b.select&&a.setZoom===b.setZoom&&
  sameList(a.sources,b.sources,(x,y)=>x.id===y.id&&x.name===y.name&&x.url===y.url&&x.feedUrl===y.feedUrl&&x.domain===y.domain&&x.category===y.category&&x.access===y.access&&x.geography===y.geography&&x.crawlMethod===y.crawlMethod)&&
  sameList(a.layoutPages,b.layoutPages,samePage)&&sameList(a.layoutFrontier,b.layoutFrontier,samePage)&&sameList(a.layoutEdges,b.layoutEdges,(x,y)=>x.source===y.source&&x.target===y.target)&&
  sameList(a.pages,b.pages,samePage)&&sameList(a.frontier,b.frontier,samePage)&&
  sameList(a.edges,b.edges,(x,y)=>x.source===y.source&&x.target===y.target)&&sameList(a.seedUrls,b.seedUrls,(x,y)=>x===y));
