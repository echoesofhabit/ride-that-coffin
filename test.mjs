import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import handler from './netlify/functions/ranking.mjs';
import {replay} from './server/replay.mjs';
const html=fs.readFileSync(new URL('./public/index.html',import.meta.url),'utf8');
const game=html.split('const downhillBaseSpeed=')[1].split('const $=id=>')[0];
const ref=vm.createContext({});
vm.runInContext('const downhillBaseSpeed='+game,ref);
const origin='https://example.test';
process.env.SUPABASE_URL='https://mock.invalid';process.env.SUPABASE_SECRET_KEY='unit-test';process.env.RANKING_SECRET='test'.repeat(12);
let clock=1000000;Date.now=()=>clock;
let saved,quota=true;
globalThis.fetch=async(url,opts)=>{
 const data=JSON.parse(opts.body);
 if(url.endsWith('door_board'))return Response.json({top:[],me:null});
 if(url.endsWith('allow'))return Response.json(quota);
 if(url.endsWith('finish'))saved=data;
 return Response.json(null);
};
const req=(op,body,cookie='')=>handler(new Request(origin+'/api/ranking/'+op,{method:'POST',headers:{origin,'content-type':'application/json',cookie},body:JSON.stringify(body)}),{ip:'192.0.2.8'});
const start=await req('start',{});assert.equal(start.status,200);
const {seed,ticket}=await start.json();
const another=await (await req('start',{})).json();assert.notEqual(another.ticket,ticket);
const cookie=start.headers.get('set-cookie').split(';')[0];
const result=vm.runInContext(`(()=>{
 const s=initial(null,${seed});s.speed=2.02;const events=[];
 for(let i=0;i<108000&&!s.over;i++){
  let direction=0;
  const r=routeAt(s,s.d);
  if(r.terrain==='up'){
   direction=Math.floor(i/10)%2?1:-1;
   if(i%10===0&&pushUphill(s,direction))events.push(['push',direction]);
  }else if(r.terrain==='down'){
   const tilt=s.slip+.35*s.edgeRate;direction=Math.abs(tilt)>.23?-Math.sign(tilt):0;
  }else{
   const lamp=r.sec.lamps.find(l=>l.warnedAt!==null&&!l.hit&&!l.passed);
   const target=lamp&&lamp.lane===0?-1.8:0,slip=clamp((target-s.lane-s.velocity*.55)*1.5,-.88,.88);
   direction=Math.abs(slip-s.slip)<.13?0:Math.sign(slip-s.slip);
  }
  if(i===50){events.push(['gap',.7]);s.timeLeft-=.7;s.raceTicks+=.7;}
  advance(s,direction);
  if(events.at(-1)?.[0]===direction)events.at(-1)[1]++;else events.push([direction,1]);
 }
 return {events,doors:s.gate-1,progress:Math.min(99,Math.floor(100*(s.d-(s.course.previous?.end-1.2||0))/(gateDistance(s)-(s.course.previous?.end-1.2||0)))),ticks:s.raceTicks};
})()`,ref);
const expected={doors:result.doors,progress:result.progress};
assert.deepEqual(replay(seed,result.events,result.ticks/60),expected);
assert.equal(replay(seed,result.events.slice(0,-1),1800),null);
assert.equal(replay(seed,[...result.events,[0,1]],1800),null);
assert.deepEqual(replay(seed,[['gap',960]],16),{doors:0,progress:0});
assert.equal(replay(seed,[['gap',961]],17),null);
const submission={nickname:'テスト',ticket,events:result.events,doors:99999,progress:99};
assert.equal((await req('finish',submission,cookie)).status,422);
clock+=Math.ceil(result.ticks/60)*1000;
assert.equal((await req('finish',submission,cookie)).status,200);
assert.equal(saved.p_doors,result.doors);assert.equal(saved.p_progress,result.progress);
assert.equal((await req('finish',{...submission,events:[]},cookie)).status,422);
assert.equal((await req('finish',{...submission,ticket:ticket+'x'},cookie)).status,403);
assert.equal((await req('finish',{...submission,nickname:'<x>'},cookie)).status,400);
assert.equal((await req('finish',submission)).status,400);
assert.equal((await req('finish',{...submission,events:'x'.repeat(180000)},cookie)).status,413);
quota=false;assert.equal((await req('finish',submission,cookie)).status,429);
quota=true;clock+=1800001;assert.equal((await req('finish',submission,cookie)).status,403);
const board=await handler(new Request(origin+'/api/ranking/board'),{ip:'192.0.2.8'});
assert.deepEqual(await board.json(),{top:[],me:null});
console.log('Verified full-game replay with',expected,'and invalid/expired/signed identity, throttling and body-size checks. Database transport mocked.');
