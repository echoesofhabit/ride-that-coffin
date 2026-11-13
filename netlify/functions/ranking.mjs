import {createHmac,timingSafeEqual,randomUUID,randomBytes} from 'node:crypto';
import {replay} from '../../server/replay.mjs';
export const config = {path: ['/api/ranking/start','/api/ranking/finish','/api/ranking/board']};
const ttl=30*60;
export default async function handler(req,ctx){
 const url=new URL(req.url),op=url.pathname.split('/').pop();
 const reply=(body,status=200,headers={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store',...headers}});
 const secret=process.env.RANKING_SECRET,db=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;
 if(!secret||secret.length<32||!db||!key)return reply({error:'Ranking unavailable'},503);
 const mac=(tag,v)=>createHmac('sha256',secret).update(tag+'|'+v).digest('base64url');
 function sign(tag,v){return v+'.'+mac(tag,v);}
 function verify(tag,token){
  if(typeof token!=='string'||token.length>1024)return null;
  const [v,s,...rest]=token.split('.');
  const expected=Buffer.from(mac(tag,v)),actual=Buffer.from(s||'');
  return !rest.length&&actual.length===expected.length&&timingSafeEqual(actual,expected)?v:null;
 }
 async function rpc(name,args){
  const headers={apikey:key,'Content-Type':'application/json'};
  if(key.startsWith('eyJ'))headers.Authorization='Bearer '+key;
  const res=await fetch(db.replace(/\/$/,'')+'/rest/v1/rpc/coffin_'+name,{method:'POST',headers,body:JSON.stringify(args),signal:AbortSignal.timeout(8000)});
  if(!res.ok)throw Error('database');const text=await res.text();return text?JSON.parse(text):null;
 }
 try{
  const cookie=(req.headers.get('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('coffin_player='))?.slice(14);
  const player=verify('player',cookie),now=Date.now()/1000;
  if(op==='board'&&req.method==='GET')return reply(await rpc('door_board',{p_player:player}));
  if(!['start','finish'].includes(op)||req.method!=='POST')return reply({},404);
  if(req.headers.get('origin')!==url.origin)return reply({},403);
  const ip=ctx.ip;if(!ip)return reply({},503);
  if(!await rpc('allow',{p_bucket:op+':'+mac('ip',ip),p_limit:op==='start'?25:40}))return reply({error:'Please wait before retrying.'},429);
  if(op==='start'){
   const id=player||randomUUID(),run=randomUUID(),seed=randomBytes(4).readUInt32LE();
   const fields=Buffer.from(JSON.stringify([id,seed,run,now])).toString('base64url');
   return reply({seed,ticket:sign('door-run',fields),expires:(now+ttl)*1000},200,player?{}:{'Set-Cookie':'coffin_player='+sign('player',id)+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=31536000'});
  }
  if(!player||!req.headers.get('content-type')?.includes('application/json'))return reply({},400);
  const reader=req.body?.getReader();if(!reader)return reply({},400);
  const parts=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>180000){await reader.cancel();return reply({},413);}parts.push(value);}
  let data;try{data=JSON.parse(Buffer.concat(parts).toString());}catch{return reply({},400);}
  if(!data||typeof data.nickname!=='string')return reply({},400);
  const name=data.nickname.normalize('NFC').trim();
  if(!/^[\p{L}\p{M}\p{N} _.-]{1,18}$/u.test(name))return reply({error:'Use 1–18 letters, numbers, spaces, dots, dashes or underscores.'},400);
  const raw=verify('door-run',data.ticket);if(!raw)return reply({},403);
  const [id,seed,run,start]=JSON.parse(Buffer.from(raw,'base64url').toString());
  if(id!==player||now-start>ttl)return reply({error:'Run expired.'},403);
  const score=replay(seed,data.events,now-start);
  if(!score)return reply({error:'The completed run could not be verified.'},422);
  await rpc('door_finish',{p_player:id,p_nickname:name,p_doors:score.doors,p_progress:score.progress,p_run:run,p_expires:new Date((start+ttl)*1000).toISOString()});
  return reply(score);
 }catch{return reply({error:'Ranking temporarily unavailable.'},503);}
}
