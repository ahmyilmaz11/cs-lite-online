const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const WORLD = {w: 1800, h: 1100};

const WALLS = [
  {x:180,y:120,w:520,h:55},{x:920,y:100,w:600,h:55},
  {x:120,y:350,w:70,h:520},{x:390,y:280,w:70,h:350},
  {x:680,y:220,w:70,h:320},{x:1020,y:320,w:70,h:520},
  {x:1380,y:250,w:70,h:330},{x:1320,y:790,w:300,h:55},
  {x:300,y:880,w:520,h:55},{x:690,y:590,w:280,h:55},
  {x:180,y:640,w:250,h:55},{x:1370,y:560,w:220,h:55},
  {x:1180,y:160,w:55,h:190},{x:500,y:480,w:210,h:55}
];

const rooms = new Map();

function roomOf(code) {
  if (!rooms.has(code)) rooms.set(code, {
    players: new Map(),
    bullets: [],
    feed: [],
    seq: 1,
    lastActivity: Date.now()
  });
  return rooms.get(code);
}

function cleanName(v) {
  return String(v||'Player').replace(/[<>]/g,'').trim().slice(0,18) || 'Player';
}
function cleanRoom(v) {
  return String(v||'MAIN').replace(/[^a-zA-Z0-9_-]/g,'').toUpperCase().slice(0,12) || 'MAIN';
}
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }

function json(res,status,obj){
  const data=Buffer.from(JSON.stringify(obj));
  res.writeHead(status,{
    'Content-Type':'application/json; charset=utf-8',
    'Content-Length':data.length,
    'Cache-Control':'no-store'
  });
  res.end(data);
}
function text(res,status,body,type='text/plain; charset=utf-8'){
  const data=Buffer.from(body);
  res.writeHead(status,{'Content-Type':type,'Content-Length':data.length});
  res.end(data);
}
function body(req){
  return new Promise((resolve,reject)=>{
    let s='';
    req.on('data',d=>{s+=d;if(s.length>50000) req.destroy();});
    req.on('end',()=>{try{resolve(s?JSON.parse(s):{})}catch(e){reject(e)}});
  });
}
function circleWall(x,y,r=14){
  for(const a of WALLS){
    const cx=Math.max(a.x,Math.min(x,a.x+a.w));
    const cy=Math.max(a.y,Math.min(y,a.y+a.h));
    const dx=x-cx,dy=y-cy;
    if(dx*dx+dy*dy<r*r)return true;
  }
  return false;
}
function spawn(room,team){
  const list=team==='CT'
    ? [[230,230],[300,1020],[540,1010],[260,520]]
    : [[1610,970],[1600,190],[1260,970],[1650,520]];
  for(let i=0;i<30;i++){
    const b=list[Math.floor(Math.random()*list.length)];
    const x=b[0]+(Math.random()-.5)*70,y=b[1]+(Math.random()-.5)*70;
    if(!circleWall(x,y,16)) return {x,y};
  }
  return {x:250,y:220};
}
function addFeed(room,msg){
  room.feed.push({id:room.seq++,msg,t:Date.now()});
  if(room.feed.length>24) room.feed.shift();
}
function state(room,token){
  const me=room.players.get(token);
  return {
    ok:true,
    ts:Date.now(),
    world:WORLD,
    walls:WALLS,
    me:me?{
      id:me.id,n:me.name,t:me.team,x:Math.round(me.x),y:Math.round(me.y),
      a:+me.angle.toFixed(3),h:me.hp,k:me.kills,d:me.deaths,
      m:me.ammo,r:me.reserve,v:me.alive,resp:me.respawnAt
    }:null,
    p:[...room.players.values()].map(p=>({
      id:p.id,n:p.name,t:p.team,x:Math.round(p.x),y:Math.round(p.y),
      a:+p.angle.toFixed(3),h:p.hp,k:p.kills,d:p.deaths,v:p.alive
    })),
    b:room.bullets.map(b=>({id:b.id,x:Math.round(b.x),y:Math.round(b.y),t:b.team})),
    f:room.feed.slice(-6)
  };
}

function serve(req,res){
  let u=decodeURIComponent(req.url.split('?')[0]);
  if(u==='/')u='/index.html';
  const base=path.join(__dirname,'public');
  const file=path.join(base,u);
  if(!file.startsWith(base))return text(res,403,'Forbidden');
  fs.readFile(file,(e,d)=>{
    if(e)return text(res,404,'Not found');
    const ext=path.extname(file);
    const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'}[ext]||'application/octet-stream';
    res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-cache'});
    res.end(d);
  });
}

const server=http.createServer(async(req,res)=>{
  try{
    if(req.method==='GET'&&req.url.startsWith('/api/health')) return json(res,200,{ok:true,rooms:rooms.size});

    if(req.method==='POST'&&req.url.startsWith('/api/join')){
      const b=await body(req), code=cleanRoom(b.room), room=roomOf(code);
      const ct=[...room.players.values()].filter(x=>x.team==='CT').length;
      const tt=[...room.players.values()].filter(x=>x.team==='T').length;
      const team=ct<=tt?'CT':'T', pos=spawn(room,team), token=crypto.randomBytes(16).toString('hex');
      const p={
        id:crypto.randomBytes(5).toString('hex'),name:cleanName(b.name),team,
        x:pos.x,y:pos.y,angle:0,hp:100,kills:0,deaths:0,ammo:30,reserve:90,
        alive:true,respawnAt:0,lastSeen:Date.now(),lastMove:Date.now(),lastShot:0
      };
      room.players.set(token,p);room.lastActivity=Date.now();
      addFeed(room,`${p.name} joined ${team}`);
      return json(res,200,{ok:true,token,room:code,team});
    }

    if(req.method==='POST'&&req.url.startsWith('/api/u')){
      const b=await body(req), room=roomOf(cleanRoom(b.room)), p=room.players.get(String(b.token||''));
      if(!p)return json(res,401,{ok:false});
      const now=Date.now(); p.lastSeen=now;room.lastActivity=now;
      if(p.alive){
        const nx=clamp(Number(b.x)||p.x,16,WORLD.w-16),ny=clamp(Number(b.y)||p.y,16,WORLD.h-16);
        const dt=Math.max(.06,Math.min(1,(now-p.lastMove)/1000)), max=270*dt+34;
        if(Math.hypot(nx-p.x,ny-p.y)<=max&&!circleWall(nx,ny,16)){p.x=nx;p.y=ny;}
        if(Number.isFinite(Number(b.a)))p.angle=Number(b.a);
        p.lastMove=now;
      }
      return json(res,200,{ok:true});
    }

    if(req.method==='POST'&&req.url.startsWith('/api/fire')){
      const b=await body(req),room=roomOf(cleanRoom(b.room)),p=room.players.get(String(b.token||''));
      if(!p)return json(res,401,{ok:false});
      const now=Date.now();p.lastSeen=now;
      if(!p.alive||p.ammo<=0||now-p.lastShot<125)return json(res,200,{ok:false});
      p.lastShot=now;p.ammo--;
      const a=(Number.isFinite(Number(b.a))?Number(b.a):p.angle)+(Math.random()-.5)*.028;
      const sp=1250;
      room.bullets.push({
        id:room.seq++,owner:p.id,team:p.team,x:p.x+Math.cos(a)*24,y:p.y+Math.sin(a)*24,
        vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:1.8
      });
      return json(res,200,{ok:true,m:p.ammo});
    }

    if(req.method==='POST'&&req.url.startsWith('/api/reload')){
      const b=await body(req),room=roomOf(cleanRoom(b.room)),p=room.players.get(String(b.token||''));
      if(!p)return json(res,401,{ok:false});
      if(!p.alive||p.ammo>=30||p.reserve<=0)return json(res,200,{ok:false});
      const n=Math.min(30-p.ammo,p.reserve);p.ammo+=n;p.reserve-=n;
      return json(res,200,{ok:true,m:p.ammo,r:p.reserve});
    }

    if(req.method==='GET'&&req.url.startsWith('/api/s')){
      const u=new URL(req.url,'http://x');
      const room=roomOf(cleanRoom(u.searchParams.get('room'))),token=u.searchParams.get('token')||'';
      const p=room.players.get(token);
      if(!p)return json(res,401,{ok:false});
      p.lastSeen=Date.now();room.lastActivity=Date.now();
      return json(res,200,state(room,token));
    }

    return serve(req,res);
  }catch(e){
    console.error(e);return json(res,500,{ok:false});
  }
});

setInterval(()=>{
  const now=Date.now(),dt=.02;
  for(const [code,room] of rooms){
    for(const p of room.players.values()){
      if(!p.alive&&p.respawnAt&&now>=p.respawnAt){
        const s=spawn(room,p.team);
        p.x=s.x;p.y=s.y;p.hp=100;p.ammo=30;p.reserve=90;p.alive=true;p.respawnAt=0;
      }
    }
    for(const b of room.bullets){
      const ox=b.x,oy=b.y;
      b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;
      if(b.life<=0||b.x<0||b.x>WORLD.w||b.y<0||b.y>WORLD.h||circleWall(b.x,b.y,2)){b.life=0;continue;}
      for(const p of room.players.values()){
        if(!p.alive||p.id===b.owner||p.team===b.team)continue;
        const vx=b.x-ox,vy=b.y-oy,wx=p.x-ox,wy=p.y-oy,vv=vx*vx+vy*vy||1;
        let t=(wx*vx+wy*vy)/vv;t=Math.max(0,Math.min(1,t));
        if(Math.hypot(p.x-(ox+t*vx),p.y-(oy+t*vy))<16){
          p.hp-=34;b.life=0;
          if(p.hp<=0){
            p.hp=0;p.alive=false;p.deaths++;p.respawnAt=now+1800;
            const killer=[...room.players.values()].find(x=>x.id===b.owner);
            if(killer){killer.kills++;addFeed(room,`${killer.name} → ${p.name}`);}
          }
          break;
        }
      }
    }
    room.bullets=room.bullets.filter(b=>b.life>0);
    for(const [token,p] of room.players){
      if(now-p.lastSeen>18000){room.players.delete(token);addFeed(room,`${p.name} left`);}
    }
    room.feed=room.feed.filter(x=>now-x.t<16000);
    if(room.players.size===0&&now-room.lastActivity>60000)rooms.delete(code);
  }
},20);

server.listen(PORT,()=>console.log('CS Lite V2 on',PORT));
