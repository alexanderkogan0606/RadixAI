// This worker has no imports and performs one bounded 3D relaxation per actual topology change.
type LayoutInput={nodes:{key:string;x:number;y:number;z:number;root:boolean;settled:boolean}[];edges:{source:string;target:string;tree?:boolean}[];warmStart?:boolean};
type LayoutOutput={positions:{key:string;x:number;y:number;z:number}[];iterations:number;durationMs:number};
const scope=self as unknown as {onmessage:((event:MessageEvent<LayoutInput>)=>void)|null;postMessage:(message:LayoutOutput)=>void};
function hash(key:string){let value=2166136261;for(let i=0;i<key.length;i++)value=Math.imul(value^key.charCodeAt(i),16777619);return (value>>>0)/4294967295}
scope.onmessage=({data})=>{
  const started=performance.now(),nodes=data.nodes,n=nodes.length,index=new Map(nodes.map((node,i)=>[node.key,i]));
  const x=new Float64Array(n),y=new Float64Array(n),z=new Float64Array(n),vx=new Float64Array(n),vy=new Float64Array(n),vz=new Float64Array(n),fx=new Float64Array(n),fy=new Float64Array(n),fz=new Float64Array(n),degree=new Uint32Array(n);
  const links:{a:number;b:number;length:number}[]=[],parents=new Int32Array(n);parents.fill(-1);
  for(const edge of data.edges){const a=index.get(edge.source),b=index.get(edge.target);if(a===undefined||b===undefined||a===b)continue;links.push({a,b,length:0});degree[a]++;degree[b]++;if(edge.tree)parents[b]=a}
  for(let i=0;i<n;i++){
    if(!data.warmStart&&!nodes[i].root){
      let branch=i,parent=parents[i],hops=0;
      while(parent>=0&&!nodes[parent].root&&hops++<16){branch=parent;parent=parents[parent]}
      const key=nodes[branch].key,angle=hash(key+'cluster-angle')*Math.PI*2,radius=55+hash(key+'cluster-radius')*210,latitude=(hash(key+'cluster-latitude')-.5)*Math.PI;
      const cx=parent>=0?nodes[parent].x:0,cy=parent>=0?nodes[parent].y:0,cz=parent>=0?nodes[parent].z:0;
      x[i]=cx+Math.cos(angle)*Math.cos(latitude)*radius+(hash(nodes[i].key+'x')-.5)*75;
      y[i]=cy+Math.sin(angle)*Math.cos(latitude)*radius+(hash(nodes[i].key+'y')-.5)*75;
      z[i]=cz+Math.sin(latitude)*radius+(hash(nodes[i].key+'z')-.5)*75;
    }else{
      const jitter=nodes[i].settled||nodes[i].root?0:22;
      x[i]=nodes[i].x+(hash(nodes[i].key+'x')-.5)*jitter;y[i]=nodes[i].y+(hash(nodes[i].key+'y')-.5)*jitter;z[i]=nodes[i].z+(hash(nodes[i].key+'z')-.5)*jitter;
    }
  }
  for(const link of links)link.length=38+Math.min(35,Math.sqrt(Math.max(degree[link.a],degree[link.b]))*2.4);
  const cellSize=65,maxBucketSamples=10,deadline=started+1100;
  let iterations=0;
  relaxation:for(let step=0;step<80;step++){
    if(performance.now()>deadline)break;
    fx.fill(0);fy.fill(0);fz.fill(0);
    const grid=new Map<string,number[]>();
    for(let i=0;i<n;i++){const key=`${Math.floor(x[i]/cellSize)},${Math.floor(y[i]/cellSize)},${Math.floor(z[i]/cellSize)}`,bucket=grid.get(key);if(bucket)bucket.push(i);else grid.set(key,[i])}
    for(let i=0;i<n;i++){
      if((i&127)===0&&performance.now()>deadline)break relaxation;
      const gx=Math.floor(x[i]/cellSize),gy=Math.floor(y[i]/cellSize),gz=Math.floor(z[i]/cellSize);
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++){
        const bucket=grid.get(`${gx+dx},${gy+dy},${gz+dz}`);if(!bucket)continue;
        const stride=Math.max(1,Math.ceil(bucket.length/maxBucketSamples)),offset=(i+step)%stride,weight=Math.min(4,stride);
        for(let k=offset;k<bucket.length;k+=stride){
          const j=bucket[k];if(i===j)continue;
          let ax=x[i]-x[j],ay=y[i]-y[j],az=z[i]-z[j],squared=ax*ax+ay*ay+az*az;
          if(squared>16900)continue;
          if(squared<.01){ax=(hash(`${i}:${j}:x`)-.5)*2;ay=(hash(`${i}:${j}:y`)-.5)*2;az=(hash(`${i}:${j}:z`)-.5)*2;squared=ax*ax+ay*ay+az*az+.1}
          const distance=Math.sqrt(squared),force=850*weight/((distance+5)*(distance+5));
          fx[i]+=ax/distance*force;fy[i]+=ay/distance*force;fz[i]+=az/distance*force;
        }
      }
    }
    for(const {a,b,length} of links){
      const dx=x[b]-x[a],dy=y[b]-y[a],dz=z[b]-z[a],distance=Math.hypot(dx,dy,dz)||1;
      const force=Math.max(-4,Math.min(6,(distance-length)*.035)),ax=dx/distance*force,ay=dy/distance*force,az=dz/distance*force;
      fx[a]+=ax;fy[a]+=ay;fz[a]+=az;fx[b]-=ax;fy[b]-=ay;fz[b]-=az;
    }
    const maximumStep=10*(1-step/80)+1;
    for(let i=0;i<n;i++){
      if(nodes[i].root)continue;
      const divisor=Math.max(1,Math.sqrt(degree[i])*.7),anchor=nodes[i].settled?.018:0;
      vx[i]=vx[i]*.5+(fx[i]/divisor-x[i]*.001+(nodes[i].x-x[i])*anchor)*.65;
      vy[i]=vy[i]*.5+(fy[i]/divisor-y[i]*.001+(nodes[i].y-y[i])*anchor)*.65;
      vz[i]=vz[i]*.5+(fz[i]/divisor-z[i]*.001+(nodes[i].z-z[i])*anchor)*.65;
      const speed=Math.hypot(vx[i],vy[i],vz[i]),limit=speed>maximumStep?maximumStep/speed:1;
      x[i]+=vx[i]*limit;y[i]+=vy[i]*limit;z[i]+=vz[i]*limit;
    }
    iterations++;
  }
  scope.postMessage({positions:nodes.map((node,i)=>({key:node.key,x:x[i],y:y[i],z:z[i]})),iterations,durationMs:Math.round(performance.now()-started)});
};
export {};
