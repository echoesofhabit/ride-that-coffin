const downhillBaseSpeed=5.5;
// World positions use the supplied model's coordinate system: Y up, Z toward the bedroom.
const clamp=(v,l,h)=>Math.min(h,Math.max(l,v));
const lerp=(a,b,x)=>a+(b-a)*x;
function samplePath(builder) {
 const points=[];
 function add(x,z,dx=0,dz=0){
  const prev=points.at(-1);
  const length=Math.hypot(dx,dz)||1;
  points.push({x,z,dx:dx/length,dz:dz/length,s:prev?prev.s+Math.hypot(x-prev.x,z-prev.z):0});
 }
 function line(x,z){
  const p=points.at(-1);if(!p){add(x,z);return;}
  const dx=x-p.x,dz=z-p.z,length=Math.hypot(dx,dz);
  if(!length)return;
  if(points.length===1){p.dx=dx/length;p.dz=dz/length;}
  const n=Math.ceil(length/.20);
  for(let i=1;i<=n;i++)add(lerp(p.x,x,i/n),lerp(p.z,z,i/n),dx,dz);
 }
 function bend(cx,cz,x,z,round){
  const p=points.at(-1);
  const ax=cx-p.x,az=cz-p.z,bx=x-cx,bz=z-cz;
  for(let i=1;i<=28;i++){
   const t=i/28,a=1-t;
   if(round){
    const angle=t*Math.PI/2,c=Math.cos(angle),s=Math.sin(angle);
    add(p.x+ax*s+bx*(1-c),p.z+az*s+bz*(1-c),ax*c+bx*s,az*c+bz*s);
   }else{
    add(a*a*p.x+2*a*t*cx+t*t*x,a*a*p.z+2*a*t*cz+t*t*z,a*ax+t*bx,a*az+t*bz);
   }
  }
 }
 builder(line,bend);return points;
}
function lapForGate(gate){return Math.ceil(gate/2);}
function budgetTicks(gate){
 const lap=lapForGate(gate);
 if(lap===1)return 16*60;
 if(lap===2)return 13.5*60;
 const tenths=Math.max(10,113-(lap-3)*6);
 return tenths*6;
}
function driftSpeedPercent(points){
 return Math.floor(points/400)*3;
}
function pushUphill(s,side){
 if(s.over || s.spin>0 || routeAt(s,s.d).terrain!=='up' || side===s.last)return false;
 s.last=side;s.age=0;s.boost=Math.min(2.5,s.boost+.65);
 return true;
}
function initial(bestLap=null,seed=(Math.random()*4294967296)>>>0){const course=newCourse(seed);return {course,nextLine:course.current.stripe,raceTicks:0,lapStart:null,completed:0,bestLap,lastLap:null,splits:[],splitDelta:null,timeLeft:budgetTicks(1),d:0,lane:0,velocity:0,yaw:0,slip:0,edgeRate:0,edgeBank:0,fallSide:1,controlTime:0,spinBrake:2.15,spin:0,spinSign:1,spinStartYaw:0,points:0,vaseTicks:0,vaseEvents:[],lampCue:false,gate:1,speed:0,boost:0,last:0,age:3,drift:false,terrain:'floor',over:false,wall:false};}
const dt=1/60;
const bodyCorners=[[-.31,-1.25],[.31,-1.25],[.55,-.66],[.265,1.25],[-.265,1.25],[-.55,-.66]];
// A full timed lap always starts at the same physical line, beyond the bedroom approach.
function recordTiming(s,from,to){
 const crossing=distance=>s.raceTicks-1+(distance-from)/(to-from);
 const line=s.nextLine;
 if(line!==null && from<line && line<=to){
  s.nextLine=null;
  const at=crossing(line);
  if(s.lapStart!==null){
   const ticks=at-s.lapStart;
   const delta=s.bestLap?ticks-s.bestLap.ticks:null;
   s.completed++;
   s.lastLap={number:s.completed,ticks,delta};
   if(delta===null || delta<0)s.bestLap={ticks,splits:s.splits.slice()};
  }
  s.lapStart=at;
  s.splits=[];
  s.splitDelta=null;
 }
 const door=gateDistance(s);
 if(s.lapStart!==null && from<door && door<=to){
  const split=crossing(door)-s.lapStart;
  const reference=s.bestLap?.splits[s.splits.length];
  s.splitDelta=reference===undefined?null:split-reference;
  s.splits.push(split);
 }
}
function startSpin(s,sign){
 s.spin=3;s.spinSign=sign;s.spinStartYaw=s.yaw;s.spinBrake=Math.max(2.15,s.speed/2.30);
 s.controlTime=0;s.drift=false;
}
function advance(s,input){
 if(s.over)return;
 s.lampCue=false;
 const r=routeAt(s,s.d),next=routeAt(s,s.d+.7),curvature=(r.dz*next.dx-r.dx*next.dz)/.7;
 if(r.terrain!=='up'){s.last=0;}
 const enteringDescent=r.terrain==='down' && s.terrain!=='down';
 if(enteringDescent){
  s.fallSide=Math.abs(s.slip)>.12?Math.sign(s.slip):(lapForGate(s.gate)%2?1:-1);
  s.edgeRate=.39*s.fallSide+s.velocity*.22;
 }
 s.controlTime=Math.max(0,s.controlTime-dt);
 s.terrain=r.terrain;s.drift=false;s.wall=false;s.age+=dt;
 if(s.spin>0){
  s.spin=Math.max(0,s.spin-dt);s.speed=Math.max(0,s.speed-dt*s.spinBrake);s.velocity*=.96;
  const u=1-s.spin/3;s.yaw=s.spinStartYaw*(1-u)+s.spinSign*Math.PI*4*(1-(1-u)**2);
  if(s.spin===0){s.yaw=0;s.slip=0;s.velocity=0;s.edgeRate=0;}
 }else{
  const up=r.terrain==='up',down=r.terrain==='down';
  s.boost=up?Math.max(0,s.boost-.43*dt):0;
  // A controlled slide in the direction of a bend carries speed through its exit.
  const bend=clamp(Math.abs(curvature)*2.8,0,1);
  const matchedSlide=clamp(-Math.sign(curvature)*s.slip/.60,0,1);
  const cornerSpeed=2.82+bend*(1.15*matchedSlide-.65);
  const base=up?1.18+s.boost:down?downhillBaseSpeed:cornerSpeed;
  const vaseDash=s.vaseTicks>0;
  s.vaseTicks=Math.max(0,s.vaseTicks-1);
  const pace=(vaseDash?Math.max(base,downhillBaseSpeed):base);
  const fast=pace*1.12*(1+driftSpeedPercent(s.points)/100);
  s.speed+=(fast-s.speed)*dt*2.1;
  if(vaseDash)s.speed=Math.max(s.speed,fast);
  // Body heading swings first; lateral travel follows with inertia.
  if(up)s.slip=lerp(s.slip,s.last*.34*Math.exp(-s.age*6),.22);
  else if(down){
   // Momentum persists on the stairs. An opposing edge checks the rotation;
   // holding that edge too long starts a slide the other way.
   const gradePosition=clamp(r.progress,0,1);
   const crossSlope=s.fallSide*(1.65+1.15*Math.cos(gradePosition*Math.PI*1.5));
   const leverage=7.0*input;
   const torque=crossSlope + s.slip*(1.12+.10*s.speed) + leverage - .96*s.edgeRate;
   s.edgeRate=clamp(s.edgeRate+torque*dt,-3.8,3.8);
   s.slip+=s.edgeRate*dt;
   if(input!==0&&input*(s.slip+.22*s.edgeRate)<-.10)s.controlTime=.7;
  }
  else if(input)s.slip+=input*dt*.82;
  else s.slip*=Math.exp(-dt*2.95);
  if(!up&&Math.abs(s.slip)>=1.10)startSpin(s,Math.sign(s.slip));
  else {
   s.yaw=lerp(s.yaw,s.slip*(up?.88:1.13),.14);
   const sideSpeed=up?.65:down?s.speed*.66:1.8*(vaseDash?2.6:1);
   s.velocity=lerp(s.velocity,Math.sin(s.slip)*sideSpeed+curvature*.46,down?.025:.038);
   s.drift=!up&&Math.abs(s.slip)>.19;
   if(s.drift&&(!down||s.controlTime>0))s.points+=dt*(32+125*Math.abs(s.slip))*s.speed/2.82;
  }
 }
 const bank=s.terrain==='down'&&s.spin===0?clamp(-s.slip*.145+input*.075,-.22,.22):0;
 s.edgeBank=lerp(s.edgeBank,bank,.10);
 const breadth=Math.max(...bodyCorners.map(([x,z])=>Math.abs(x*Math.cos(s.yaw)+z*Math.sin(s.yaw))));
 // A projecting nose or tail needs a little extra clearance along the outer arc.
 const edgeClearance=r.sec.roundCorners ? .20 : .04;
 const room=Math.min(steeringRoom(s,r),corridorWidth-breadth-edgeClearance);
 s.lane=clamp(s.lane+s.velocity*dt,-room,room);
 if(Math.abs(s.lane)>room-.02&&Math.sign(s.velocity)===Math.sign(s.lane)){s.velocity*=.81;s.wall=true;}
 const from=s.d;
 s.d=travelOnLane(r,s.d,s.lane,s.speed*dt);s.raceTicks++;
 checkShelves(s);
 advanceChandeliers(s);
 recordTiming(s,from,s.d);
 s.timeLeft=Math.max(0,s.timeLeft-1);
 // Crossing on the last live tick counts. An expired run cannot cross later.
 if(s.d>=gateDistance(s)){
  chooseNext(s.course);
  if(s.course.current.stripe!==null)s.nextLine=s.course.current.stripe;
  s.gate++;
  s.timeLeft=budgetTicks(s.gate);
 }else if(s.timeLeft===0)s.over=true;
}
function pose(s){
 const p=routeAt(s,s.d);
 const courseYaw=Math.atan2(-p.dx,-p.dz);
 const yaw=courseYaw-s.yaw;
 // Keep a sideways coffin's outer corner inside the opening while crossing the sill.
 const gateDist=Math.min(Math.abs(s.d-p.sec.end),p.sec.gate>1?Math.abs(s.d-p.sec.start):Infinity);
 const breadth=Math.max(...bodyCorners.map(([x,z])=>Math.abs(x*Math.cos(s.yaw)+z*Math.sin(s.yaw))));
 const laneAtDoor=clamp(s.lane,breadth-2.035,2.035-breadth);
 const lane=lerp(laneAtDoor,s.lane,clamp((gateDist-1.30)/1.5,0,1));
 const x=p.x-p.dz*lane,z=p.z+p.dx*lane;
 const supportHeight=x=>heightAt(p.sec,x);
 const noseX=x-1.25*Math.sin(yaw),tailX=x+1.25*Math.sin(yaw);
 const pitch=Math.atan2(supportHeight(noseX)-supportHeight(tailX),2.5);
 let y=supportHeight(x)+.030;
 for(const [side,end] of bodyCorners){
  const cornerX=x+side*Math.cos(yaw)+end*Math.cos(pitch)*Math.sin(yaw);
  y=Math.max(y,supportHeight(cornerX)+end*Math.sin(pitch)+.030);
 }
 return {x,z,y:y+.4*Math.abs(Math.sin(s.edgeBank)),heading:courseYaw,yaw,pitch,roll:s.edgeBank,p};
}
function eyeFor(s){
 const p=routeAt(s,s.d);
 const back=routeAt(s,travelOnLane(p,s.d,s.lane,-4.32)),look=routeAt(s,travelOnLane(p,s.d,s.lane,2.25));
 // Track a fixed ground distance behind the coffin on the same line through the zigzag.
 const gateBlend=p.sec.roundCorners?clamp(Math.min(s.d-p.sec.start,p.sec.end-s.d)/4,0,1):0;
 const follow=gateBlend*gateBlend*(3-2*gateBlend);
 const eyeLane=s.lane*lerp(.38,1,follow),lookLane=s.lane*lerp(.58,1,follow);
 const early=Math.max(0,4.32-s.d);
 const ex=back.x-back.dx*early-back.dz*eyeLane,ez=back.z-back.dz*early+back.dx*eyeLane;
 const aimAhead=1-.90*follow,carX=p.x-p.dz*s.lane,carZ=p.z+p.dx*s.lane;
 const tx=lerp(carX,look.x-look.dz*lookLane,aimAhead);
 const tz=lerp(carZ,look.z+look.dx*lookLane,aimAhead);
 const cameraDistance=Math.hypot(ex-carX,ez-carZ);
 const cornerView=clamp(1-back.dx*look.dx-back.dz*look.dz,0,1);
 const focal=1.42*lerp(1,clamp(cameraDistance/(4.32+.65*cornerView),.60,1),follow);
 const grade=(look.y-back.y)/6.57;
 return {eye:[ex,back.y+2.12,ez],yaw:Math.atan2(tx-ex,tz-ez),pitch:-.245+grade*.73,focal};
}
// Console local X faces into the corridor. Shelf and collision share the same footprint.
const shelfDepth=.30,shelfHalfLength=.62,vaseBoostTicks=72;
function furnishSection(sec){
 // The wall-side edge of the console lines up with the inside edge of the stair handrail.
 const shelfOffset=handrailOffset-handrailHalfWidth-shelfDepth;
 const shelves=[];
 for(const [j,leg] of sec.legs.entries()){
  const {a,dx,dz,l}=leg;
  // Allow for the inner wall corner, the swinging coffin tail and the full shelf length.
  const turnClearance=corridorWidth+1.25+shelfHalfLength+1.35;
  const first=j===0?(sec.kind==='start'?4.6:3.25):turnClearance;
  const exitLeg=j===sec.legs.length-1;
  // Short zigzags can use the exit landing. Keep the full corner clearance and the doorway free.
  const shortExit=exitLeg&&!shelves.length&&l-first-3.25<1.10;
  const last=l-(exitLeg?(shortExit?1.85:3.25):turnClearance);
  let runs=[[first,last]];
  if(dx===1)for(const flight of sec.flights){
   const low=flight.x-a.x-1.8,high=low+11.6;
   runs=runs.flatMap(([start,end])=>[[start,Math.min(end,low)],[Math.max(start,high),end]].filter(([p,q])=>q>p));
  }
  for(const [start,end] of runs){
   if(end-start<(shortExit?0:1.10))continue;
   const count=Math.max(1,Math.ceil((end-start)/14)),span=(end-start)/count;
   for(let i=0;i<count;i++)for(const side of [-1,1]){
    const along=start+span*(i+.5)+side*Math.min(1.2,span*.17);
    const x=a.x+dx*along-dz*side*shelfOffset,z=a.z+dz*along+dx*side*shelfOffset;
    shelves.push({x,y:heightAt(sec,x),z,dx,dz,side,yaw:Math.atan2(dx*side,dz*side),broken:false});
   }
  }
 }
 return shelves;
}
function steeringRoom(s,r){
 const sec=r.sec;
 let clearance=Math.min(s.d-sec.start,sec.end-s.d);
 // The rounded driving line follows the inner wall at one corridor half-width.
 // Its hull-width limit already clears both walls all the way around the bend.
 if(!sec.roundCorners)for(let i=1;i<sec.nodes.length-1;i++){
  const c=sec.nodes[i];clearance=Math.min(clearance,Math.hypot(c.x-r.x,c.z-r.z));
 }
 for(const f of sec.flights){
  const stairDistance=Math.max(0,f.x-r.x,r.x-f.x-8);
  clearance=Math.min(clearance,stairDistance);
 }
 const t=clamp((clearance-.8)/2.45,0,1);
 return lerp(1.16,2.50,t*t*(3-2*t));
}
function hitsShelf(car,box){
 // Project the six corners into the console's along/across axes, including a drifting tail.
 const cx=car.x-box.x,cz=car.z-box.z;
 if(Math.abs(cx)>2.1||Math.abs(cz)>2.1||Math.abs(car.y-box.y)>.9)return false;
 const c=Math.cos(car.yaw),s=Math.sin(car.yaw);
 const corners=bodyCorners.map(([side,end])=>{
  const x=cx+side*c+end*s,z=cz-side*s+end*c;
  return [box.dx*x+box.dz*z,-box.dz*x+box.dx*z];
 });
 function separated(nx,nz){
  let lo=Infinity,hi=-Infinity;
  for(const [x,z] of corners){const p=x*nx+z*nz;lo=Math.min(lo,p);hi=Math.max(hi,p);}
  const radius=shelfHalfLength*Math.abs(nx)+shelfDepth*Math.abs(nz);
  return lo>radius||hi< -radius;
 }
 if(separated(1,0)||separated(0,1))return false;
 for(let i=0;i<corners.length;i++){
  const [ax,az]=corners[i],[bx,bz]=corners[(i+1)%corners.length];
  if(separated(bz-az,ax-bx))return false;
 }
 return true;
}
function checkShelves(s){
 const sec=sectionAt(s,s.d);
 s.vaseEvents=s.vaseEvents.filter(event=>s.raceTicks-event.tick<96);
 const centre=pointInSection(sec,s.d);
 if(!sec.shelves.some(v=>!v.broken&&Math.hypot(v.x-centre.x,v.z-centre.z)<4.2))return;
 const car=pose(s);
 for(const vase of sec.shelves){
  if(vase.broken||!hitsShelf(car,vase))continue;
  vase.broken=true;
  s.vaseEvents.push({...vase,tick:s.raceTicks});
  s.vaseTicks=vaseBoostTicks;
 }
}
// The supplied recording starts with bright pings and has its first heavy impact at 1.10 s.
const releaseTick=26,impactTick=66,lampBottom=1.11;
const straightLampLanes=[0,-1.72,1.72];
function mountedLamp(sec,leg,along,d,lane,side){
 const x=leg.a.x+leg.dx*along-leg.dz*lane,z=leg.a.z+leg.dz*along+leg.dx*lane;
 return {x,z,d,side,lane,dx:leg.dx,dz:leg.dz,floor:heightAt(sec,x,true)+.019,ceiling:heightAt(sec,x)+wallHeight,
  warnedAt:null,hit:false,passed:false};
}
function hangChandeliers(sec){
 if(sec.kind==='straight'){
  const leg=sec.legs[0];
  return [.38,.85].flatMap(fraction=>{
   const along=leg.l*fraction;
   return straightLampLanes.map(lane=>mountedLamp(sec,leg,along,sec.start+along,lane,Math.sign(lane)||sec.side));
  });
 }
 const lamps=[];
 for(const [i,leg] of sec.legs.entries()){
  if(leg.l<=8)continue;
  const start=sec.kind==='start'&&i===0?1.24:0;
  const along=(start+leg.l)/2+(start?1:0);
  const cx=leg.a.x+leg.dx*along,cz=leg.a.z+leg.dz*along;
  let closest=sec.path[0],best=Infinity;
  for(const p of sec.path){
   const distance=(p.x-cx)**2+(p.z-cz)**2;
   if(distance<best){best=distance;closest=p;}
  }
  const d=sec.start+closest.s+(cx-closest.x)*leg.dx+(cz-closest.z)*leg.dz;
  const onStairs=sec.flights.some(f=>cx>=f.x-.75&&cx<=f.x+8.75);
  const side=(sec.gate+i)%2?1:-1;
  let lane=side*1.48;
  if(sec.kind==='start')lane=i===0?-.12:1.56;
  else if(!onStairs&&leg.l>16&&sec.gate%3===0)lane=0;
  lamps.push(mountedLamp(sec,leg,along,d,lane,side));
 }
 return lamps;
}
function lampPose(lamp,tick){
 if(lamp.warnedAt===null)return {y:lamp.ceiling,roll:0};
 const age=tick-lamp.warnedAt,fall=clamp((age-releaseTick)/(impactTick-releaseTick),0,1);
 const after=Math.max(0,(age-impactTick)/60);
 const bounce=Math.max(0,1-after/.32)*Math.abs(Math.sin(after*20))*.10;
 const roll=lamp.side*((1-fall)*.055*Math.sin(age*.26)+fall*.12+bounce*.62);
 return {y:lerp(lamp.ceiling,lamp.floor+lampBottom,fall*fall)+bounce,roll};
}
function diskTouchesHull(x,z,radius){
 // Horizontal circle against the actual six-sided footprint, in coffin coordinates.
 let inside=true,near=false;
 for(let i=0;i<bodyCorners.length;i++){
  const [ax,az]=bodyCorners[i],[bx,bz]=bodyCorners[(i+1)%bodyCorners.length];
  const dx=bx-ax,dz=bz-az;
  if(dx*(z-az)-dz*(x-ax)<0)inside=false;
  const t=clamp(((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz),0,1);
  if((x-ax-t*dx)**2+(z-az-t*dz)**2<=radius*radius)near=true;
 }
 return inside||near;
}
// Approximate the six curved brass arms, candle cups and stem separately. Air between arms is clear.
function chandelierFittings(){
 const parts=[[0,0,-1.11,-.78,.108],[0,0,-.78,-.12,.044]];
 for(let arm=0;arm<6;arm++){
  const dx=Math.cos(arm*Math.PI/3),dz=Math.sin(arm*Math.PI/3);
  for(let i=0;i<=6;i++){
   const t=i/6,r=.08+.51*t;
   const y=-.98+.08*Math.sin(Math.PI*2*t)-.07*Math.sin(Math.PI*t)+.16*t**4;
   parts.push([dx*r,dz*r,y-.034,y+.034,.061]);
  }
  parts.push([dx*.59,dz*.59,-.85,-.755,.079],[dx*.59,dz*.59,-.76,-.425,.026]);
 }
 return parts;
}
const lampParts=chandelierFittings();
function lampTouchesCar(lamp,hanging,car){
 if(hanging.y-1.19>car.y+1.08||Math.hypot(lamp.x-car.x,lamp.z-car.z)>2.14)return false;
 const cy=Math.cos(car.yaw),sy=Math.sin(car.yaw),ct=Math.cos(hanging.roll),st=Math.sin(hanging.roll);
 for(const [px,pz,bottom,top,radius] of lampParts){
  const dx=lamp.x-car.x+px*ct-(bottom+top)*.5*st,dz=lamp.z-car.z+pz;
  const x=cy*dx-sy*dz,z=sy*dx+cy*dz;
  const low=hanging.y+bottom*ct+px*st-radius*Math.abs(st);
  const high=hanging.y+top*ct+px*st+radius*Math.abs(st);
  const hullY=car.y-clamp(z,-1.25,1.25)*Math.sin(car.pitch)+clamp(x,-.55,.55)*Math.sin(car.roll);
  if(high<hullY||low>hullY+.82)continue;
  if(low<=hullY+.48&&diskTouchesHull(x,z,radius))return true;
  if(high>=hullY+.46 && x*x+(z+.76)**2<(radius+.17)**2)return true;
 }
 return false;
}
function advanceChandeliers(s){
 const sec=s.course.current;
 if(sec.kind!=='straight'||sec.nextLampIndex>=sec.lamps.length)return;
 const first=sec.nextLampIndex,ahead=sec.lamps[first].d-s.d;
 if(ahead < -2.2){
  for(let i=first;i<first+straightLampLanes.length;i++){
   const lamp=sec.lamps[i];
   if(!lamp.hit)lamp.passed=true;
  }
  sec.nextLampIndex+=straightLampLanes.length;
  return;
 }
 const row=sec.lamps.slice(first,first+straightLampLanes.length);
 let lamp=row.find(fixture=>fixture.warnedAt!==null);
 if(!lamp){
  // Select a fixed ceiling mount on the chime. Steering after the cue never moves its landing spot.
  // Once inside warning range the trigger stays armed, even after a vase boost
  // or a spin. Fast entries can use the full approach from the doorway.
  const entryMargin=clamp(row[0].d-sec.start-s.speed*2.2,0,1.5);
  if(s.d<sec.start+entryMargin||ahead>Math.max(12.8,s.speed*3.0+1.4))return;
  lamp=row.reduce((best,fixture)=>Math.abs(s.lane-fixture.lane)<Math.abs(s.lane-best.lane)?fixture:best);
  lamp.warnedAt=s.raceTicks;s.lampCue=true;
 }
 if(lamp.hit||ahead>2.2||s.raceTicks-lamp.warnedAt<=releaseTick)return;
 if(lampTouchesCar(lamp,lampPose(lamp,s.raceTicks),pose(s))){
  lamp.hit=true;
  if(!s.spin)startSpin(s,Math.sign(s.lane)||lamp.side);
 }
}
function lampWarningStrength(lamp,tick){
 if(lamp.warnedAt===null||lamp.hit||lamp.passed)return 0;
 const age=tick-lamp.warnedAt;
 return (.80+.20*Math.cos(age*.18))*Math.min(1,(age+1)/6);
}
function lampMarks(sections,tick){
 const marks=[];
 for(const sec of sections)for(const lamp of sec.lamps){
  const strength=lampWarningStrength(lamp,tick);
  if(strength)marks.push(lamp.x,lamp.floor,lamp.z,strength);
 }
 const two=marks.slice(-8);return new Float32Array([...two,...Array(8-two.length).fill(0)]);
}
// Orthogonal architectural plans. Only the vehicle's line is eased through an intersection.
const corridorWidth=3.14,wallHeight=4.75,cornerInset=2.15,stepRun=.40,stepRise=.18;
const handrailOffset=2.28,handrailHalfWidth=.088;
const layouts={
 start:[[0,-1.76],[0,-15.3],[24,-15.3]],
 crank:[[0,0],[12,0],[12,10],[26,10]],
 esses:[[0,0],[7,0],[7,6.8],[16,6.8],[16,0],[24.4,0]],
 stairs:[[0,0],[6.8,0],[6.8,7.2],[29.2,7.2]],
 straight:[[0,0],[35.2,0]],
 stairGallery:[[0,0],[35.2,0]]
};
function planSection(kind,side,origin,base,grade,start,gate){
 const nodes=layouts[kind].map(([x,z])=>({x:origin.x+x,z:origin.z+side*z}));
 const legs=nodes.slice(1).map((b,i)=>{
  const a=nodes[i],l=Math.hypot(b.x-a.x,b.z-a.z);
  return {a,b,dx:(b.x-a.x)/l,dz:(b.z-a.z)/l,l};
 });
 const roundCorners=kind==='crank'||kind==='esses';
 const inset=roundCorners?corridorWidth:cornerInset;
 const path=samplePath((line,bend)=>{
  line(nodes[0].x,nodes[0].z);
  for(let j=1;j<nodes.length-1;j++){
   const a=nodes[j],p=legs[j-1],q=legs[j];
   line(a.x-p.dx*inset,a.z-p.dz*inset);
   bend(a.x,a.z,a.x+q.dx*inset,a.z+q.dz*inset,roundCorners);
  }
  const end=nodes.at(-1);line(end.x,end.z);
 });
 if(roundCorners){
  for(let i=0;i<path.length-1;i++){
   const a=path[i],b=path[i+1];
   const turn=Math.atan2(a.dx*b.dz-a.dz*b.dx,a.dx*b.dx+a.dz*b.dz);
   a.curvature=turn/(b.s-a.s);
  }
 }
 const flightX=origin.x+(kind==='start'?10.2:kind==='stairGallery'?5.2:12);
 const flights=grade?[{x:flightX,grade}]:[];
 if(kind==='stairGallery')flights.push({x:origin.x+20.4,grade:-grade});
 const end=start+path.at(-1).s;
 const sec={kind,side,nodes,legs,path,roundCorners,base,grade,flightX,flights,start,end,gate,
  stripe:gate%2===1?start+(kind==='start'?path.at(-1).s-(nodes.at(-1).x-2.8):16.0):null};
 sec.shelves=furnishSection(sec);
 sec.lamps=hangChandeliers(sec);
 sec.nextLampIndex=0;
 return sec;
}
function newCourse(seed){
 const first=planSection('start',1,{x:0,z:0},0,-1,0,1);
 return {seed:seed>>>0,previous:null,current:first,bag:[],lastLayout:'',lastGate:null};
}
function randomUnit(course){
 course.seed=(Math.imul(course.seed,1664525)+1013904223)>>>0;
 return course.seed/4294967296;
}
function chooseNext(course){
 if(!course.bag.length){
  const bag=['crank','esses','up','down','straight','stairGallery'];
  for(let i=bag.length-1;i>0;i--){const j=Math.floor(randomUnit(course)*(i+1));[bag[i],bag[j]]=[bag[j],bag[i]];}
  if(bag.at(-1)===course.lastLayout){const last=bag.length-1;[bag[0],bag[last]]=[bag[last],bag[0]];}
  course.bag=bag;
 }
 const choice=course.bag.pop(),prev=course.current,end=prev.nodes.at(-1),base=heightAt(prev,end.x);
 const stairs=choice==='up'||choice==='down';
 const direction=choice==='stairGallery'?(randomUnit(course)<.5?-1:1):choice==='up'?1:-1;
 const grade=stairs||choice==='stairGallery'?(base<=-7?1:base>=3?-1:direction):0;
 course.lastLayout=choice;
 course.previous=prev;
 course.lastGate={x:end.x,y:base,z:end.z,dx:1,dz:0};
 course.current=planSection(stairs?'stairs':choice,randomUnit(course)<.5?-1:1,end,base,grade,prev.end,prev.gate+1);
}
function heightAt(sec,x,stepped=false){
 let y=sec.base;
 for(const flight of sec.flights){
  const steps=clamp((x-flight.x)/stepRun,0,20);
  y+=flight.grade*stepRise*(stepped?(flight.grade<0?Math.ceil(steps-1e-6):Math.floor(steps+1e-6)):steps);
 }
 return y;
}
function sectionAt(s,d){
 return s.course.previous&&d<s.course.current.start?s.course.previous:s.course.current;
}
function routeAt(s,d){
 return pointInSection(sectionAt(s,d),d);
}
function pointInSection(sec,d){
 const a=sec.path,u=clamp(d-sec.start,0,sec.end-sec.start);
 let lo=0,hi=a.length-1;
 while(hi-lo>1){const m=(lo+hi)>>1;if(a[m].s>u)hi=m;else lo=m;}
 const p=a[lo],q=a[hi],l=q.s-p.s,t=clamp((u-p.s)/l,0,1);
 const x=lerp(p.x,q.x,t),z=lerp(p.z,q.z,t);
 const flight=sec.flights.find(f=>x>=f.x&&x<f.x+8);
 const progress=flight?(x-flight.x)/8:0,terrain=flight?(flight.grade>0?'up':'down'):'floor';
 const dx=sec.roundCorners?lerp(p.dx,q.dx,t):q.x-p.x;
 const dz=sec.roundCorners?lerp(p.dz,q.dz,t):q.z-p.z;
 const length=Math.hypot(dx,dz);
 return {x,z,dx:dx/length,dz:dz/length,index:lo,y:heightAt(sec,x),terrain,progress,sec};
}
// Advance by the distance travelled on the selected line through a right-angle hall.
// Across a turn of angle theta, an offset lane is shorter or longer by lane * theta.
function travelOnLane(r,d,lane,meters){
 if(!r.sec.roundCorners||!meters||!lane)return d+meters;
 const path=r.sec.path;
 const dir=Math.sign(meters);
 for(let i=r.index;i>=0&&i<path.length-1;i+=dir){
  const a=path[i],b=path[i+1];
  const scale=1-lane*a.curvature;
  const boundary=r.sec.start+(dir>0?b.s:a.s),available=(boundary-d)*scale;
  if(Math.abs(meters)<=Math.abs(available))return d+meters/scale;
  meters-=available;d=boundary;
 }
 return d+meters;
}
function gateDistance(s){return s.course.current.end-1.20;}
function gatePosition(sec){
 const p=sec.nodes.at(-1);
 return {x:p.x,y:heightAt(sec,p.x),z:p.z,dx:1,dz:0};
}
export {initial, advance, pushUphill, gateDistance};
