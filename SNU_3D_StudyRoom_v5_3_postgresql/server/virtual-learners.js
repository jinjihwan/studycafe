// V7.2: deterministic 144 virtual-learner schedules with varied individual study/rest rhythms.
// Pure calendar calculations, seeded per campus and 06:00 KST operating day.
// Ranking time is the intersection of simulated *study* intervals with today's KST day.
// UI and actual WebSocket seat locks are managed separately by room.js.
import crypto from 'node:crypto';

export const VIRTUAL_CAMPUSES=Object.freeze(['main','korea','yonsei']);
export const VIRTUAL_POPULATION=48;
export const MAX_SIMULTANEOUS=16;
export const KST_OFFSET=9*3600000;
export const DAY_MS=86400000;
export const SLOT_MS=15*60000;
const START_HOUR=6;
const KINDS=Object.freeze(['rabbit','bear','cat','dog']);
const HOODS=Object.freeze(['#8bcaff','#f39bc4','#aaa4dc','#a6ba94','#c8a995','#a9cce1','#a4ddcd','#d2bca8']);
// 144 fixed NPC names, in user-provided order: 48 per library.
export const VIRTUAL_NAMES=Object.freeze({
 "main": Object.freeze([
  "원두", "김하린", "haneul", "오늘은3시간", "아직안잠", "다시시작", "yujin", "서울대지망",
  "지호", "주원", "재수생", "민재", "도현", "익명인간", "minji", "유진이",
  "피곤해", "공부해야됨", "대전고2", "민서", "연세대26", "지우", "하린", "ㅋㅋ",
  "다연이", "종강언제", "고려대가자", "ㄹㅇ", "12시취침", "5분만더", "서아", "이수현",
  "오답중", "ㅇㅅㅇ", "한양대공대", "이지훈", "리나", "08민서", "박서준", "예진",
  "고3", "하이", "혜원이", "miso", "이도현", "하은", "집가고싶다", "전지민"
 ]),
 "korea": Object.freeze([
  "오답노트", "공시생", "성균관대목표", "지민이", "오늘도출석", "서울고3", "수학부터", "최유나",
  "08수험생", "몽실", "김도윤", "sora", "수업끝", "수능끝나면", "보리", "뀨",
  "ㅎㅎ", "박지후", "jun_03", "익명", "내일시험", "퇴근하고공부", "재현", "응",
  "경기고생", "수빈_07", "예은_04", "메로나", "ㅜㅜ", "ㅇㅇ", "아무개", "지민97",
  "책펴자", "말걸지마", "수특푸는중", "기출회독", "한유진", "국어하자", "집보내줘", "김시우",
  "2학년", "08년생", "수민", "일단함", "잘하자", "09지우", "채영", "새벽반"
 ]),
 "yonsei": Object.freeze([
  "서현05", "공부중", "ㄱㅁㅅ", "김지안", "연대가자", "영단어외움", "초코", "제발집중",
  "10수빈", "강민재", "대원외고가자", "15분만", "서영", "suah", "윤지", "정다은",
  "서윤입니다", "soobin", "내일부터", "윤서06", "09고2", "물마시고옴", "studylog", "휘문고",
  "김민서", "다희", "이현서", "이정우", "10고1", "고양이", "서연", "도토리",
  "모의고사", "jiwon", "졸려", "민지민지", "끝나고놀자", "seoyeon", "yunseo", "정우",
  "수학싫어", "ㅁㅁ", "하루", "ㅇㅋ", "나나", "이서윤", "임지우", "오늘도"
 ])
});
export const TARGET_BANDS=Object.freeze([
 [0,3,4,6],[3,6,4,5],[6,9,6,8],[9,12,9,12],
 [12,15,8,11],[15,18,11,14],[18,22,12,16],[22,24,8,11]
]);
const TYPES=[...Array(4).fill('long'),...Array(14).fill('diligent'),...Array(20).fill('regular'),...Array(10).fill('light')];
const WINDOWS=[...Array(8).fill('night'),...Array(10).fill('morning'),...Array(10).fill('midday'),
 ...Array(10).fill('afternoon'),...Array(8).fill('evening'),...Array(2).fill('flex')];
const PREFERRED={night:[18,24],morning:[6,11],midday:[9,16],afternoon:[12,19],evening:[16,24],flex:[6,24]};
const scoreBands=Array.from({length:96},(_,slot)=>{
 const h=(slot/4+START_HOUR)%24;
 const [, ,lo,hi]=TARGET_BANDS.find(([from,to])=>h>=from&&h<to);
 return {lo,hi,goal:(lo+hi)/2};
});
// Ease abrupt changes at exact 03/06/09/12/15/18/22/00 boundaries.
for(const h of [3,6,9,12,15,18,22,0]){
 const index=((h-START_HOUR+24)%24)*4,prev=(index+95)%96;
 const a=scoreBands[prev].goal,b=scoreBands[index].goal;
 scoreBands[prev].goal=a*.65+b*.35;
 scoreBands[index].goal=a*.35+b*.65;
}
const cache=new Map();
const seedFor=(campus,anchor)=>crypto.createHash('sha256').update(`npc-v71:${campus}:${anchor}`).digest().readUInt32LE();
function seeded(seed){return()=>{seed=(seed+0x6D2B79F5)>>>0;let t=Math.imul(seed^(seed>>>15),1|seed);t^=t+Math.imul(t^(t>>>7),61|t);return((t^(t>>>14))>>>0)/4294967296;};}
export function virtualProfile(campus,id){
 if(!VIRTUAL_CAMPUSES.includes(campus)||!Number.isInteger(id)||id<0||id>=VIRTUAL_POPULATION)return null;
 return {id,virtualId:`virtual:${campus}:${String(id).padStart(2,'0')}`,campus,nick:VIRTUAL_NAMES[campus][id],
  species:KINDS[(id+VIRTUAL_CAMPUSES.indexOf(campus))%4],hood:HOODS[(id*3+VIRTUAL_CAMPUSES.indexOf(campus))%HOODS.length]};
}
export const virtualDayStart=ms=>Math.floor((ms+KST_OFFSET)/DAY_MS)*DAY_MS-KST_OFFSET;
export const operatingStart=ms=>{const midnight=virtualDayStart(ms);return midnight+START_HOUR*3600000>ms?midnight-(24-START_HOUR)*3600000:midnight+START_HOUR*3600000;};
const between=(a,min,max)=>Math.max(min,Math.min(a,max));
function triangular(rng,a,mode,b){const u=rng(),p=(mode-a)/(b-a);return u<p?a+Math.sqrt(u*(b-a)*(mode-a)):b-Math.sqrt((1-u)*(b-a)*(b-mode));}
function studyHours(rng,type){if(type==='light')return triangular(rng,.5,1.25,2);
 if(type==='regular')return triangular(rng,2,3.6,5);
 if(type==='diligent')return triangular(rng,5,6.5,8);
 return triangular(rng,8,9,10);
}
function preferencePenalty(slot,kind){
 const hour=(slot/4+START_HOUR)%24,[from,to]=PREFERRED[kind];
 const distance=hour<from?Math.min(from-hour,24-(to-hour)):hour>=to?Math.min(hour-to+.25,24-(hour-from)):0;
 return distance*distance*.9;
}
function cost(c,index){const {lo,hi,goal}=scoreBands[index],d=c-goal;
 return d*d+4*Math.max(0,lo-c)**2+4*Math.max(0,c-hi)**2;
}
function findStart(count,duration,kind,rng){
 let best=null,bestScore=Infinity;
 for(let start=0;start+duration<=96;start++){
  let delta=preferencePenalty(start,kind)+(rng()*.0001),allowed=true;
  for(let slot=start;slot<start+duration;slot++){
    if(count[slot]>=MAX_SIMULTANEOUS){allowed=false;break;}
    delta+=cost(count[slot]+1,slot)-cost(count[slot],slot);
  }
  if(allowed&&delta<bestScore){bestScore=delta;best=start;}
 }
 return best;
}
const add=(count,start,n,delta)=>{for(let i=start;i<start+n;i++)count[i]+=delta;};
// All randomized behavior is derived from the campus, operating day and unique learner.
// It is stable across server restarts and shared by every viewer of a room.
function learnerRng(campus,anchor,id){
 return seeded((seedFor(campus,anchor)^Math.imul(id+1,0x9e3779b1))>>>0);
}
const minute=60000;
function subtractPause(intervals,from,to){
 const clipped=[];
 for(const [a,b] of intervals){
  if(to<=a||from>=b){clipped.push([a,b]);continue;}
  if(a<from)clipped.push([a,Math.min(from,b)]);
  if(to<b)clipped.push([Math.max(to,a),b]);
 }
 return clipped.filter(([a,b])=>b>a);
}
// Study segments are actual chronological intervals rather than synthetic offsets.
// Individuals have different arrival prep, 40-130 minute focus cycles, 4-18 minute
// rests and late-night water/stretch breaks. All times have second-level jitter.
function individualStudy(campus,anchor,id,startMs,endMs){
 const rng=learnerRng(campus,anchor,id);
 const preparedAt=startMs+(2+rng()*10)*minute;
 const finish=endMs-(2+rng()*6)*minute;
 const study=[];
 let cursor=preparedAt;
 while(cursor<finish){
  const focus=(40+rng()*90)*minute;
  const stop=Math.min(finish,cursor+focus);
  if(stop>cursor)study.push([cursor,stop]);
  cursor=stop+(4+rng()*14)*minute;
 }
 // Cross-midnight learners normally take a short staggered late-night break.
 // Its duration and placement are individualized: it genuinely pauses the study
 // clock, preventing dozens of uninterrupted overnight learners from having
 // the exact same elapsed time at 00:49 KST.
 const midnight=anchor+18*3600000;
 if(startMs<midnight-10*minute&&endMs>midnight+25*minute){
  const pauseEnd=midnight+(2+rng()*26)*minute;
  const pauseStart=pauseEnd-(4+rng()*14)*minute;
  return subtractPause(study,pauseStart,pauseEnd);
 }
 return study;
}
export function generateVirtualPlan(campus,operatingAnchor){
 if(!VIRTUAL_CAMPUSES.includes(campus))return {shifts:[],count:Array(96).fill(0),anchor:operatingAnchor};
 if(!Number.isFinite(operatingAnchor))throw new TypeError('Invalid operating day');
 const anchor=operatingStart(operatingAnchor+1000),rng=seeded(seedFor(campus,anchor));
 const candidates=[];
 for(let id=0;id<VIRTUAL_POPULATION;id++){
   if(rng()>=.96)continue;
   const targetStudy=studyHours(rng,TYPES[id]);
   const slots=between(Math.round((targetStudy+Math.max(0,targetStudy-.8)*.14)*4),2,44);
   candidates.push({id,kind:WINDOWS[id],targetStudy,slots});
 }
 candidates.sort((a,b)=>(a.kind==='night'?0:1)-(b.kind==='night'?0:1)||b.slots-a.slots||a.id-b.id);
 const count=Array(96).fill(0),shifts=new Map();
 for(const p of candidates){const start=findStart(count,p.slots,p.kind,rng);if(start===null)continue;
   shifts.set(p.id,{...p,start});add(count,start,p.slots,1);
 }
 // Reassign the same individual budgets, reducing under/over-occupied periods.
 for(let pass=0;pass<3;pass++){
  const order=[...candidates];for(let i=order.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
  let changes=0;
  for(const p of order){const old=shifts.get(p.id);if(!old)continue;add(count,old.start,p.slots,-1);
   const next=findStart(count,p.slots,p.kind,rng)??old.start;
   if(next!==old.start)changes++;
   shifts.set(p.id,{...p,start:next});add(count,next,p.slots,1);
  }
  if(!changes)break;
 }
 const result={campus,anchor,count,shifts:[...shifts.values()].sort((a,b)=>a.id-b.id).map(p=>{
  // Sub-slot arrival and departure do not expand occupancy beyond the booked
  // fifteen-minute slots, so the planned sixteen-person cap remains intact.
  const jitter=learnerRng(campus,anchor,p.id);
  const start=anchor+p.start*SLOT_MS+(10+jitter()*210)*1000;
  const end=anchor+(p.start+p.slots)*SLOT_MS-(10+jitter()*210)*1000;
  return {...p,startMs:start,endMs:end,study:individualStudy(campus,anchor,p.id,start,end)};
 })};
 return result;
}
export function virtualPlan(campus,now=Date.now()){
 const anchor=operatingStart(now),key=campus+':'+anchor;
 if(!cache.has(key)){
  if(cache.size>36)cache.clear();
  cache.set(key,generateVirtualPlan(campus,anchor));
 }
 return cache.get(key);
}
export function virtualPresent(campus,now=Date.now()){
 return virtualPlan(campus,now).shifts.filter(s=>s.startMs<=now&&now<s.endMs);
}
export function virtualStudyMs(campus,id,now=Date.now()){
 const midnight=virtualDayStart(now);
 let total=0;
 for(const anchor of new Set([operatingStart(midnight-1),operatingStart(now)])){
  const plan=virtualPlan(campus,anchor+1);
  for(const shift of plan.shifts){if(shift.id!==id)continue;
   for(const [a,b] of shift.study)total+=Math.max(0,Math.min(now,b)-Math.max(midnight,a));
  }
 }
 // The two operating days can be the same before 06:00: avoid double counting.
 return Math.max(0,total);
}
export function virtualRankingRows(now=Date.now()){
 return VIRTUAL_CAMPUSES.flatMap(campus=>Array.from({length:VIRTUAL_POPULATION},(_,id)=>{
  const ms=virtualStudyMs(campus,id,now);
  if(ms<1000)return null; // Only learners with >= 1 actual second today appear.
  const p=virtualProfile(campus,id);
  return {id:p.virtualId,nick:p.nick,species:p.species,hood:p.hood,ms,virtual:true};
 }).filter(Boolean));
}
