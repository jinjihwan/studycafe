// Public campus-level learner / available-seat summary for the library chooser.
// Includes active virtual learners without exposing a separate virtual count.
import {roomCapacity,parsedPublicRoom} from './room-routing.js';
export const SEATS_PER_ROOM=48;
export function librarySeatTotals(library,counts,virtualLearners){
 if(!(counts instanceof Map))throw new TypeError('Room counts must be a Map');
 const primary=Number.isFinite(virtualLearners)?Math.max(0,Math.floor(virtualLearners)):0;
 const activeOverflow=[...counts].filter(([room,n])=>{
  const parsed=parsedPublicRoom(room);
  return parsed?.library===library&&parsed.index>1&&Number(n)>0;
 });
 const real=[...counts].filter(([room])=>parsedPublicRoom(room)?.library===library)
   .reduce((total,[,count])=>total+Math.max(0,Number(count)||0),0);
 // There are always 48 physical seats in the first room, including up to 16
 // NPC seats. Each additional active overflow room contributes another 48.
 return {learners:real+primary,seats:SEATS_PER_ROOM+activeOverflow.length*SEATS_PER_ROOM};
}
