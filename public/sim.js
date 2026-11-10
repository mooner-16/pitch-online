/*
 * PITCH ONLINE - 게임 엔진 (물리, 규칙, AI)
 * 브라우저(AI 대전)와 Node 서버(온라인 대전)에서 똑같이 사용합니다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Sim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- 경기장 규격 (미터) ----------
  const HL = 52.5, HW = 34;            // 105 x 68
  const GOAL_HW = 3.66, GOAL_H = 2.44; // 골대 7.32 x 2.44
  const G = 9.81;
  const PER_TEAM = 7;
  const DT = 1 / 60;

  // ---------- 가상 구단 ----------
  const TEAMS = [
    { id: 'HGU', name: '한강 유나이티드', kit: ['#1b2a6b', '#ffffff', '#1b2a6b'], gkKit: '#2ecc71', pac: 80, sho: 82, pas: 86, def: 81, gk: 80 },
    { id: 'RDR', name: '레드 드래곤즈', kit: ['#d32f2f', '#141414', '#d32f2f'], gkKit: '#f1c40f', pac: 87, sho: 84, pas: 78, def: 76, gk: 77 },
    { id: 'BWV', name: '블루 웨이브 FC', kit: ['#4fc3f7', '#0d2c54', '#4fc3f7'], gkKit: '#ff7043', pac: 79, sho: 78, pas: 89, def: 82, gk: 79 },
    { id: 'GEA', name: '골든 이글스', kit: ['#ffca28', '#1a1a1a', '#1a1a1a'], gkKit: '#8e44ad', pac: 83, sho: 87, pas: 80, def: 78, gk: 81 },
    { id: 'GFR', name: '그린 포레스트', kit: ['#f5f5f5', '#2e7d32', '#2e7d32'], gkKit: '#e91e63', pac: 77, sho: 79, pas: 83, def: 88, gk: 86 },
    { id: 'PTH', name: '퍼플 썬더', kit: ['#7b1fa2', '#f5f5f5', '#7b1fa2'], gkKit: '#00bcd4', pac: 85, sho: 85, pas: 83, def: 79, gk: 78 }
  ];

  const ROLES = ['GK', 'CB', 'CB', 'LM', 'CM', 'RM', 'ST'];
  const NUMS = [1, 4, 5, 7, 8, 11, 9];
  // 오른쪽(+x)으로 공격하는 팀 기준 좌표
  const KICKOFF = [[-50, 0], [-30, -10], [-30, 10], [-14, -22], [-16, 0], [-14, 22], [-3, 0]];
  const SHAPE = [[-50, 0], [-27, -11], [-27, 11], [-6, -23], [-11, 0], [-6, 23], [9, 0]];

  const DIFF = {
    easy:   { spd: 0.92, react: 1.6, tackle: 0.7,  aim: 1.4, gk: 0.86, pass: 0.85 },
    normal: { spd: 1.0,  react: 1.0, tackle: 1.0,  aim: 1.0, gk: 1.0,  pass: 1.0 },
    hard:   { spd: 1.05, react: 0.65, tackle: 1.25, aim: 0.8, gk: 1.08, pass: 1.1 }
  };

  // 선수 이름 (가상)
  const SUR = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '홍'];
  const GIV = ['민', '준', '서', '현', '우', '지', '도', '하', '윤', '건', '태', '성', '진', '호', '재', '영', '수', '빈', '혁', '찬', '규', '원'];
  TEAMS.forEach((t, ti) => {
    let s = (ti + 7) * 7919;
    const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    const used = new Set(); t.players = [];
    while (t.players.length < PER_TEAM) {
      const n = SUR[Math.floor(r() * SUR.length)] + GIV[Math.floor(r() * GIV.length)] + GIV[Math.floor(r() * GIV.length)];
      if (!used.has(n)) { used.add(n); t.players.push(n); }
    }
    t.ovr = Math.round((t.pac + t.sho + t.pas + t.def + t.gk) / 5);
  });

  // ---------- 도우미 ----------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const hyp = Math.hypot;
  const r2 = v => Math.round(v * 100) / 100;
  function randn() { let u = 0, v = 0; while (u === 0) u = Math.random(); while (v === 0) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function wrapAng(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  const player = (m, side, idx) => m.players[side * PER_TEAM + idx];
  const dist = (a, b) => hyp(a.x - b.x, a.y - b.y);
  function segDist(o, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y; const l2 = dx * dx + dy * dy || 1;
    const t = clamp(((o.x - a.x) * dx + (o.y - a.y) * dy) / l2, 0, 1);
    return hyp(o.x - (a.x + dx * t), o.y - (a.y + dy * t));
  }
  function say(m, text, sub) { m.msg = { id: m.msg.id + 1, text, sub: sub || '' }; }

  // ---------- 경기 생성 ----------
  function createMatch(o) {
    const m = {
      time: 0, duration: o.duration || 300, phase: 'kickoff', phaseT: 1.6,
      players: [], ball: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
      owner: -1, lastTouch: 0, lastKicker: -1, poss: 0, teams: [],
      msg: { id: 0, text: '', sub: '' }, kicks: 0,
      passTarget: -1, passT: 0, saveCD: 0, concede: 0,
      stats: { poss: [0, 0], shots: [0, 0] }
    };
    for (let side = 0; side < 2; side++) {
      const def = TEAMS[o.teams[side]] || TEAMS[side];
      const human = !!(o.humans && o.humans[side]);
      m.teams.push({
        def, side, dir: side === 0 ? 1 : -1, score: 0, human, ctrl: -1, last: null,
        diff: DIFF[human ? 'normal' : (o.difficulty || 'normal')] || DIFF.normal,
        pace: 0.6 + def.pac * 0.005
      });
      for (let i = 0; i < PER_TEAM; i++) {
        m.players.push({
          id: side * PER_TEAM + i, team: side, idx: i, role: ROLES[i], num: NUMS[i], name: def.players[i],
          x: 0, y: 0, vx: 0, vy: 0, tvx: 0, tvy: 0, face: 0,
          kickCD: 0, tackleCD: 0, stun: 0, charge: -1, think: 0, hold: 0, mustPass: false
        });
      }
    }
    setKickoff(m, Math.random() < 0.5 ? 0 : 1);
    say(m, '킥오프', `${m.teams[0].def.name} vs ${m.teams[1].def.name}`);
    return m;
  }

  function setKickoff(m, team) {
    for (const p of m.players) {
      const t = m.teams[p.team], k = KICKOFF[p.idx];
      p.x = k[0] * t.dir; p.y = k[1]; p.vx = p.vy = p.tvx = p.tvy = 0;
      p.face = t.dir > 0 ? 0 : Math.PI; p.charge = -1; p.stun = 0; p.kickCD = 0; p.tackleCD = 0; p.hold = 0; p.mustPass = false;
    }
    const kt = m.teams[team];
    const st = player(m, team, 6); st.x = -0.7 * kt.dir; st.y = 0;
    const cm = player(m, team, 4); cm.x = -7 * kt.dir; cm.y = 5;
    st.mustPass = true; st.think = 0.4;
    Object.assign(m.ball, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
    m.owner = st.id; m.poss = team; m.lastTouch = team; m.passTarget = -1;
    m.phase = 'kickoff'; m.phaseT = 1.6;
    for (const t of m.teams) if (t.human) t.ctrl = t.side === team ? 6 : 4;
    carryBall(m);
  }

  // ---------- 메인 스텝 ----------
  const EMPTY = { mx: 0, my: 0, sp: false, pa: 0, lo: 0, sw: 0, sh: false };

  function step(m, dt, inputs) {
    if (m.phase === 'ended') return;
    if (m.phase !== 'play') {
      m.phaseT -= dt;
      for (const t of m.teams) if (t.human) syncLast(t, (inputs && inputs[t.side]) || null);
      if (m.phase === 'goal') { celebrate(m, dt); ballPhysics(m, dt); netContain(m); }
      else carryBall(m);
      if (m.phaseT <= 0) {
        if (m.phase === 'goal') {
          if (m.time >= m.duration) return endMatch(m);
          setKickoff(m, m.concede); say(m, '킥오프', '');
        } else m.phase = 'play';
      }
      return;
    }

    m.time += dt;
    if (m.time >= m.duration) return endMatch(m);
    m.saveCD -= dt; m.passT += dt;
    for (const p of m.players) {
      p.kickCD -= dt; p.tackleCD -= dt; p.stun -= dt;
      p.tvx = 0; p.tvy = 0;
    }
    if (m.owner < 0) m.poss = m.lastTouch;
    m.stats.poss[m.poss] += dt;

    for (const t of m.teams) if (t.human) handleHuman(m, t, (inputs && inputs[t.side]) || EMPTY, dt);
    aiTeam(m, 0, dt); aiTeam(m, 1, dt);
    movePlayers(m, dt);
    separate(m);
    if (m.owner >= 0) carryBall(m);
    else { ballPhysics(m, dt); gkSaves(m); if (m.owner < 0) pickup(m); }
    if (m.phase === 'play') checkBounds(m);
  }

  function syncLast(t, inp) { if (inp) t.last = { pa: inp.pa, lo: inp.lo, sw: inp.sw, sh: !!inp.sh }; }

  function endMatch(m) {
    m.phase = 'ended'; m.owner = -1;
    say(m, '경기 종료', `${m.teams[0].score} : ${m.teams[1].score}`);
  }

  // ---------- 이동 ----------
  function speedOf(m, p, sprint) {
    const t = m.teams[p.team];
    let s = sprint ? 8.3 : 6.0;
    if (p.role === 'GK') s *= 0.92;
    if (m.owner === p.id) s *= 0.9;
    s *= t.pace * t.diff.spd;
    if (p.stun > 0) s *= 0.35;
    return s;
  }
  function steerTo(p, x, y, s) {
    const dx = x - p.x, dy = y - p.y, d = hyp(dx, dy);
    if (d < 0.25) { p.tvx = 0; p.tvy = 0; return; }
    const v = Math.min(s, d * 2.5);
    p.tvx = dx / d * v; p.tvy = dy / d * v;
  }
  function movePlayers(m, dt) {
    const maxA = 28 * dt;
    for (const p of m.players) {
      const ax = p.tvx - p.vx, ay = p.tvy - p.vy, a = hyp(ax, ay);
      if (a > maxA) { p.vx += ax / a * maxA; p.vy += ay / a * maxA; } else { p.vx = p.tvx; p.vy = p.tvy; }
      p.x = clamp(p.x + p.vx * dt, -HL - 3, HL + 3);
      p.y = clamp(p.y + p.vy * dt, -HW - 3, HW + 3);
      const sp = hyp(p.vx, p.vy);
      if (sp > 0.4) {
        const d = wrapAng(Math.atan2(p.vy, p.vx) - p.face);
        p.face = wrapAng(p.face + clamp(d, -11 * dt, 11 * dt));
      }
    }
  }
  function separate(m) {
    const ps = m.players;
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j]; const dx = b.x - a.x, dy = b.y - a.y; const d = hyp(dx, dy);
      if (d < 0.9 && d > 0.0001) { const k = (0.9 - d) / 2 / d; a.x -= dx * k; a.y -= dy * k; b.x += dx * k; b.y += dy * k; }
    }
  }

  // ---------- 공 ----------
  function inOwnBox(m, p) {
    const t = m.teams[p.team];
    const into = (p.x + HL * t.dir) * t.dir; // 자기 골라인에서 떨어진 거리
    return into >= -1.5 && into <= 16.5 && Math.abs(p.y) <= 20.2;
  }
  function carryBall(m) {
    if (m.owner < 0) return;
    const p = m.players[m.owner], b = m.ball;
    if (p.role === 'GK' && inOwnBox(m, p)) {
      b.x = p.x + Math.cos(p.face) * 0.35; b.y = p.y + Math.sin(p.face) * 0.35; b.z = 1.05;
    } else {
      const d = 0.7 + Math.min(hyp(p.vx, p.vy), 8) * 0.04;
      b.x = p.x + Math.cos(p.face) * d; b.y = p.y + Math.sin(p.face) * d; b.z = 0;
    }
    b.vx = p.vx; b.vy = p.vy; b.vz = 0;
  }
  function ballPhysics(m, dt) {
    const b = m.ball;
    if (b.z > 0 || b.vz > 0) b.vz -= G * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    if (b.z <= 0) {
      b.z = 0;
      if (b.vz < -1.5) { b.vz = -b.vz * 0.45; b.vx *= 0.82; b.vy *= 0.82; } else b.vz = 0;
    }
    const ground = b.z <= 0.02;
    const f = Math.exp(-(ground ? 0.75 : 0.06) * dt);
    b.vx *= f; b.vy *= f;
    if (ground) {
      const s = hyp(b.vx, b.vy);
      if (s > 0) { const ns = Math.max(0, s - 0.8 * dt); b.vx *= ns / s; b.vy *= ns / s; }
    }
  }
  function netContain(m) {
    const b = m.ball;
    if (Math.abs(b.x) > HL) {
      const s = Math.sign(b.x);
      if (Math.abs(b.x) > HL + 1.8) { b.x = s * (HL + 1.8); b.vx *= -0.15; }
      b.y = clamp(b.y, -GOAL_HW + 0.2, GOAL_HW - 0.2);
      if (b.z > GOAL_H - 0.2) { b.z = GOAL_H - 0.2; b.vz = Math.min(0, b.vz); }
      b.vx *= 0.96; b.vy *= 0.9;
    }
  }
  function gainBall(m, p) {
    m.owner = p.id; m.poss = p.team; m.lastTouch = p.team; m.passTarget = -1;
    p.hold = 0; p.think = 0.15 + Math.random() * 0.1; p.charge = -1;
    const t = m.teams[p.team];
    if (t.human) t.ctrl = p.idx;
  }
  function pickup(m) {
    const b = m.ball; const bs = hyp(b.vx, b.vy);
    let best = null, bd = 1e9;
    for (const p of m.players) {
      if (p.kickCD > 0 || p.stun > 0.2) continue;
      const hands = p.role === 'GK' && inOwnBox(m, p);
      if (b.z > (hands ? 2.5 : 1.25)) continue;
      let reach = hands ? 1.5 : (bs > 22 ? 0.65 : 1.0);
      if (p.id === m.passTarget) reach += 0.35;
      const d = hyp(p.x - b.x, p.y - b.y);
      if (d < reach && d < bd) { best = p; bd = d; }
    }
    if (best) gainBall(m, best);
  }
  function gkSaves(m) {
    if (m.saveCD > 0) return;
    const b = m.ball;
    for (const t of m.teams) {
      const gk = player(m, t.side, 0);
      if (gk.kickCD > 0 || gk.stun > 0 || !inOwnBox(m, gk) || m.lastTouch === t.side) continue;
      if (hyp(gk.x - b.x, gk.y - b.y) > 1.9 || b.z > 2.7) continue;
      const s = hyp(b.vx, b.vy, b.vz);
      if (s < 9) { gainBall(m, gk); return; }
      const skill = (t.def.gk / 100) * t.diff.gk;
      const pCatch = clamp(1.35 - s / 32, 0.12, 0.9) * skill;
      const pParry = clamp(pCatch + 0.38, 0, 0.96);
      const r = Math.random();
      if (r < pCatch) { gainBall(m, gk); if (s > 17) say(m, '선방!', gk.name); return; }
      if (r < pParry) {
        b.vx = Math.abs(b.vx) * 0.3 * t.dir + t.dir * 2; b.vy = b.vy * 0.3 + (Math.random() - 0.5) * 12;
        b.vz = 2 + Math.random() * 3; b.z = Math.max(b.z, 0.3);
        m.lastTouch = t.side; m.lastKicker = gk.id; gk.kickCD = 0.6; m.saveCD = 0.4; m.kicks++;
        if (s > 17) say(m, '선방!', gk.name + ' 쳐냄');
        return;
      }
      m.saveCD = 0.6; gk.stun = 0.5;
    }
  }

  // ---------- 킥 ----------
  function release(m, p) {
    m.owner = -1; p.kickCD = 0.3; p.charge = -1; p.hold = 0; p.mustPass = false;
    m.lastTouch = p.team; m.lastKicker = p.id; m.kicks++;
  }
  function kickTo(m, p, tx, ty, lob, acc) {
    const b = m.ball;
    let dx = tx - b.x, dy = ty - b.y;
    const err = randn() * (1 - acc) * 0.12;
    const c = Math.cos(err), s = Math.sin(err);
    [dx, dy] = [dx * c - dy * s, dx * s + dy * c];
    const d = hyp(dx, dy) || 0.01;
    if (!lob) {
      const v = clamp(0.75 * d + 6, 8, 29);
      b.vx = dx / d * v; b.vy = dy / d * v; b.vz = 0; b.z = 0;
    } else {
      const T = clamp(d / 19, 0.75, 1.9);
      const v = d * 0.9 / (T * (1 - 0.03 * T));
      b.vx = dx / d * v; b.vy = dy / d * v; b.vz = G * T / 2; b.z = 0.05;
    }
    release(m, p);
  }
  function passTo(m, p, q, lob) {
    const t = m.teams[p.team];
    const acc = clamp(t.def.pas / 100 * t.diff.pass, 0.5, 0.98);
    const d = dist(p, q);
    const lead = lob ? d / 19 + 0.3 : d / 18;
    let tx = q.x + q.vx * lead, ty = q.y + q.vy * lead;
    if (lob) tx += t.dir * 4;
    tx = clamp(tx, -HL + 1, HL - 1); ty = clamp(ty, -HW + 1, HW - 1);
    kickTo(m, p, tx, ty, lob, acc);
    m.passTarget = q.id; m.passT = 0;
    if (t.human) t.ctrl = q.idx;
  }
  function aiPassScore(m, p, q, d) {
    if (d > 40) return -99;
    const dir = m.teams[p.team].dir;
    const prog = (q.x - p.x) * dir;
    let lane = 6, mark = 8;
    for (const o of m.players) {
      if (o.team === p.team) continue;
      lane = Math.min(lane, segDist(o, p, q)); mark = Math.min(mark, dist(o, q));
    }
    return prog * 0.07 + lane * 0.4 + mark * 0.15 - d * 0.015 + (Math.random() - 0.5) * 0.4;
  }
  function pickBestMate(m, p, dir) {
    let best = null, bs = -1e9;
    for (const q of m.players) {
      if (q.team !== p.team || q.id === p.id || q.role === 'GK') continue;
      const dx = q.x - p.x, dy = q.y - p.y, d = hyp(dx, dy);
      if (d < 4) continue;
      let s;
      if (dir) { const al = (dx * dir.x + dy * dir.y) / d; s = al * 3 - d / 35; if (al < 0.4) s -= 4; }
      else s = aiPassScore(m, p, q, d);
      if (s > bs) { bs = s; best = q; }
    }
    return { q: best, score: bs };
  }
  function doShoot(m, p, power, aimY) {
    const t = m.teams[p.team], b = m.ball;
    const gx = HL * t.dir;
    const gk = player(m, 1 - p.team, 0);
    let ty;
    if (aimY !== null && Math.abs(aimY) > 0.3) ty = Math.sign(aimY) * 2.6;
    else ty = gk.y > 0 ? -2.3 : 2.3;
    const acc = t.def.sho / 100;
    const dd = hyp(gx - p.x, ty - p.y);
    const sigma = ((1 - acc) * 2.2 + power * power * 1.1 + dd / 28) * t.diff.aim;
    ty += randn() * sigma * 0.55;
    const speed = (15 + power * 15) * (0.85 + acc * 0.2);
    const dx = gx - b.x, dy = ty - b.y, d = hyp(dx, dy) || 1;
    const T = d / (speed * 0.95);
    const h = 0.35 + power * 1.3 + Math.abs(randn()) * sigma * 0.25 + (power > 0.85 ? (power - 0.85) * 6 * Math.random() : 0);
    b.vx = dx / d * speed; b.vy = dy / d * speed; b.vz = G * T / 2 + h / T; b.z = 0.1;
    release(m, p);
    m.stats.shots[p.team]++; m.passTarget = -1;
  }
  function tryTackle(m, p) {
    if (p.tackleCD > 0) return;
    p.tackleCD = 0.8;
    const o = m.owner >= 0 ? m.players[m.owner] : null;
    if (!o || o.team === p.team) return;
    if (dist(p, o) > 2.1) { p.stun = 0.15; return; }
    const t = m.teams[p.team], ot = m.teams[o.team];
    const fx = Math.cos(o.face), fy = Math.sin(o.face);
    const behind = ((p.x - o.x) * fx + (p.y - o.y) * fy) < -0.3;
    let ch = 0.42 + (t.def.def - 80) * 0.012 - (ot.def.pac - 80) * 0.004 + (behind ? -0.15 : 0.05);
    ch *= t.diff.tackle;
    if (o.role === 'GK' && inOwnBox(m, o)) ch = 0;
    ch = clamp(ch, 0, 0.85);
    if (Math.random() < ch) {
      if (Math.random() < 0.5) gainBall(m, p);
      else {
        const b = m.ball; m.owner = -1;
        b.vx = Math.cos(p.face) * 5 + (Math.random() - 0.5) * 3; b.vy = Math.sin(p.face) * 5 + (Math.random() - 0.5) * 3;
        b.vz = 0.5; m.lastTouch = p.team; m.lastKicker = p.id; p.kickCD = 0.25; m.kicks++; m.passTarget = -1;
      }
      o.stun = 0.6; o.kickCD = 0.5; o.charge = -1;
    } else p.stun = 0.55;
  }
  function interceptPoint(m, p, speed) {
    const b = m.ball, k = 0.75;
    let x = b.x, y = b.y;
    for (let tt = 0; tt <= 2.5; tt += 0.1) {
      const f = (1 - Math.exp(-k * tt)) / k;
      x = b.x + b.vx * f; y = b.y + b.vy * f;
      if (hyp(x - p.x, y - p.y) / Math.max(speed, 1) <= tt + 0.1) break;
    }
    return { x: clamp(x, -HL - 1, HL + 1), y: clamp(y, -HW - 1, HW + 1) };
  }

  // ---------- 사람 조작 ----------
  function nearestOutfield(m, side, exclude) {
    let best = null, bd = 1e9;
    for (let i = 1; i < PER_TEAM; i++) {
      if (i === exclude) continue;
      const p = player(m, side, i); const d = dist(p, m.ball);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  function handleHuman(m, t, inp, dt) {
    if (!t.last) syncLast(t, inp);
    const last = t.last;
    const paE = inp.pa > last.pa, loE = inp.lo > last.lo, swE = inp.sw > last.sw;
    const shDown = !!inp.sh && !last.sh, shUp = !inp.sh && last.sh;
    syncLast(t, inp);

    const ownerP = m.owner >= 0 ? m.players[m.owner] : null;
    const weHave = ownerP && ownerP.team === t.side;
    if (swE && !weHave) t.ctrl = nearestOutfield(m, t.side, t.ctrl).idx;
    if (t.ctrl < 0) t.ctrl = nearestOutfield(m, t.side, -1).idx;
    let p = player(m, t.side, t.ctrl);
    if (p.role === 'GK' && m.owner !== p.id) { t.ctrl = nearestOutfield(m, t.side, 0).idx; p = player(m, t.side, t.ctrl); }

    let mx = clamp(+inp.mx || 0, -1, 1), my = clamp(+inp.my || 0, -1, 1);
    const ml = hyp(mx, my); if (ml > 1) { mx /= ml; my /= ml; }
    const has = m.owner === p.id;
    const sp = speedOf(m, p, !!inp.sp && p.charge < 0);

    if (ml > 0.15) { p.tvx = mx * sp; p.tvy = my * sp; }
    else if (!has && m.owner < 0 && (m.passTarget === p.id || dist(p, m.ball) < 6)) {
      const ip = interceptPoint(m, p, sp); steerTo(p, ip.x, ip.y, sp);
    }

    if (has) {
      const dir = ml > 0.2 ? { x: mx / Math.max(ml, 1e-6), y: my / Math.max(ml, 1e-6) } : { x: Math.cos(p.face), y: Math.sin(p.face) };
      if (p.role === 'GK') {
        p.hold += dt;
        if (paE) { const r = pickBestMate(m, p, dir); if (r.q) passTo(m, p, r.q, false); }
        else if (loE || shUp || p.hold > 4) { const r = pickBestMate(m, p, { x: t.dir, y: 0 }); if (r.q) passTo(m, p, r.q, true); }
        return;
      }
      if (paE || loE) { const r = pickBestMate(m, p, dir); if (r.q) passTo(m, p, r.q, loE); }
      else if (shDown) p.charge = 0;
      else if (inp.sh && p.charge >= 0) p.charge = Math.min(1.2, p.charge + dt);
      else if (shUp && p.charge >= 0) doShoot(m, p, Math.min(1, p.charge / 0.9), my);
    } else {
      p.charge = -1;
      if (paE || shDown) tryTackle(m, p);
    }
  }

  // ---------- AI ----------
  function formationTarget(m, p, t, weHave) {
    const sh = SHAPE[p.idx], dir = t.dir, b = m.ball;
    const bx = b.x * dir;
    let x = sh[0] + bx * 0.55 + (weHave ? 9 : -3);
    let y = sh[1] * (weHave ? 1.1 : 0.8) + b.y * (p.role === 'CB' ? 0.25 : 0.35);
    if (p.role === 'CB') x = clamp(x, -44, 18);
    else if (p.role === 'ST') x = clamp(weHave ? Math.max(x, bx + 8) : x, -20, 44);
    else x = clamp(x, -40, 40);
    if (!weHave && p.role !== 'ST') x = Math.min(x, bx - 1.5);
    x = clamp(x, -46, 46);
    y = clamp(y, -HW + 2, HW - 2);
    return { x: x * dir, y };
  }

  function aiTeam(m, side, dt) {
    const t = m.teams[side];
    const owner = m.owner >= 0 ? m.players[m.owner] : null;
    const weHave = owner ? owner.team === side : m.poss === side && m.passTarget >= 0;

    // 공을 쫓을 선수 1명
    let chaser = null;
    if (!(owner && owner.team === side)) {
      const ownPass = !owner && m.passTarget >= 0 && m.players[m.passTarget].team === side && m.passT < 3;
      if (!ownPass) {
        const ctrlP = t.human && t.ctrl >= 0 ? player(m, side, t.ctrl) : null;
        const ctrlNear = ctrlP && dist(ctrlP, m.ball) < 10;
        if (!ctrlNear) {
          let bd = 1e9;
          for (let i = 1; i < PER_TEAM; i++) {
            if (t.human && i === t.ctrl) continue;
            const q = player(m, side, i); const d = dist(q, m.ball);
            if (d < bd) { bd = d; chaser = q; }
          }
        }
      }
    }

    for (let i = 0; i < PER_TEAM; i++) {
      const p = player(m, side, i);
      if (t.human && i === t.ctrl) continue;
      p.think -= dt;
      if (p.role === 'GK') { aiGK(m, p, t, dt); continue; }
      if (owner === p) { aiCarrier(m, p, t, dt); continue; }
      const sp = speedOf(m, p, false), spS = speedOf(m, p, true);
      if (m.passTarget === p.id && !owner) { const ip = interceptPoint(m, p, spS); steerTo(p, ip.x, ip.y, spS); continue; }
      if (p === chaser) {
        if (owner) {
          const gx = -HL * t.dir; const dx = gx - owner.x, dy = -owner.y, d = hyp(dx, dy) || 1;
          steerTo(p, owner.x + dx / d * 0.8, owner.y + dy / d * 0.8, spS);
          if (dist(p, owner) < 1.8 && p.tackleCD <= 0 && Math.random() < dt * 2.2 * t.diff.tackle) tryTackle(m, p);
        } else { const ip = interceptPoint(m, p, spS); steerTo(p, ip.x, ip.y, spS); }
        continue;
      }
      const f = formationTarget(m, p, t, weHave);
      steerTo(p, f.x, f.y, hyp(f.x - p.x, f.y - p.y) > 8 ? spS * 0.95 : sp);
    }
  }

  function aiPass(m, p, minScore) {
    const r = pickBestMate(m, p, null);
    if (!r.q || r.score < minScore) return false;
    let lane = 6;
    for (const o of m.players) if (o.team !== p.team) lane = Math.min(lane, segDist(o, p, r.q));
    passTo(m, p, r.q, lane < 1.5 && dist(p, r.q) > 16);
    return true;
  }

  function aiCarrier(m, p, t, dt) {
    const dir = t.dir, gx = HL * dir;
    const dG = hyp(gx - p.x, p.y);
    let near = 1e9;
    let hx = gx - p.x, hy = -p.y * 0.6;
    let hl = hyp(hx, hy) || 1; hx /= hl; hy /= hl;
    for (const o of m.players) {
      if (o.team === p.team) continue;
      const dx = p.x - o.x, dy = p.y - o.y, d = hyp(dx, dy) || 0.01;
      near = Math.min(near, d);
      if (d < 7 && (o.x - p.x) * dir > -1) { hx += dx / d * (7 - d) / 7 * 1.2; hy += dy / d * (7 - d) / 7 * 1.6; }
    }
    if (Math.abs(p.y) > HW - 4) hy -= Math.sign(p.y) * 0.8;
    hl = hyp(hx, hy) || 1;
    const s = near > 4 ? speedOf(m, p, true) : speedOf(m, p, false);
    p.tvx = hx / hl * s; p.tvy = hy / hl * s;

    if (p.think > 0) return;
    p.think = (0.25 + Math.random() * 0.35) * t.diff.react;
    if (p.mustPass) { if (aiPass(m, p, -1e9)) return; }
    if (dG < 26 && Math.abs(p.y) < 18 && p.x * dir > 26) {
      const chance = dG < 14 ? 0.75 : dG < 20 ? 0.45 : 0.2;
      if (Math.random() < chance) { doShoot(m, p, clamp(0.45 + dG / 40 + Math.random() * 0.2, 0.4, 0.95), null); return; }
    }
    if (near < 3.2 && Math.random() < 0.65) { if (aiPass(m, p, -1e9)) return; }
    if (Math.random() < 0.22) aiPass(m, p, 2.4);
  }

  function aiGK(m, gk, t, dt) {
    const dir = t.dir, gx = -HL * dir, b = m.ball;
    if (m.owner === gk.id) {
      gk.hold += dt;
      if (gk.hold > 1.2) {
        if (!aiPass(m, gk, 1.6)) passTo(m, gk, player(m, t.side, 6), true);
      }
      return;
    }
    const bd = hyp(b.x - gx, b.y);
    let tx = gx + dir * clamp(bd * 0.08, 1, 4.5);
    let ty = clamp(b.y * 0.18, -3.2, 3.2);
    let speed = 6;
    if (m.owner < 0 && -b.vx * dir > 4) {
      const tt = (gk.x - b.x) / (b.vx || 1e-6);
      if (tt > 0 && tt < 1.5) {
        const py = b.y + b.vy * tt;
        if (Math.abs(py) < 6) { ty = clamp(py, -4, 4); tx = gk.x; speed = 9.5 * t.diff.gk; }
      }
    }
    const ownPass = m.passTarget >= 0 && m.players[m.passTarget].team === t.side;
    if (m.owner < 0 && !ownPass && Math.abs(b.x - gx) < 15 && Math.abs(b.y) < 18 && hyp(b.vx, b.vy) < 12) { tx = b.x; ty = b.y; speed = 7.5; }
    steerTo(gk, tx, ty, speed);
  }

  // ---------- 규칙 ----------
  function checkBounds(m) {
    const b = m.ball;
    if (Math.abs(b.y) > HW + 0.15) {
      return restart(m, 'throw', 1 - m.lastTouch, clamp(b.x, -HL + 1, HL - 1), Math.sign(b.y) * (HW - 0.4));
    }
    if (Math.abs(b.x) > HL) {
      const s = Math.sign(b.x), defSide = s > 0 ? 1 : 0, attSide = 1 - defSide, ay = Math.abs(b.y);
      if (m.owner < 0 && ay < GOAL_HW + 0.2 && b.z < GOAL_H + 0.25 && (ay > GOAL_HW - 0.12 || b.z > GOAL_H - 0.12)) {
        b.x = s * (HL - 0.15); b.vx = -b.vx * 0.55; b.vy += (Math.random() - 0.5) * 4;
        if (b.z > GOAL_H - 0.12) b.vz = -Math.abs(b.vz) * 0.5;
        m.kicks++; say(m, '골대 강타!', '');
        return;
      }
      if (ay < GOAL_HW && b.z < GOAL_H) return goal(m, attSide);
      if (m.lastTouch === defSide) restart(m, 'corner', attSide, s * (HL - 0.6), (Math.sign(b.y) || 1) * (HW - 0.6));
      else restart(m, 'goalkick', defSide, s * (HL - 5.5), 0);
    }
  }

  const LABEL = { throw: '스로인', corner: '코너킥', goalkick: '골킥' };
  function restart(m, kind, side, x, y) {
    m.phase = 'restart'; m.phaseT = kind === 'throw' ? 0.9 : 1.3;
    const b = m.ball; Object.assign(b, { x, y, z: 0, vx: 0, vy: 0, vz: 0 });
    const t = m.teams[side];
    let taker;
    if (kind === 'goalkick') taker = player(m, side, 0);
    else {
      let bd = 1e9;
      for (let i = 1; i < PER_TEAM; i++) { const q = player(m, side, i); const d = dist(q, b); if (d < bd) { bd = d; taker = q; } }
    }
    let face;
    if (kind === 'corner') face = Math.atan2(-y, Math.sign(x) * (HL - 11) - x);
    else if (kind === 'goalkick') face = t.dir > 0 ? 0 : Math.PI;
    else face = Math.atan2(-Math.sign(y), t.dir * 0.6);
    for (const p of m.players) { p.vx = p.vy = p.tvx = p.tvy = 0; p.charge = -1; p.stun = 0; }
    taker.x = x - Math.cos(face) * 0.7; taker.y = y - Math.sin(face) * 0.7; taker.face = face;
    taker.think = 0.3; taker.hold = 0; taker.mustPass = true;
    m.owner = taker.id; m.poss = side; m.lastTouch = side; m.passTarget = -1;
    for (const p of m.players) {
      if (p.team === side) continue;
      const dx = p.x - b.x, dy = p.y - b.y, d = hyp(dx, dy);
      if (d < 6) {
        const ux = d > 0.1 ? dx / d : -t.dir, uy = d > 0.1 ? dy / d : 0;
        p.x = clamp(b.x + ux * 6, -HL - 2, HL + 2); p.y = clamp(b.y + uy * 6, -HW - 2, HW + 2);
      }
    }
    if (t.human) t.ctrl = taker.idx;
    carryBall(m);
    say(m, LABEL[kind], t.def.name);
  }

  function goal(m, side) {
    m.teams[side].score++;
    m.phase = 'goal'; m.phaseT = 3.4; m.concede = 1 - side;
    const sc = m.lastKicker >= 0 ? m.players[m.lastKicker] : null;
    m.scorer = sc ? sc.id : -1; m.scoringSide = side;
    say(m, 'GOAL!', sc ? (sc.team !== side ? sc.name + ' (자책골)' : sc.name) : '');
    m.owner = -1; m.passTarget = -1;
  }
  function celebrate(m, dt) {
    for (const p of m.players) { p.tvx = 0; p.tvy = 0; }
    const sc = m.scorer >= 0 ? m.players[m.scorer] : null;
    if (sc && sc.team === m.scoringSide) {
      const s = Math.sign(sc.x) || 1;
      steerTo(sc, s * (HL - 3), (Math.sign(sc.y) || 1) * (HW - 3), 7.5);
      for (const p of m.players) if (p.team === sc.team && p !== sc && p.role !== 'GK' && dist(p, sc) < 30) steerTo(p, sc.x, sc.y, 6.5);
    }
    movePlayers(m, dt); separate(m);
  }

  // ---------- 전송용 스냅샷 ----------
  function snapshot(m) {
    const p = new Array(m.players.length * 4);
    for (let i = 0; i < m.players.length; i++) {
      const q = m.players[i];
      p[i * 4] = r2(q.x); p[i * 4 + 1] = r2(q.y); p[i * 4 + 2] = r2(q.face); p[i * 4 + 3] = r2(hyp(q.vx, q.vy));
    }
    const ch = m.teams.map(t => (t.ctrl >= 0 ? r2(player(m, t.side, t.ctrl).charge) : -1));
    return {
      p, b: [r2(m.ball.x), r2(m.ball.y), r2(m.ball.z)], o: m.owner,
      s: [m.teams[0].score, m.teams[1].score], tm: Math.round(m.time * 10) / 10, d: m.duration,
      ph: m.phase, c: [m.teams[0].ctrl, m.teams[1].ctrl], ch, msg: m.msg, k: m.kicks,
      st: [Math.round(m.stats.poss[0]), Math.round(m.stats.poss[1]), m.stats.shots[0], m.stats.shots[1]]
    };
  }

  return { TEAMS, ROLES, NUMS, PER_TEAM, DT, HL, HW, GOAL_HW, GOAL_H, DIFF, createMatch, step, snapshot };
});
