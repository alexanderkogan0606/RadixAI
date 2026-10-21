import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Native TypeScript tests require explicit extensions.
import {projectPoint,rotateOrbit} from '../app/graph-projection.ts';
// @ts-expect-error Native TypeScript tests require explicit extensions.
import {GraphMotion} from '../app/graph-motion.ts';
const near=(actual:number,expected:number)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);

test('Perspective preserves the origin and makes nearer real nodes larger',()=>{
  const center=projectPoint({x:0,y:0,z:0},{yaw:.5,pitch:-.2},500);near(center.x,0);near(center.y,0);
  const nearPoint=projectPoint({x:30,y:20,z:-100},{yaw:0,pitch:0},500),farPoint=projectPoint({x:30,y:20,z:100},{yaw:0,pitch:0},500);
  assert.ok(nearPoint.x>farPoint.x);assert.ok(nearPoint.perspective>farPoint.perspective);assert.ok(nearPoint.depth<farPoint.depth);
});

test('Orbit rotates every point coherently without changing the topology or coordinates',()=>{
  const point={x:100,y:0,z:0},before={...point};
  const quarter=projectPoint(point,{yaw:Math.PI/2,pitch:0},500);near(quarter.x,0);near(quarter.depth,-100);assert.deepEqual(point,before);
  const full=projectPoint(point,{yaw:Math.PI*2,pitch:0},500);near(full.x,100);near(full.depth,0);
  const vertical=projectPoint({x:0,y:20,z:80},{yaw:0,pitch:Math.PI/2},500);near(vertical.depth,20);near(vertical.y,-80*500/520);
});

test('Orbit input wraps horizontal rotation, bounds pole flips, and projection stays finite',()=>{
  const orbit=rotateOrbit({yaw:0,pitch:0},1e6,1e6);assert.ok(orbit.yaw>=-Math.PI&&orbit.yaw<=Math.PI);assert.ok(orbit.pitch<Math.PI/2);
  const projected=projectPoint({x:10,y:30,z:-1000},{yaw:0,pitch:0},100);
  assert.ok(Object.values(projected).every(Number.isFinite));assert.equal(projected.perspective,5);
});

test('New 3D discoveries grow from the real parent and settle correctly under reduced motion',()=>{
  const motion=new GraphMotion(),root={key:'root',x:30,y:-20,z:90};motion.update([root],new Map(),0);motion.advance(0,0,true);
  motion.update([root,{key:'child',x:-100,y:90,z:-120}],new Map([['child','root']]),100);
  const child=motion.points.get('child')!;assert.equal(child.z.value,90);
  motion.advance(.05,150);assert.ok(child.z.value<90&&child.z.value>-120);assert.ok(child.z.velocity<0);
  const before=child.z.value;motion.update([root,{key:'child',x:-100,y:90,z:30}],new Map([['child','root']]),150);assert.equal(child.z.value,before);
  motion.advance(0,150,true);assert.equal(child.z.value,30);assert.equal(child.z.velocity,0);assert.equal(child.alpha,1);
});
