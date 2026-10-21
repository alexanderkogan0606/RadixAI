export type Point3={x:number;y:number;z:number};
export type Orbit={yaw:number;pitch:number};
export type ProjectedPoint={x:number;y:number;depth:number;perspective:number};

/** Perspective changes only the view. Crawl URLs and links remain the graph's sole data. */
export function projectPoint(point:Point3,orbit:Orbit,distance:number):ProjectedPoint {
  const cosY=Math.cos(orbit.yaw),sinY=Math.sin(orbit.yaw),cosP=Math.cos(orbit.pitch),sinP=Math.sin(orbit.pitch);
  const x=point.x*cosY+point.z*sinY,z=-point.x*sinY+point.z*cosY;
  const y=point.y*cosP-z*sinP,depth=point.y*sinP+z*cosP;
  const safeDistance=Math.max(1,distance),perspective=safeDistance/Math.max(safeDistance*.2,safeDistance+depth);
  return {x:x*perspective,y:y*perspective,depth,perspective};
}
export function rotateOrbit(orbit:Orbit,dx:number,dy:number):Orbit {
  return {yaw:((orbit.yaw+dx*.006+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI,pitch:Math.max(-Math.PI*.46,Math.min(Math.PI*.46,orbit.pitch+dy*.006))};
}
