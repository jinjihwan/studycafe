/**
 * Visibility-based A* waypoint reduction. It never crosses blocked grid cells:
 *  - a center sample plus two lateral probes reduce corner-clipping
 *  - when a shortcut is blocked, the original A* turn remains
 * Pure module: no Three.js dependency, shared by browser and Node tests.
 */
export function visibleSegment(a,b,walkable){
 if(!a||!b||!Number.isFinite(a.x)||!Number.isFinite(a.z)||!Number.isFinite(b.x)||!Number.isFinite(b.z))return false;
 const dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);
 if(length<1e-6)return !!walkable(a.x,a.z);
 const nx=-dz/length,nz=dx/length;
 const steps=Math.ceil(length/.14);
 for(let k=0;k<=steps;k++){
  const t=k/steps,x=a.x+t*dx,z=a.z+t*dz;
  if(!walkable(x,z)||!walkable(x+nx*.10,z+nz*.10)||!walkable(x-nx*.10,z-nz*.10))return false;
 }
 return true;
}
export function smoothWaypoints(start,raw,walkable){
 if(!Array.isArray(raw)||!raw.length)return [];
 const out=[];let anchor=start,i=0;
 while(i<raw.length){
  let chosen=i;
  for(let j=raw.length-1;j>i;j--){
   if(visibleSegment(anchor,raw[j],walkable)){chosen=j;break;}
  }
  out.push(raw[chosen]);anchor=raw[chosen];i=chosen+1;
 }
 return out;
}
