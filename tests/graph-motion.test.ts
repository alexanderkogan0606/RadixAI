import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's native TypeScript runner needs an explicit extension.
import { GraphMotion, stepSpring } from "../app/graph-motion.ts";

const near=(actual:number,expected:number,tolerance=1e-9)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} should be within ${tolerance} of ${expected}`);
const root={key:"root",x:0,y:0};

test("spring trajectories agree across frame rates and uneven frame durations",()=>{
  const run=(steps:number[])=>{
    const spring={value:-40,velocity:125};
    for(const seconds of steps)stepSpring(spring,200,seconds);
    return spring;
  };
  const reference=run([.5]);
  for(const steps of [Array(15).fill(1/30),Array(30).fill(1/60),Array(72).fill(1/144),[.007,.12,.003,.07,.3]]){
    const result=run(steps);
    near(result.value,reference.value);
    near(result.velocity,reference.velocity);
  }
});

test("position and reveal opacity reach the same state at 30, 60, and 144 fps",()=>{
  const run=(fps:number)=>{
    const motion=new GraphMotion();
    motion.update([root,{key:"child",x:240,y:-120}],new Map([["child","root"]]),100);
    for(let frame=1;frame<=fps/2;frame++)motion.advance(1/fps,100+frame*1000/fps);
    return motion.points.get("child")!;
  };
  const reference=run(60);
  for(const fps of [30,144]){
    const result=run(fps);
    near(result.x.value,reference.x.value);
    near(result.y.value,reference.y.value);
    near(result.x.velocity,reference.x.velocity);
    near(result.alpha,reference.alpha);
  }
  assert.ok(reference.alpha>0&&reference.alpha<1);
});

test("retargeting retains the rendered position and momentum without restarting reveal",()=>{
  const motion=new GraphMotion();
  motion.update([root,{key:"child",x:100,y:60}],new Map([["child","root"]]),0);
  motion.advance(.06,60);
  const point=motion.points.get("child")!;
  const before=structuredClone(point);
  assert.ok(before.x.velocity>0);
  motion.update([root,{key:"child",x:-80,y:-20}],new Map([["child","root"]]),60);
  assert.equal(motion.points.get("child"),point);
  assert.deepEqual(point.x,before.x);
  assert.deepEqual(point.y,before.y);
  assert.equal(point.alpha,before.alpha);
  assert.equal(point.born,before.born);
  assert.equal(point.targetX,-80);
  motion.advance(.001,61);
  assert.ok(point.x.value>before.x.value,"existing positive momentum should survive a reversed target for the next small step");
  assert.ok(Math.abs(point.x.value-before.x.value)<1,"retargeting must not snap to the destination");
});

test("new nodes emerge from the parent's current position while it is moving",()=>{
  const motion=new GraphMotion();
  const parents=new Map([["parent","root"],["child","parent"]]);
  motion.update([root,{key:"parent",x:180,y:90}],parents,0);
  motion.advance(.1,100);
  const parent=motion.points.get("parent")!;
  assert.notEqual(parent.x.value,parent.targetX);
  motion.update([root,{key:"parent",x:180,y:90},{key:"child",x:300,y:200}],parents,100);
  const child=motion.points.get("child")!;
  assert.equal(child.x.value,parent.x.value);
  assert.equal(child.y.value,parent.y.value);
  assert.equal(child.x.velocity,0);
  assert.equal(child.alpha,0);
});

test("a newly discovered subtree spawns consistently even when descendants arrive first",()=>{
  const parents=new Map([["parent","root"],["child","parent"],["grandchild","child"]]);
  const targets=[{key:"root",x:12,y:17},{key:"parent",x:100,y:80},{key:"child",x:200,y:160},{key:"grandchild",x:300,y:240}];
  const forward=new GraphMotion(),reverse=new GraphMotion();
  for(const motion of [forward,reverse])motion.update([targets[0]],parents,0);
  forward.update(targets,parents,100);
  reverse.update([...targets].reverse(),parents,100);
  for(const key of ["parent","child","grandchild"]){
    const a=forward.points.get(key)!,b=reverse.points.get(key)!;
    assert.equal(b.x.value,a.x.value,`${key} should not depend on input ordering`);
    assert.equal(b.y.value,a.y.value,`${key} should not depend on input ordering`);
    assert.equal(b.x.value,12);
    assert.equal(b.y.value,17);
  }
});

test("an identical topology update preserves reveal progress and spring state",()=>{
  const motion=new GraphMotion();
  const targets=[root,{key:"child",x:100,y:50}],parents=new Map([["child","root"]]);
  motion.update(targets,parents,100);
  motion.advance(.25,350);
  const point=motion.points.get("child")!,before=structuredClone(point);
  motion.update(targets.map(target=>({...target})),new Map(parents),350);
  assert.equal(motion.points.get("child"),point);
  assert.deepEqual(point,before);
  motion.advance(0,350);
  assert.deepEqual(point,before,"a metadata-only refresh must not restart or alter the animation");
});

test("reduced motion immediately settles positions, velocities, and reveal opacity",()=>{
  const motion=new GraphMotion();
  motion.update([root,{key:"child",x:300,y:-100}],new Map([["child","root"]]),0);
  motion.advance(.1,100);
  assert.ok(motion.points.get("child")!.x.velocity>0);
  assert.equal(motion.advance(0,100,true),false);
  for(const point of motion.points.values()){
    assert.equal(point.x.value,point.targetX);
    assert.equal(point.y.value,point.targetY);
    assert.equal(point.x.velocity,0);
    assert.equal(point.y.velocity,0);
    assert.equal(point.alpha,1);
  }
});

test("large movements settle in bounded time and stop requesting animation frames",()=>{
  const motion=new GraphMotion();
  motion.update([root,{key:"child",x:1_000_000,y:-500_000}],new Map([["child","root"]]),0);
  let moving=true,frames=0;
  while(moving&&frames<600){
    frames++;
    moving=motion.advance(1/60,frames*1000/60);
    for(const point of motion.points.values()){
      assert.ok([point.x.value,point.y.value,point.x.velocity,point.y.velocity,point.alpha].every(Number.isFinite));
      assert.ok(point.alpha>=0&&point.alpha<=1);
    }
  }
  assert.equal(moving,false);
  assert.ok(frames<300,"even a very long movement should become idle within five seconds");
  const settled=structuredClone([...motion.points]);
  assert.equal(motion.advance(10,20_000),false);
  assert.deepEqual([...motion.points],settled);
});

test("rewinding and revealing a node again leaves surviving nodes continuous",()=>{
  const motion=new GraphMotion();
  const branch={key:"branch",x:100,y:50},leaf={key:"leaf",x:200,y:100};
  const parents=new Map([["branch","root"],["leaf","branch"]]);
  motion.update([root,branch,leaf],parents,0);
  motion.advance(.2,200);
  const branchPoint=motion.points.get("branch")!,before=structuredClone(branchPoint);
  motion.update([root,branch],parents,200);
  assert.equal(motion.points.has("leaf"),false);
  assert.equal(motion.points.get("branch"),branchPoint);
  assert.deepEqual(branchPoint,before);
  motion.update([root,branch,leaf],parents,201);
  assert.equal(motion.points.get("branch"),branchPoint);
  assert.deepEqual(branchPoint,before);
  const revived=motion.points.get("leaf")!;
  assert.equal(revived.x.value,branchPoint.x.value);
  assert.equal(revived.y.value,branchPoint.y.value);
  assert.equal(revived.born,201);
  assert.equal(revived.alpha,0);
});
