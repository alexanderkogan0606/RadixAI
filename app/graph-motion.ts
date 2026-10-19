export type Spring={value:number;velocity:number};
export type Target={key:string;x:number;y:number};
export type MovingPoint={x:Spring;y:Spring;targetX:number;targetY:number;alpha:number;born:number;phase:number;branchPhase:number};

export function hashPhase(key:string){let h=2166136261;for(let i=0;i<key.length;i++)h=Math.imul(h^key.charCodeAt(i),16777619);return (h>>>0)/4294967295*Math.PI*2}

/** Exact critically damped spring: independent of frame rate, with velocity retained on retarget. */
export function stepSpring(spring:Spring,target:number,seconds:number,immediate=false,precision=.015){
  if(immediate){spring.value=target;spring.velocity=0;return false}
  const time=Math.max(0,seconds),frequency=10,delta=spring.value-target;
  const coefficient=spring.velocity+frequency*delta,decay=Math.exp(-frequency*time);
  spring.value=target+(delta+coefficient*time)*decay;
  spring.velocity=(spring.velocity-frequency*coefficient*time)*decay;
  if(Math.abs(spring.value-target)<precision&&Math.abs(spring.velocity)<precision){spring.value=target;spring.velocity=0;return false}
  return true;
}

/** View-only movement. Targets and links always come from actual crawl topology. */
export class GraphMotion{
  points=new Map<string,MovingPoint>();
  update(targets:Target[],parents:Map<string,string>,now:number){
    const targetMap=new Map(targets.map(p=>[p.key,p])),keep=new Set(targetMap.keys());
    for(const key of this.points.keys())if(!keep.has(key))this.points.delete(key);
    for(const target of targets){
      const point=this.points.get(target.key);
      if(point){point.targetX=target.x;point.targetY=target.y;continue}
      const parentKey=parents.get(target.key)||'';
      // Resolve through newly arriving ancestors as well, regardless of input order.
      let ancestor=parentKey,x=target.x,y=target.y;
      const visited=new Set([target.key]);
      while(ancestor&&!visited.has(ancestor)){
        visited.add(ancestor);
        const parent=this.points.get(ancestor),parentTarget=targetMap.get(ancestor);
        if(parent){x=parent.x.value;y=parent.y.value;break}
        if(parentTarget){x=parentTarget.x;y=parentTarget.y}
        ancestor=parents.get(ancestor)||'';
      }
      this.points.set(target.key,{x:{value:x,velocity:0},y:{value:y,velocity:0},targetX:target.x,targetY:target.y,alpha:0,born:now,phase:hashPhase(target.key),branchPhase:hashPhase(parentKey||target.key)});
    }
  }
  advance(seconds:number,now:number,reducedMotion=false){
    let moving=false;
    for(const point of this.points.values()){
      moving=stepSpring(point.x,point.targetX,seconds,reducedMotion)||moving;
      moving=stepSpring(point.y,point.targetY,seconds,reducedMotion)||moving;
      const progress=reducedMotion?1:Math.max(0,Math.min(1,(now-point.born)/650));
      point.alpha=progress*progress*(3-2*progress);
      moving=progress<1||moving;
    }
    return moving;
  }
}
