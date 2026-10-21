import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';

test('The bounded layout worker returns finite 3D positions for the actual topology and preserves roots',()=>{
  const nodes=Array.from({length:600},(_,index)=>({key:`page-${index}`,x:index===0?30:0,y:index===0?-20:0,z:index===0?50:0,root:index===0,settled:false}));
  const edges=nodes.slice(1).map((node,index)=>({source:`page-${Math.floor(index/4)}`,target:node.key,tree:true}));
  let output:{positions:{key:string;x:number;y:number;z:number}[];iterations:number;durationMs:number}|undefined;
  const scope:{onmessage?:({data}:any)=>void;postMessage:(value:any)=>void}={postMessage:value=>{output=value}};
  const source=stripTypeScriptTypes(readFileSync(new URL('../app/graph-layout.worker.ts',import.meta.url),'utf8')).replace(/export\s*\{\s*\};?\s*$/,'');
  runInNewContext(source,{self:scope,performance});scope.onmessage!({data:{nodes,edges,warmStart:false}});
  assert.ok(output);assert.equal(output.positions.length,nodes.length);assert.ok(output.iterations>0&&output.iterations<=80);
  assert.deepEqual(output.positions.map(point=>point.key),nodes.map(node=>node.key));
  assert.ok(output.positions.every(point=>[point.x,point.y,point.z].every(Number.isFinite)));
  assert.equal(output.positions[0].x,30);assert.equal(output.positions[0].y,-20);assert.equal(output.positions[0].z,50);
  assert.ok(new Set(output.positions.map(point=>Math.round(point.z))).size>10,'The result must occupy genuine depth, not a rotated flat plane.');
});
