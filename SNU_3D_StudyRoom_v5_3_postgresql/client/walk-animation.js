// Mesh-agnostic stride controller shared by local, remote and NPC avatars.
// Input is actual planar displacement (world units) per frame, not a key press.
export function advanceWalkState(state,distance,dt,seated=false){
 const seconds=Number.isFinite(dt)&&dt>0?dt:0;
 const meters=Number.isFinite(distance)?Math.max(0,distance):0;
 const speed=!seated&&seconds>0?Math.min(5,meters/seconds):0;
 const blendTarget=Math.min(1,speed/2.8);
 state.blend+=(blendTarget-state.blend)*Math.min(1,seconds*12);
 if(speed>.07)state.phase+=meters*3.7;
 state.swing=Math.sin(state.phase)*.65*state.blend;
 state.bob=Math.abs(Math.sin(state.phase))*.036*state.blend;
 state.speed=speed;
 return state; // Avoid per-character allocations on every animation frame.
}
