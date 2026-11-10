/*
 * PITCH ONLINE 서버
 * - public/ 폴더의 게임 파일을 제공합니다.
 * - /ws 웹소켓으로 1:1 실시간 대전 방을 운영합니다. (외부 패키지 없이 동작)
 * - 경기는 서버에서 계산하고(서버 권한 방식) 두 사람에게 상태를 보냅니다.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Sim = require('./public/sim.js');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json'
};

// ---------- 정적 파일 ----------
const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); return res.end(); }
  if (url === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (url === '/') url = '/index.html';
  const fp = path.normalize(path.join(PUB, url));
  if (!fp.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('찾을 수 없어요'); }
    const ext = path.extname(fp).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=600'
    });
    res.end(data);
  });
});

// ---------- 최소 웹소켓 구현 ----------
class Conn {
  constructor(socket) {
    this.s = socket; this.buf = Buffer.alloc(0); this.open = true; this.alive = true; this.h = {};
    socket.on('data', d => this._data(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
  }
  on(ev, fn) { this.h[ev] = fn; }
  _data(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1];
      const op = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (len > 64 * 1024) return this.close();
      const ml = masked ? 4 : 0;
      if (this.buf.length < off + ml + len) return;
      let payload = this.buf.subarray(off + ml, off + ml + len);
      if (masked) {
        const mask = this.buf.subarray(off, off + 4), out = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3];
        payload = out;
      }
      this.buf = this.buf.subarray(off + ml + len);
      if (op === 0x8) return this.close();
      if (op === 0x9) { this._frame(0xA, payload); continue; }
      if (op === 0xA) { this.alive = true; continue; }
      if ((op === 0x1 || op === 0x0) && this.h.message) {
        this.alive = true;
        try { this.h.message(payload.toString('utf8')); } catch (e) { console.error(e); }
      }
    }
  }
  _frame(op, payload) {
    if (!this.open) return;
    const len = payload.length; let head;
    if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
    else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    head[0] = 0x80 | op;
    try { this.s.write(Buffer.concat([head, payload])); } catch (e) { this._closed(); }
  }
  send(obj) { this._frame(0x1, Buffer.from(JSON.stringify(obj))); }
  ping() { this._frame(0x9, Buffer.alloc(0)); }
  close() {
    if (!this.open) return;
    this._frame(0x8, Buffer.alloc(0)); this.open = false;
    try { this.s.end(); } catch (e) {}
    this._closed();
  }
  _closed() {
    if (this.done) return;
    this.done = true; this.open = false;
    try { this.s.destroy(); } catch (e) {}
    if (this.h.close) this.h.close();
  }
}

const conns = new Set();
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') return socket.destroy();
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true);
  const c = new Conn(socket);
  conns.add(c);
  c.room = null; c.side = -1;
  c.on('message', raw => { let m; try { m = JSON.parse(raw); } catch (e) { return; } handle(c, m); });
  c.on('close', () => { conns.delete(c); leave(c); });
});

// 연결 확인 (끊긴 연결 정리)
setInterval(() => {
  for (const c of conns) {
    if (!c.alive) { c.close(); continue; }
    c.alive = false; c.ping();
  }
}, 25000);

// ---------- 방 ----------
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  let code;
  do { code = ''; for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; } while (rooms.has(code));
  return code;
}
const teamIdx = v => { const n = parseInt(v, 10); return n >= 0 && n < Sim.TEAMS.length ? n : 0; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function parseInput(a) {
  if (!Array.isArray(a)) return null;
  return {
    mx: clamp(+a[0] || 0, -1, 1), my: clamp(+a[1] || 0, -1, 1), sp: !!a[2],
    pa: a[3] | 0, lo: a[4] | 0, sw: a[5] | 0, sh: !!a[6]
  };
}

function handle(c, m) {
  const r = c.room;
  switch (m.t) {
    case 'i':
      if (r && r.match && c.side >= 0) r.inputs[c.side] = parseInput(m.i);
      break;
    case 'create': {
      leave(c);
      const dur = [180, 300, 480].includes(m.dur) ? m.dur : 300;
      const room = { code: newCode(), clients: [c, null], teams: [teamIdx(m.team), 0], match: null, inputs: [null, null], rematch: [false, false], dur, endSent: 0 };
      rooms.set(room.code, room);
      c.room = room; c.side = 0;
      c.send({ t: 'created', code: room.code, dur });
      break;
    }
    case 'join': {
      const room = rooms.get(String(m.code || '').trim().toUpperCase());
      if (!room) return c.send({ t: 'error', msg: '방을 찾을 수 없어요. 코드를 확인해 주세요.' });
      if (room.clients[1]) return c.send({ t: 'error', msg: '이미 두 명이 들어간 방이에요.' });
      if (room.clients[0] === c) return c.send({ t: 'error', msg: '내가 만든 방에는 참가할 수 없어요.' });
      leave(c);
      room.clients[1] = c; room.teams[1] = teamIdx(m.team);
      c.room = room; c.side = 1;
      startRoom(room);
      break;
    }
    case 'rematch':
      if (!r || !r.match || r.match.phase !== 'ended') return;
      r.rematch[c.side] = true;
      if (r.rematch[0] && r.rematch[1]) startRoom(r);
      else {
        c.send({ t: 'rematch-wait' });
        const o = r.clients[1 - c.side]; if (o) o.send({ t: 'rematch-ask' });
      }
      break;
    case 'leave':
      leave(c);
      break;
  }
}

function startRoom(r) {
  r.match = Sim.createMatch({ teams: r.teams, humans: [true, true], duration: r.dur });
  r.inputs = [null, null]; r.rematch = [false, false]; r.endSent = 0;
  r.clients.forEach((cl, side) => cl && cl.send({ t: 'start', side, teams: r.teams, dur: r.dur }));
  console.log(`[${r.code}] 경기 시작 ${Sim.TEAMS[r.teams[0]].id} vs ${Sim.TEAMS[r.teams[1]].id}`);
}

function leave(c) {
  const r = c.room;
  if (!r) return;
  c.room = null;
  const other = r.clients[1 - c.side];
  c.side = -1;
  if (other) { other.send({ t: 'left' }); other.room = null; other.side = -1; }
  rooms.delete(r.code);
}

// ---------- 경기 루프: 60Hz 계산, 30Hz 전송 ----------
const STEP_MS = 1000 / 60;
let last = Date.now(), acc = 0;
setInterval(() => {
  const now = Date.now(); acc += now - last; last = now;
  if (acc > 250) acc = STEP_MS;
  while (acc >= STEP_MS) {
    acc -= STEP_MS;
    for (const r of rooms.values()) if (r.match && r.match.phase !== 'ended') Sim.step(r.match, Sim.DT, r.inputs);
  }
}, 8);

setInterval(() => {
  for (const r of rooms.values()) {
    if (!r.match) continue;
    if (r.match.phase === 'ended') { if (r.endSent >= 5) continue; r.endSent++; }
    const msg = { t: 'state', s: Sim.snapshot(r.match) };
    for (const cl of r.clients) if (cl) cl.send(msg);
  }
}, 1000 / 30);

server.listen(PORT, () => console.log(`PITCH ONLINE 서버 실행 중: http://localhost:${PORT}`));
