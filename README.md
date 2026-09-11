# CS Lite Online

Ultra-light browser multiplayer tactical shooter.

## Controls
- WASD: movement
- Mouse: aim
- Left click: fire
- R: reload
- TAB: scoreboard

## Multiplayer
Players enter a username and room code. Matching room codes join the same match. Teams auto-balance between CT and T.

## Implemented
- Online rooms
- Usernames
- CT/T auto-balance
- Server-authoritative bullets and damage
- Long visible bullet travel
- Wall collision
- Line-of-sight rendering: opponents are not drawn through walls
- HP, ammo, reload
- K/D scoreboard
- Kill feed
- Death + automatic respawn
- Normal HTTPS requests; no WebSocket/WebRTC
- No WebGL, WebAssembly, CDN or external assets

## Local run
Requires Node.js 18+.

```bash
npm start
```

Then open `http://localhost:3000`.

## Render
This repo includes `render.yaml`. Deploy it as a Render Web Service on the Free plan. The same HTTPS URL serves both the game and multiplayer API.
