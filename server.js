const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const WORLD = { w: 1200, h: 700 };

const WALLS = [
  {x:120,y:84,w:336,h:39},{x:624,y:70,w:408,h:39},
  {x:96,y:245,w:66,h:280},{x:312,y:196,w:66,h:231},
  {x:504,y:154,w:66,h:196},{x:720,y:224,w:66,h:294},
  {x:936,y:168,w:66,h:196},{x:888,y:476,w:216,h:39},
  {x:240,y:532,w:360,h:39},{x:504,y:385,w:192,h:39},
  {x:144,y:406,w:168,h:39},{x:936,y:350,w:144,h:39}
];

const rooms = new Map();

function roomOf(code) {
  if (!rooms.has(code)) rooms.set(code, {
    players: new Map(),
    bullets: [],
    killfeed: [],
    round: 1,
    lastActivity: Date.now()
  });
  return rooms.get(code);
}

function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store'
  });
  res.end(data);
}

function text(res, status, body, type='text/plain; charset=utf-8') {
  const data = Buffer.from(body);
  res.writeHead(status, {'Content-Type': type, 'Content-Length': data.length});
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', d => {
      s += d;
      if (s.length > 100000) req.destroy();
    });
    req.on('end', () => {
      try { resolve(s ? JSON.parse(s) : {}); }
      catch(e) { reject(e); }
    });
  });
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function circleWall(x,y,r=10) {
  for (const a of WALLS) {
    const cx = Math.max(a.x, Math.min(x, a.x+a.w));
    const cy = Math.max(a.y, Math.min(y, a.y+a.h));
    const dx=x-cx, dy=y-cy;
    if (dx*dx+dy*dy < r*r) return true;
  }
  return false;
}

function spawn(room, team) {
  const starts = team === 'CT'
    ? [[180,140],[210,650],[420,650],[150,620]]
    : [[1040,610],[1040,120],[830,610],[1080,300]];
  for (let i=0;i<20;i++) {
    const p = starts[Math.floor(Math.random()*starts.length)];
    const x = p[0] + (Math.random()-.5)*35;
    const y = p[1] + (Math.random()-.5)*35;
    if (!circleWall(x,y,12)) return {x,y};
  }
  return {x:200,y:150};
}

function cleanName(v) {
  return String(v || 'Player').replace(/[<>]/g,'').trim().slice(0,18) || 'Player';
}
function cleanRoom(v) {
  return String(v || 'MAIN').replace(/[^a-zA-Z0-9_-]/g,'').toUpperCase().slice(0,12) || 'MAIN';
}

function publicState(room, token) {
  const me = room.players.get(token);
  return {
    ok:true,
    world: WORLD,
    walls: WALLS,
    round: room.round,
    me: me ? {
      id:me.id,name:me.name,team:me.team,x:me.x,y:me.y,angle:me.angle,
      hp:me.hp,kills:me.kills,deaths:me.deaths,ammo:me.ammo,reserve:me.reserve,
      alive:me.alive,respawnAt:me.respawnAt
    } : null,
    players:[...room.players.values()].map(p => ({
      id:p.id,name:p.name,team:p.team,x:p.x,y:p.y,angle:p.angle,
      hp:p.hp,kills:p.kills,deaths:p.deaths,alive:p.alive
    })),
    bullets: room.bullets.map(b => ({id:b.id,x:b.x,y:b.y,team:b.team})),
    killfeed: room.killfeed.slice(-6)
  };
}

function addFeed(room, text) {
  room.killfeed.push({text, t:Date.now()});
  if (room.killfeed.length > 20) room.killfeed.shift();
}

function serveStatic(req,res) {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') url = '/index.html';
  const file = path.join(__dirname, 'public', url);
  const base = path.join(__dirname,'public');
  if (!file.startsWith(base)) return text(res,403,'Forbidden');
  fs.readFile(file,(err,data)=>{
    if(err) return text(res,404,'Not found');
    const ext = path.extname(file).toLowerCase();
    const mime = {
      '.html':'text/html; charset=utf-8',
      '.js':'text/javascript; charset=utf-8',
      '.css':'text/css; charset=utf-8',
      '.json':'application/json; charset=utf-8'
    }[ext] || 'application/octet-stream';
    res.writeHead(200, {'Content-Type':mime, 'Cache-Control':'no-cache'});
    res.end(data);
  });
}

const server = http.createServer(async (req,res)=>{
  try {
    if (req.method === 'GET' && req.url.startsWith('/api/health')) {
      return json(res,200,{ok:true,rooms:rooms.size});
    }

    if (req.method === 'POST' && req.url.startsWith('/api/join')) {
      const body = await readBody(req);
      const code = cleanRoom(body.room);
      const room = roomOf(code);
      room.lastActivity = Date.now();

      const ct = [...room.players.values()].filter(p=>p.team==='CT').length;
      const t = [...room.players.values()].filter(p=>p.team==='T').length;
      const team = ct <= t ? 'CT' : 'T';
      const pos = spawn(room, team);
      const token = crypto.randomBytes(16).toString('hex');
      const p = {
        id:crypto.randomBytes(5).toString('hex'),
        token,
        name:cleanName(body.name),
        team,
        x:pos.x,y:pos.y,angle:0,hp:100,kills:0,deaths:0,
        ammo:30,reserve:90,alive:true,respawnAt:0,
        lastSeen:Date.now(),lastShot:0,lastMove:Date.now()
      };
      room.players.set(token,p);
      addFeed(room, `${p.name} joined ${team}`);
      return json(res,200,{ok:true,token,room:code,team});
    }

    if (req.method === 'POST' && req.url.startsWith('/api/update')) {
      const b = await readBody(req);
      const room = roomOf(cleanRoom(b.room));
      const p = room.players.get(String(b.token||''));
      if (!p) return json(res,401,{ok:false,error:'session'});
      p.lastSeen = Date.now(); room.lastActivity = Date.now();

      if (p.alive) {
        const nx = clamp(Number(b.x)||p.x, 12, WORLD.w-12);
        const ny = clamp(Number(b.y)||p.y, 12, WORLD.h-12);
        const now = Date.now();
        const dt = Math.max(0.05, Math.min(1.0, (now-p.lastMove)/1000));
        const maxStep = 260*dt + 30;
        const dx=nx-p.x,dy=ny-p.y,d=Math.hypot(dx,dy);
        if (d <= maxStep && !circleWall(nx,ny,12)) {
          p.x=nx;p.y=ny;
        }
        p.angle = Number.isFinite(Number(b.angle)) ? Number(b.angle) : p.angle;
        p.lastMove = now;
      }

      return json(res,200,{ok:true});
    }

    if (req.method === 'POST' && req.url.startsWith('/api/shoot')) {
      const b = await readBody(req);
      const room = roomOf(cleanRoom(b.room));
      const p = room.players.get(String(b.token||''));
      if (!p) return json(res,401,{ok:false,error:'session'});
      p.lastSeen=Date.now(); room.lastActivity=Date.now();
      const now=Date.now();

      if (!p.alive || p.ammo<=0 || now-p.lastShot < 115) return json(res,200,{ok:false});
      p.lastShot=now;p.ammo--;

      const angle = Number.isFinite(Number(b.angle)) ? Number(b.angle) : p.angle;
      const spread = (Math.random()-.5)*0.035;
      const a = angle + spread;
      const speed = 1100;
      room.bullets.push({
        id:crypto.randomBytes(6).toString('hex'), owner:p.id, team:p.team,
        x:p.x+Math.cos(a)*18, y:p.y+Math.sin(a)*18,
        vx:Math.cos(a)*speed, vy:Math.sin(a)*speed,
        life:1.65
      });

      return json(res,200,{ok:true,ammo:p.ammo});
    }

    if (req.method === 'POST' && req.url.startsWith('/api/reload')) {
      const b = await readBody(req);
      const room = roomOf(cleanRoom(b.room));
      const p = room.players.get(String(b.token||''));
      if (!p) return json(res,401,{ok:false,error:'session'});
      if (!p.alive || p.ammo>=30 || p.reserve<=0) return json(res,200,{ok:false});

      const need=Math.min(30-p.ammo,p.reserve);
      p.reserve-=need;p.ammo+=need;
      return json(res,200,{ok:true,ammo:p.ammo,reserve:p.reserve});
    }

    if (req.method === 'GET' && req.url.startsWith('/api/state')) {
      const u = new URL(req.url, 'http://localhost');
      const room = roomOf(cleanRoom(u.searchParams.get('room')));
      const token = u.searchParams.get('token') || '';
      const p = room.players.get(token);
      if (!p) return json(res,401,{ok:false,error:'session'});
      p.lastSeen=Date.now();room.lastActivity=Date.now();
      return json(res,200,publicState(room,token));
    }

    return serveStatic(req,res);
  } catch(e) {
    console.error(e);
    return json(res,500,{ok:false,error:'server'});
  }
});

setInterval(()=>{
  const now = Date.now();
  for (const [code,room] of rooms) {
    const dt = 0.02;

    for (const p of room.players.values()) {
      if (!p.alive && p.respawnAt && now >= p.respawnAt) {
        const pos = spawn(room,p.team);
        p.x=pos.x;p.y=pos.y;p.hp=100;p.ammo=30;p.reserve=90;p.alive=true;p.respawnAt=0;
      }
    }

    for (const b of room.bullets) {
      const oldx=b.x, oldy=b.y;
      b.x += b.vx*dt; b.y += b.vy*dt; b.life -= dt;
      if (b.life<=0 || b.x<0 || b.x>WORLD.w || b.y<0 || b.y>WORLD.h || circleWall(b.x,b.y,2)) {
        b.life=0; continue;
      }

      for (const p of room.players.values()) {
        if (!p.alive || p.id===b.owner || p.team===b.team) continue;
        const vx=b.x-oldx, vy=b.y-oldy;
        const wx=p.x-oldx, wy=p.y-oldy;
        const vv=vx*vx+vy*vy || 1;
        let t=(wx*vx+wy*vy)/vv;t=Math.max(0,Math.min(1,t));
        const cx=oldx+t*vx, cy=oldy+t*vy;
        if (Math.hypot(p.x-cx,p.y-cy) < 13) {
          p.hp -= 34; b.life=0;
          if (p.hp<=0) {
            p.hp=0;p.alive=false;p.deaths++;p.respawnAt=now+2200;
            const killer=[...room.players.values()].find(x=>x.id===b.owner);
            if (killer) {
              killer.kills++;
              addFeed(room, `${killer.name} → ${p.name}`);
            }
          }
          break;
        }
      }
    }
    room.bullets = room.bullets.filter(b=>b.life>0);

    for (const [token,p] of room.players) {
      if (now-p.lastSeen > 15000) {
        room.players.delete(token);
        addFeed(room, `${p.name} left`);
      }
    }
    room.killfeed = room.killfeed.filter(k=>now-k.t < 15000);

    if (room.players.size===0 && now-room.lastActivity > 60000) rooms.delete(code);
  }
},20);

server.listen(PORT, ()=>console.log(`CS Lite Online running on :${PORT}`));
