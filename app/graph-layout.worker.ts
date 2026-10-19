// This worker has no imports and performs one bounded relaxation per message.
type LayoutInput={nodes:{key:string;x:number;y:number;root:boolean;settled:boolean}[];edges:{source:string;target:string;tree?:boolean}[];warmStart?:boolean};
type LayoutOutput={positions:{key:string;x:number;y:number}[];iterations:number;durationMs:number};
const scope=self as unknown as {onmessage:((event:MessageEvent<LayoutInput>)=>void)|null;postMessage:(message:LayoutOutput)=>void};
function hash(key:string){let value=2166136261;for(let i=0;i<key.length;i++)value=Math.imul(value^key.charCodeAt(i),16777619);return (value>>>0)/4294967295}
scope.onmessage=({data})=>{
  const started=performance.now(),nodes=data.nodes,n=nodes.length,index=new Map(nodes.map((node,i)=>[node.key,i]));
  const x=new Float64Array(n),y=new Float64Array(n),vx=new Float64Array(n),vy=new Float64Array(n),fx=new Float64Array(n),fy=new Float64Array(n),degree=new Uint32Array(n);
  const links:{a:number;b:number;length:number}[]=[],parents=new Int32Array(n);parents.fill(-1);
  for(const edge of data.edges){const a=index.get(edge.source),b=index.get(edge.target);if(a===undefined||b===undefined||a===b)continue;links.push({a,b,length:0});degree[a]++;degree[b]++;if(edge.tree)parents[b]=a}
  for(let i=0;i<n;i++){
    if(!data.warmStart&&!nodes[i].root){
      // Seed actual branches as irregular overlapping communities, not equal-angle spokes.
      let branch=i,parent=parents[i],hops=0;
      while(parent>=0&&!nodes[parent].root&&hops++<16){branch=parent;parent=parents[parent]}
      const key=nodes[branch].key,angle=hash(key+'cluster-angle')*Math.PI*2,radius=55+hash(key+'cluster-radius')*210;
      const cx=parent>=0?nodes[parent].x:0,cy=parent>=0?nodes[parent].y:0;
      x[i]=cx+Math.cos(angle)*radius+(hash(nodes[i].key+'x')-.5)*75;
      y[i]=cy+Math.sin(angle)*radius*.8+(hash(nodes[i].key+'y')-.5)*75;
    }else{x[i]=nodes[i].x+(nodes[i].settled||nodes[i].root?0:(hash(nodes[i].key+'x')-.5)*22);y[i]=nodes[i].y+(nodes[i].settled||nodes[i].root?0:(hash(nodes[i].key+'y')-.5)*22)}
  }
  for(const link of links)link.length=30+Math.min(30,Math.sqrt(Math.max(degree[link.a],degree[link.b]))*2.2);
  const cellSize=55,maxBucketSamples=12,deadline=started+1100;
  let iterations=0;
  relaxation:for(let step=0;step<80;step++){
    if(performance.now()>deadline)break;
    fx.fill(0);fy.fill(0);
    const grid=new Map<string,number[]>();
    for(let i=0;i<n;i++){const key=`${Math.floor(x[i]/cellSize)},${Math.floor(y[i]/cellSize)}`,bucket=grid.get(key);if(bucket)bucket.push(i);else grid.set(key,[i])}
    for(let i=0;i<n;i++){
      if((i&255)===0&&performance.now()>deadline)break relaxation;
      const gx=Math.floor(x[i]/cellSize),gy=Math.floor(y[i]/cellSize);
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
        const bucket=grid.get(`${gx+dx},${gy+dy}`);if(!bucket)continue;
        // Dense cells are sampled rather than allowing quadratic pair comparisons.
        const stride=Math.max(1,Math.ceil(bucket.length/maxBucketSamples)),offset=(i+step)%stride,weight=Math.min(4,stride);
        for(let k=offset;k<bucket.length;k+=stride){
          const j=bucket[k];if(i===j)continue;
          let ax=x[i]-x[j],ay=y[i]-y[j],squared=ax*ax+ay*ay;
          if(squared>12100)continue;
          if(squared<.01){ax=(hash(`${i}:${j}`)-.5)*2;ay=(hash(`${j}:${i}`)-.5)*2;squared=ax*ax+ay*ay+.1}
          const distance=Math.sqrt(squared),force=700*weight/((distance+5)*(distance+5));
          fx[i]+=ax/distance*force;fy[i]+=ay/distance*force;
        }
      }
    }
    for(const {a,b,length} of links){
      const dx=x[b]-x[a],dy=y[b]-y[a],distance=Math.sqrt(dx*dx+dy*dy)||1;
      const force=Math.max(-4,Math.min(6,(distance-length)*.035)),ax=dx/distance*force,ay=dy/distance*force;
      fx[a]+=ax;fy[a]+=ay;fx[b]-=ax;fy[b]-=ay;
    }
    const maximumStep=10*(1-step/80)+1;
    for(let i=0;i<n;i++){
      if(nodes[i].root)continue;
      const divisor=Math.max(1,Math.sqrt(degree[i])*.7),anchor=nodes[i].settled ? .018 : 0;
      vx[i]=vx[i]*.5+(fx[i]/divisor-x[i]*.001+(nodes[i].x-x[i])*anchor)*.65;
      vy[i]=vy[i]*.5+(fy[i]/divisor-y[i]*.001+(nodes[i].y-y[i])*anchor)*.65;
      const speed=Math.sqrt(vx[i]*vx[i]+vy[i]*vy[i]),limit=speed>maximumStep?maximumStep/speed:1;
      x[i]+=vx[i]*limit;y[i]+=vy[i]*limit;
    }
    iterations++;
  }
  scope.postMessage({positions:nodes.map((node,i)=>({key:node.key,x:x[i],y:y[i]})),iterations,durationMs:Math.round(performance.now()-started)});
};
export {};
