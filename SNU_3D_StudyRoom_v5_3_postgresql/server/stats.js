import {koreaDay} from './room.js';
const DAY=86400000;
const parse=d=>Date.parse(d+'T00:00:00Z');
const shifted=(day,offset)=>new Date(parse(day)+offset*DAY).toISOString().slice(0,10);
const formatMonth=d=>d.slice(0,7);
const kstNow=()=>koreaDay();
export function buildStats(records,month=kstNow().slice(0,7),today=kstNow(),rankingPublic=true){
  const days=new Map(records.map(({day,ms})=>[day,Math.max(0,Number(ms)||0)]));
  const total=d=>days.get(d)||0;
  const yesterday=shifted(today,-1);
  const dow=new Date(parse(today)).getUTCDay();
  const monday=shifted(today,-((dow+6)%7));
  let weekMs=0,monthMs=0,totalMs=0;
  for(const [day,ms] of days){totalMs+=ms;if(day>=monday&&day<=today)weekMs+=ms;
    if(day.startsWith(today.slice(0,7)))monthMs+=ms;}
  let streak=0,ref=total(today)>0?today:yesterday;
  while(total(ref)>0){streak++;ref=shifted(ref,-1);if(streak>36500)break;}
  const [year,mon]=month.split('-').map(Number);
  const first=`${year}-${String(mon).padStart(2,'0')}-01`;
  const start=shifted(first,-((new Date(parse(first)).getUTCDay()+6)%7));
  const calendar=Array.from({length:42},(_,i)=>{const day=shifted(start,i);return {day,ms:total(day),inMonth:day.startsWith(month),future:day>today};});
  const last7=Array.from({length:7},(_,i)=>{const day=shifted(today,i-6);return {day,ms:total(day)};});
  return {day:today,month,todayMs:total(today),yesterdayMs:total(yesterday),weekMs,monthMs,totalMs,streak,calendar,last7,rankingPublic};
}
export function buildRanking(rows,userId,day,limit=20,offset=0){
  const sorted=rows.slice().sort((a,b)=>b.ms-a.ms||a.id.localeCompare(b.id));
  const myIdx=sorted.findIndex(r=>r.id===userId);
  const start=Math.max(0,Math.min(10000,offset));
  const pageSize=Math.max(1,Math.min(100,limit));
  return {day,count:sorted.length,offset:start,limit:pageSize,hasMore:start+pageSize<sorted.length,myRank:myIdx<0?null:myIdx+1,
    myStudyMs:myIdx<0?null:sorted[myIdx].ms,
    entries:sorted.slice(start,start+pageSize).map((v,i)=>({...v,rank:start+i+1,isMe:v.id===userId}))};
}
export function validMonth(s){return typeof s==='string'&&/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(s);}
