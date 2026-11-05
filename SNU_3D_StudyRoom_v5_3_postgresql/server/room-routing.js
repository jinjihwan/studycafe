// Stable library sharding: every connection for a room reaches one worker.
// A library's first room keeps NPCs; overflow rooms do not.
export const LIBRARIES = Object.freeze(['main', 'korea', 'yonsei']);
export const PUBLIC_CAPACITY = Object.freeze({primary:32,overflow:48});
export const MAX_AUTO_ROOM_INDEX = 100;
export function parsedPublicRoom(room) {
  if(typeof room !== 'string') return null;
  for(const library of LIBRARIES) {
    if(room===library)return {library,index:1,id:room};
    const m=new RegExp(`^${library}-((?:[2-9]|[1-9][0-9]+))$`).exec(room);
    if(m&&Number.isSafeInteger(Number(m[1]))&&Number(m[1])<=MAX_AUTO_ROOM_INDEX)
      return {library,index:Number(m[1]),id:room};
  }
  return null;
}
export function roomForIndex(library,index){
  if(!LIBRARIES.includes(library)||!Number.isInteger(index)||index<1||index>MAX_AUTO_ROOM_INDEX)throw new RangeError('Invalid public room index');
  return index===1?library:`${library}-${index}`;
}
export const roomCapacity = room => {
  const parsed=parsedPublicRoom(room);
  return !parsed?64:parsed.index===1?PUBLIC_CAPACITY.primary:PUBLIC_CAPACITY.overflow;
};
export function workerForRoom(room,workerCount){
  if(!Number.isInteger(workerCount)||workerCount<1||workerCount>32)throw new RangeError('Invalid number of workers');
  const parsed=parsedPublicRoom(room);
  if(parsed){const offset=LIBRARIES.indexOf(parsed.library);return (parsed.index-1+offset)%workerCount;}
  // Consistent private-room hashing. Never use JavaScript's randomized hashing.
  let h=2166136261;
  for(const ch of String(room)){h=Math.imul(h^ch.charCodeAt(0),16777619)>>>0;}
  return h%workerCount;
}
export async function choosePublicRoom(library,countForRooms,{maximum=MAX_AUTO_ROOM_INDEX}={}){
  if(!LIBRARIES.includes(library))throw new RangeError('Invalid library');
  const counts=await countForRooms(library);
  for(let index=1;index<=maximum;index++){
    const id=roomForIndex(library,index);
    if((counts.get(id)||0)<roomCapacity(id))return {room:id,occupied:counts.get(id)||0,capacity:roomCapacity(id)};
  }
  return null;
}
