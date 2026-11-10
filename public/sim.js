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
  const HL = 52.5, HW = 34;
  const GOAL_HW = 3.66, GOAL_H = 2.44;
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
  const KICKOFF = [[-50, 0], [-30, -10], [-30, 10], [-14, -22], [-16, 0], [-14, 22], [-3, 0]];
  const SHAPE = [[-50, 0], [-27, -11], [-27, 11], [-6, -23], [-11, 0], [-6, 23], [9, 0]];

  const DIFF = {
    easy:   { spd: 0.92, react: 1.6, tackle: 0.7,  aim: 1.4, gk: 0.86, pass: 0.85 },
    normal: { spd: 1.0,  react: 1.0, tackle: 1.0,  aim: 1.0, gk: 1.0,  pass: 1.0 },
    hard:   { spd: 1.05, react: 0.65, tackle: 1.25, aim: 0.8, gk: 1.08, pass: 1.1 }
  };

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

  // ---------- 입력 형식 ----------
  // 누르고 있는 값: mx,my(방향) sp(질주 E) sh(D) sl(C 등지기/조키) cq(Q)
  // 누른 횟수(카운터): pa(S) pq(Q+S) pz(Z+S) th(W) tq(Q+W) lo(A) lq(Q+A) sc(D) tk(Space) kn(Shift) rq(Q)
  // st: 마지막 D를 누를 때의 슛 종류 (0 일반, 1 감아차기, 2 칩슛, 3 파워슛)
  const COUNTERS = ['pa', 'pq', 'pz', 'th', 'tq', 'lo', 'lq', 'sc', 'tk', 'kn', 'rq'];
  const HELD = ['sp', 'sh', 'sl', 'cq'];
  const INPUT_KEYS = ['mx', 'my', ...HELD, ...COUNTERS, 'st'];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function emptyInput() { const o = {}; for (const k of INPUT_KEYS) o[k] = 0; for (const k of HELD) o[k] = false; return o; }
  function packInput(i) {
    return INPUT_KEYS.map(k => (k === 'mx' || k === 'my') ? Math.round((+i[k] || 0) * 100) / 100 : HELD.includes(k) ? (i[k] ? 1 : 0) : (i[k] | 0));
  }
  function unpackInput(a) {
    if (!Array.isArray(a)) return null;
    const o = {};
    INPUT_KEYS.forEach((k, j) => {
      const v = +a[j] || 0;
      if (k === 'mx' || k === 'my') o[k] = clamp(v, -1, 1);
      else if (HELD.includes(k)) o[k] = !!v;
      else o[k] = v | 0;
    });
    return o;
  }
  const EMPTY = emptyInput();

  // ---------- 도우미 ----------
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
  function nearestOpp(m, p) {
    let best = null, bd = 1e9;
    for (const o of m.players) { if (o.team === p.team) continue; const d = dist(o, p); if (d < bd) { bd = d; best = o; } }
    return best;
  }
  function resetBallSpin(b) { b.cx = 0; b.cy = 0; b.spinT = 0; }

  // ---------- 경기 생성 ----------
  function createMatch(o) {
    const m = {
      time: 0, duration: o.duration || 300, phase: 'kickoff', phaseT: 1.6,
      players: [], ball: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, cx: 0, cy: 0, spinT: 0 },
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
        pace: 0.6 + def.pac * 0.005, coop: false, gkRush: 0, oneTwo: null
      });
      for (let i = 0; i < PER_TEAM; i++) {
        m.players.push({
          id: side * PER_TEAM + i, team: side, idx: i, role: ROLES[i], num: NUMS[i], name: def.players[i],
          x: 0, y: 0, vx: 0, vy: 0, tvx: 0, tvy: 0, face: 0, faceLock: null,
          kickCD: 0, tackleCD: 0, stun: 0, charge: -1, shotType: 0, windup: null, buf: null, run: null,
          act: null, actT: 0, shield: false, jockey: false, think: 0, hold: 0, mustPass: false
        });
      }
    }
    setKickoff(m, Math.random() < 0.5 ? 0 : 1);
    say(m, '킥오프', `${m.teams[0].def.name} vs ${m.teams[1].def.name}`);
    return m;
  }

  function resetPlayerState(p) {
    p.vx = p.vy = p.tvx = p.tvy = 0; p.charge = -1; p.stun = 0; p.kickCD = 0; p.tackleCD = 0;
    p.hold = 0; p.mustPass = false; p.windup = null; p.buf = null; p.run = null; p.act = null; p.actT = 0;
    p.shield = false; p.jockey = false; p.faceLock = null;
  }

  function setKickoff(m, team) {
    for (const p of m.players) {
      const t = m.teams[p.team], k = KICKOFF[p.idx];
      p.x = k[0] * t.dir; p.y = k[1]; p.face = t.dir > 0 ? 0 : Math.PI;
      resetPlayerState(p);
    }
    const kt = m.teams[team];
    const st = player(m, team, 6); st.x = -0.7 * kt.dir; st.y = 0;
    const cm = player(m, team, 4); cm.x = -7 * kt.dir; cm.y = 5;
    st.mustPass = true; st.think = 0.4;
    Object.assign(m.ball, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }); resetBallSpin(m.ball);
    m.owner = st.id; m.poss = team; m.lastTouch = team; m.passTarget = -1;
    m.phase = 'kickoff'; m.phaseT = 1.6;
    for (const t of m.teams) { t.oneTwo = null; t.gkRush = 0; if (t.human) t.ctrl = t.side === team ? 6 : 4; }
    carryBall(m);
  }

  // ---------- 메인 스텝 ----------
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
      if (p.actT > 0) { p.actT -= dt; if (p.actT <= 0) p.act = null; }
      p.tvx = 0; p.tvy = 0; p.faceLock = null; p.jockey = false;
    }
    for (const t of m.teams) {
      if (t.gkRush > 0) t.gkRush -= dt;
      if (t.oneTwo) { t.oneTwo.t -= dt; if (t.oneTwo.t <= 0) t.oneTwo = null; }
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

  function syncLast(t, inp) {
    if (!inp) return;
    const l = t.last || (t.last = {});
    for (const k of COUNTERS) l[k] = inp[k] | 0;
    l.sh = !!inp.sh;
  }

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
      const sliding = p.act === 'slide' && p.actT > 0;
      if (sliding) { const v = 9 * p.actT / 0.65; p.tvx = Math.cos(p.face) * v; p.tvy = Math.sin(p.face) * v; }
      const ax = p.tvx - p.vx, ay = p.tvy - p.vy, a = hyp(ax, ay);
      const lim = sliding ? maxA * 3 : maxA;
      if (a > lim) { p.vx += ax / a * lim; p.vy += ay / a * lim; } else { p.vx = p.tvx; p.vy = p.tvy; }
      p.x = clamp(p.x + p.vx * dt, -HL - 3, HL + 3);
      p.y = clamp(p.y + p.vy * dt, -HW - 3, HW + 3);
      if (sliding) continue;
      let want = null;
      if (p.faceLock !== null) want = p.faceLock;
      else if (hyp(p.vx, p.vy) > 0.4) want = Math.atan2(p.vy, p.vx);
      if (want !== null) {
        const d = wrapAng(want - p.face);
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
    const into = (p.x + HL * t.dir) * t.dir;
    return into >= -1.5 && into <= 16.5 && Math.abs(p.y) <= 20.2;
  }
  function carryBall(m) {
    if (m.owner < 0) return;
    const p = m.players[m.owner], b = m.ball;
    if (p.role === 'GK' && inOwnBox(m, p)) {
      b.x = p.x + Math.cos(p.face) * 0.35; b.y = p.y + Math.sin(p.face) * 0.35; b.z = 1.05;
    } else {
      const d = p.shield ? 0.55 : 0.7 + Math.min(hyp(p.vx, p.vy), 8) * 0.04;
      b.x = p.x + Math.cos(p.face) * d; b.y = p.y + Math.sin(p.face) * d; b.z = 0;
    }
    b.vx = p.vx; b.vy = p.vy; b.vz = 0;
  }
  function ballPhysics(m, dt) {
    const b = m.ball;
    if (b.spinT > 0) { b.vx += b.cx * dt; b.vy += b.cy * dt; b.spinT -= dt; }
    if (b.z > 0 || b.vz > 0) b.vz -= G * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    if (b.z <= 0) {
      b.z = 0;
      if (b.vz < -1.5) { b.vz = -b.vz * 0.45; b.vx *= 0.82; b.vy *= 0.82; resetBallSpin(b); } else b.vz = 0;
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
      resetBallSpin(b);
      if (Math.abs(b.x) > HL + 1.8) { b.x = s * (HL + 1.8); b.vx *= -0.15; }
      b.y = clamp(b.y, -GOAL_HW + 0.2, GOAL_HW - 0.2);
      if (b.z > GOAL_H - 0.2) { b.z = GOAL_H - 0.2; b.vz = Math.min(0, b.vz); }
      b.vx *= 0.96; b.vy *= 0.9;
    }
  }
  function gainBall(m, p) {
    m.owner = p.id; m.poss = p.team; m.lastTouch = p.team; m.passTarget = -1;
    p.hold = 0; p.think = 0.15 + Math.random() * 0.1; p.charge = -1; p.windup = null;
    resetBallSpin(m.ball);
    const t = m.teams[p.team];
    if (!t.human) return;
    t.ctrl = p.idx;
    // 미리 눌러 둔 원터치 슛/패스
    if (p.buf && p.role !== 'GK') {
      const bf = p.buf; p.buf = null;
      if (bf.k === 'shoot') p.windup = { power: 0.6, type: bf.st, aim: bf.aim, t: 0.04 };
      else humanPass(m, p, t, bf.dir, bf.kind);
    }
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
        b.vz = 2 + Math.random() * 3; b.z = Math.max(b.z, 0.3); resetBallSpin(b);
        m.lastTouch = t.side; m.lastKicker = gk.id; gk.kickCD = 0.6; m.saveCD = 0.4; m.kicks++;
        if (s > 17) say(m, '선방!', gk.name + ' 쳐냄');
        return;
      }
      m.saveCD = 0.6; gk.stun = 0.5;
    }
  }

  // ---------- 킥 ----------
  function release(m, p) {
    m.owner = -1; p.kickCD = 0.3; p.charge = -1; p.hold = 0; p.mustPass = false; p.windup = null;
    m.lastTouch = p.team; m.lastKicker = p.id; m.kicks++;
  }
  // o: { acc, lob, speed(배수), T(체공시간) }
  function kickTo(m, p, tx, ty, o) {
    const b = m.ball;
    let dx = tx - b.x, dy = ty - b.y;
    const err = randn() * (1 - o.acc) * 0.12;
    const c = Math.cos(err), s = Math.sin(err);
    [dx, dy] = [dx * c - dy * s, dx * s + dy * c];
    const d = hyp(dx, dy) || 0.01;
    resetBallSpin(b);
    if (!o.lob) {
      const v = clamp((0.75 * d + 6) * (o.speed || 1), 8, o.speed > 1 ? 34 : 27);
      b.vx = dx / d * v; b.vy = dy / d * v; b.vz = 0;
    } else {
      const T = o.T || clamp(d / 19, 0.75, 1.9);
      const v = d * 0.9 / (T * (1 - 0.03 * T));
      b.vx = dx / d * v; b.vy = dy / d * v; b.vz = G * T / 2 - b.z / T; b.z = Math.max(b.z, 0.05);
    }
    release(m, p);
  }

  // kind: ground, strong, through, throughLob, lob, early, cross, throw, long
  function passTo(m, p, q, kind) {
    const t = m.teams[p.team];
    const acc = clamp(t.def.pas / 100 * t.diff.pass, 0.5, 0.98);
    const d = dist(p, q);
    let lead = d / 18, tx, ty, extraX = 0, latMul = 1;
    const o = { acc };
    switch (kind) {
      case 'strong': o.speed = 1.35; lead = d / 24; break;
      case 'through': o.speed = 1.08; lead = d / 16; extraX = 7; latMul = 0.5; break;
      case 'throughLob': o.lob = true; lead = d / 19 + 0.3; extraX = 8; latMul = 0.5; break;
      case 'lob': case 'long': o.lob = true; lead = d / 19 + 0.3; break;
      case 'early': o.lob = true; o.T = clamp(d / 27, 0.5, 1.2); lead = d / 24; break;
      case 'throw': o.lob = true; o.T = clamp(d / 24, 0.45, 1.0); lead = d / 20; break;
    }
    tx = q.x + q.vx * lead + t.dir * extraX;
    ty = q.y + q.vy * lead * latMul;
    tx = clamp(tx, -HL + 1, HL - 1); ty = clamp(ty, -HW + 1, HW - 1);
    kickTo(m, p, tx, ty, o);
    m.passTarget = q.id; m.passT = 0;
    if (extraX) q.run = { x: tx, y: ty, t: 2.5 };
    if (t.human) t.ctrl = q.idx;
  }
  function crossTo(m, p, early) {
    const t = m.teams[p.team], gx = HL * t.dir;
    let best = null, bd = 1e9;
    for (const q of m.players) {
      if (q.team !== p.team || q.id === p.id || q.role === 'GK') continue;
      const d = hyp(q.x - (gx - t.dir * 10), q.y);
      if (d < bd) { bd = d; best = q; }
    }
    if (!best) return false;
    const tx = gx - t.dir * (7 + Math.random() * 5), ty = clamp(best.y * 0.5, -6, 6);
    const acc = clamp(t.def.pas / 100 * t.diff.pass, 0.5, 0.98);
    const d = hyp(tx - m.ball.x, ty - m.ball.y);
    kickTo(m, p, tx, ty, { acc, lob: true, T: early ? clamp(d / 27, 0.6, 1.2) : clamp(d / 19, 0.9, 1.7) });
    m.passTarget = best.id; m.passT = 0; best.run = { x: tx, y: ty, t: 2.2 };
    if (t.human) t.ctrl = best.idx;
    return true;
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
  // 사람이 하는 패스 (2대1 리턴 패스 우선)
  function humanPass(m, p, t, dir, kind) {
    const attThird = (p.x * t.dir) > HL - 35 && Math.abs(p.y) > 13;
    if ((kind === 'lob' || kind === 'early') && attThird && !(t.oneTwo && t.oneTwo.id !== p.id)) return crossTo(m, p, kind === 'early');
    let q = null;
    if (t.oneTwo && t.oneTwo.id !== p.id) {
      const r = m.players[t.oneTwo.id];
      const dx = r.x - p.x, dy = r.y - p.y, d = hyp(dx, dy) || 1;
      if (d > 3 && (dx * dir.x + dy * dir.y) / d > -0.3) q = r;
    }
    if (q) { t.oneTwo = null; kind = kind === 'lob' || kind === 'early' || kind === 'throughLob' ? 'throughLob' : 'through'; }
    else q = pickBestMate(m, p, dir).q;
    if (!q) return false;
    passTo(m, p, q, kind);
    return true;
  }

  // type: 0 일반, 1 감아차기, 2 칩슛, 3 파워슛, 4 로우슛, 5 헤딩/발리
  function doShoot(m, p, power, aimY, type) {
    const t = m.teams[p.team], b = m.ball;
    const gx = HL * t.dir;
    const gk = player(m, 1 - p.team, 0);
    const aimed = aimY !== null && aimY !== undefined && Math.abs(aimY) > 0.3;
    let ty = aimed ? Math.sign(aimY) * 2.6 : (gk.y > 0 ? -2.3 : 2.3);
    if (type === 1 && !aimed) ty = (p.y > 0 ? -1 : 1) * 2.7;
    const acc = t.def.sho / 100;
    const dd = hyp(gx - p.x, ty - p.y);
    let sig = ((1 - acc) * 2.2 + power * power * 1.1 + dd / 28) * t.diff.aim;
    let speed = (15 + power * 15) * (0.85 + acc * 0.2), h = 0.35 + power * 1.3, wild = true;
    switch (type) {
      case 1: sig *= 0.55; speed *= 0.8; h = 0.7 + power * 0.8; break;
      case 2: sig *= 0.75; speed = 9 + power * 6; h = 1.9; wild = false; break;
      case 3: speed *= 1.2; sig *= 1.25; h = 0.5 + power * 1.4; break;
      case 4: sig *= 0.85; speed *= 0.95; h = 0.12; wild = false; break;
      case 5: sig *= 0.9; speed = 10 + power * 9; h = 0.6 + power; break;
    }
    ty += randn() * sig * 0.55;
    let aimTy = ty;
    if (type === 1) aimTy = ty + Math.sign(ty || 1) * 2.2;
    const dx = gx - b.x, dy = aimTy - b.y, d = hyp(dx, dy) || 1;
    const T = d / (speed * 0.95);
    if (wild) h += Math.abs(randn()) * sig * 0.25 + (power > 0.85 ? (power - 0.85) * 6 * Math.random() : 0);
    b.vx = dx / d * speed; b.vy = dy / d * speed; b.vz = G * T / 2 + (h - b.z) / T; b.z = Math.max(b.z, 0.1);
    if (type === 4) { b.vz = 0.6; b.z = 0.05; }
    resetBallSpin(b);
    if (type === 1) { b.cy = 2 * (ty - aimTy) / (T * T); b.spinT = T; }
    release(m, p);
    m.stats.shots[p.team]++; m.passTarget = -1;
  }
  function knockOn(m, p, dir) {
    const b = m.ball;
    b.vx = dir.x * 9 + p.vx * 0.3; b.vy = dir.y * 9 + p.vy * 0.3; b.vz = 0; b.z = 0; resetBallSpin(b);
    release(m, p); p.kickCD = 0.28;
    m.passTarget = p.id; m.passT = 0;
  }
  function requestRun(m, t, p) {
    let best = null, bx = -1e9;
    for (let i = 1; i < PER_TEAM; i++) {
      const q = player(m, t.side, i);
      if (q === p) continue;
      const ax = q.x * t.dir; if (ax > bx) { bx = ax; best = q; }
    }
    if (best) best.run = { x: clamp(best.x + t.dir * 14, -HL + 4, HL - 4), y: best.y * 0.6, t: 2.5 };
  }

  function tackleChance(m, p, o, base) {
    const t = m.teams[p.team], ot = m.teams[o.team];
    const behind = ((p.x - o.x) * Math.cos(o.face) + (p.y - o.y) * Math.sin(o.face)) < -0.3;
    let ch = base + (t.def.def - 80) * 0.012 - (ot.def.pac - 80) * 0.004 + (behind ? -0.15 : 0.05);
    if (o.shield) ch -= behind ? 0.2 : 0.08;
    ch *= t.diff.tackle;
    if (o.role === 'GK' && inOwnBox(m, o)) ch = 0;
    return clamp(ch, 0, 0.85);
  }
  function knockLoose(m, p, speed) {
    const b = m.ball; m.owner = -1;
    b.vx = Math.cos(p.face) * speed + (Math.random() - 0.5) * 3; b.vy = Math.sin(p.face) * speed + (Math.random() - 0.5) * 3;
    b.vz = 0.4; resetBallSpin(b);
    m.lastTouch = p.team; m.lastKicker = p.id; m.kicks++; m.passTarget = -1;
  }
  function trip(o, t) { o.stun = t; o.kickCD = 0.5; o.charge = -1; o.windup = null; o.act = 'fall'; o.actT = t; }
  function tryTackle(m, p) {
    if (p.tackleCD > 0) return;
    p.tackleCD = 0.8;
    const o = m.owner >= 0 ? m.players[m.owner] : null;
    if (!o || o.team === p.team) return;
    if (dist(p, o) > 2.1) { p.stun = 0.15; return; }
    if (Math.random() < tackleChance(m, p, o, 0.42)) {
      if (Math.random() < 0.5) gainBall(m, p); else { knockLoose(m, p, 5); p.kickCD = 0.25; }
      trip(o, 0.6);
    } else p.stun = 0.55;
  }
  function slideTackle(m, p) {
    if (p.tackleCD > 0 || p.stun > 0) return;
    p.tackleCD = 1.4; p.act = 'slide'; p.actT = 0.65;
    const fx = Math.cos(p.face), fy = Math.sin(p.face);
    const o = m.owner >= 0 ? m.players[m.owner] : null;
    if (o && o.team !== p.team) {
      const dx = o.x - p.x, dy = o.y - p.y, d = hyp(dx, dy) || 1;
      if (d < 3.6 && (dx * fx + dy * fy) / d > 0.4 && Math.random() < tackleChance(m, p, o, 0.5)) {
        knockLoose(m, p, 8); trip(o, 0.9); p.stun = 0.6; return;
      }
    } else if (!o) {
      const b = m.ball, dx = b.x - p.x, dy = b.y - p.y, d = hyp(dx, dy) || 1;
      if (d < 3 && b.z < 1 && (dx * fx + dy * fy) / d > 0.4) { knockLoose(m, p, 9); p.stun = 0.6; return; }
    }
    p.stun = 1.0;
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
    const e = {};
    for (const k of COUNTERS) e[k] = (inp[k] | 0) > t.last[k];
    const shDown = !!inp.sh && !t.last.sh, shUp = !inp.sh && t.last.sh;
    syncLast(t, inp);
    t.coop = !!inp.cq;

    const ownerP = m.owner >= 0 ? m.players[m.owner] : null;
    const weHave = !!ownerP && ownerP.team === t.side;
    const ourLoose = !ownerP && m.lastTouch === t.side;
    const defending = !weHave && !ourLoose;

    // 수비 중 S = 선수 변경
    if (defending && (e.pa || e.pq || e.pz)) t.ctrl = nearestOutfield(m, t.side, t.ctrl).idx;
    if (t.ctrl < 0) t.ctrl = nearestOutfield(m, t.side, -1).idx;
    let p = player(m, t.side, t.ctrl);
    if (p.role === 'GK' && m.owner !== p.id) { t.ctrl = nearestOutfield(m, t.side, 0).idx; p = player(m, t.side, t.ctrl); }

    let mx = clamp(+inp.mx || 0, -1, 1), my = clamp(+inp.my || 0, -1, 1);
    let ml = hyp(mx, my); if (ml > 1) { mx /= ml; my /= ml; ml = 1; }
    const dir = ml > 0.2 ? { x: mx / ml, y: my / ml } : { x: Math.cos(p.face), y: Math.sin(p.face) };
    const has = m.owner === p.id;
    if (p.act === 'slide' && p.actT > 0) return;
    if (p.buf) { p.buf.t -= dt; if (p.buf.t <= 0) p.buf = null; }

    if (has) {
      // ----- 골키퍼가 공을 잡고 있을 때 -----
      if (p.role === 'GK') {
        p.hold += dt;
        if (ml > 0.15) { const s = speedOf(m, p, false) * 0.6; p.tvx = mx * s; p.tvy = my * s; }
        if (e.pa || e.pq || e.pz) humanPass(m, p, t, dir, 'ground');
        else if (e.th || e.tq) humanPass(m, p, t, dir, 'throw');
        else if (e.lo || e.lq || e.sc || p.hold > 5) { const r = pickBestMate(m, p, { x: t.dir, y: dir.y * 0.5 }); if (r.q) passTo(m, p, r.q, 'long'); }
        return;
      }
      // ----- 이동: C 등지기·느린 드리블 / E 질주 -----
      let spd;
      if (inp.sl) {
        p.shield = true; spd = speedOf(m, p, false) * 0.5;
        if (ml < 0.15) { const o = nearestOpp(m, p); if (o && dist(o, p) < 5) p.faceLock = Math.atan2(p.y - o.y, p.x - o.x); }
      } else { p.shield = false; spd = speedOf(m, p, !!inp.sp && p.charge < 0 && !p.windup); }
      if (ml > 0.15) { p.tvx = mx * spd; p.tvy = my * spd; }

      // ----- 슛 동작 중 (D를 한 번 더 = 로우 슛) -----
      if (p.windup) {
        if (e.sc) p.windup.type = 4;
        p.windup.t -= dt;
        if (p.windup.t <= 0) { const w = p.windup; p.windup = null; doShoot(m, p, w.power, w.aim, w.type); }
        return;
      }
      if (e.pq) { if (humanPass(m, p, t, dir, 'ground')) { t.oneTwo = { id: p.id, t: 3.5 }; p.run = { x: clamp(p.x + t.dir * 14, -HL + 3, HL - 3), y: p.y * 0.75, t: 2.6 }; } return; }
      if (e.pa) { humanPass(m, p, t, dir, 'ground'); return; }
      if (e.pz) { humanPass(m, p, t, dir, 'strong'); return; }
      if (e.tq) { humanPass(m, p, t, dir, 'throughLob'); return; }
      if (e.th) { humanPass(m, p, t, dir, 'through'); return; }
      if (e.lq) { humanPass(m, p, t, dir, 'early'); return; }
      if (e.lo) { humanPass(m, p, t, dir, 'lob'); return; }
      if (e.kn && ml > 0.2) { knockOn(m, p, dir); return; }
      if (e.rq) requestRun(m, t, p);
      if (shDown) { p.charge = 0; p.shotType = inp.st | 0; }
      else if (inp.sh && p.charge >= 0) p.charge = Math.min(1.2, p.charge + dt);
      else if (shUp && p.charge >= 0) {
        const pw = Math.min(1, p.charge / 0.9);
        p.windup = { power: pw, type: p.shotType, aim: my, t: p.shotType === 3 ? 0.3 : 0.14 };
        p.charge = -1;
      }
      return;
    }

    // ----- 공이 없을 때 -----
    p.shield = false; p.charge = -1; p.windup = null;
    const carrier = ownerP && ownerP.team !== t.side ? ownerP : null;
    if (inp.sh && carrier) {
      // D 누르고 있기 = 압박
      steerTo(p, carrier.x, carrier.y, speedOf(m, p, !!inp.sp) * 1.02);
      p.faceLock = Math.atan2(carrier.y - p.y, carrier.x - p.x);
    } else if (inp.sl && carrier) {
      // C = 조키 수비 (C+E 빠른 조키)
      p.jockey = true;
      const js = speedOf(m, p, false) * (inp.sp ? 0.85 : 0.6);
      if (ml > 0.15) { p.tvx = mx * js; p.tvy = my * js; }
      else {
        const gx = -HL * t.dir, vx = gx - carrier.x, vy = -carrier.y, vl = hyp(vx, vy) || 1;
        steerTo(p, carrier.x + vx / vl * 2.6, carrier.y + vy / vl * 2.6, js * 1.3);
      }
      p.faceLock = Math.atan2(carrier.y - p.y, carrier.x - p.x);
    } else if (ml > 0.15) {
      const s = speedOf(m, p, !!inp.sp); p.tvx = mx * s; p.tvy = my * s;
    } else if (m.owner < 0 && (m.passTarget === p.id || dist(p, m.ball) < 6)) {
      const s = speedOf(m, p, !!inp.sp); const ip = interceptPoint(m, p, s); steerTo(p, ip.x, ip.y, s);
    }

    if (!defending) {
      // 우리 패스가 오는 중: 원터치 슛/패스, 헤딩 예약
      if (e.sc) p.buf = { k: 'shoot', t: 0.45, st: inp.st | 0, aim: my };
      else if (e.pa || e.pq || e.pz) p.buf = { k: 'pass', t: 0.45, dir, kind: e.pz ? 'strong' : 'ground' };
      else if (e.lo || e.lq) p.buf = { k: 'pass', t: 0.45, dir, kind: e.lq ? 'early' : 'lob' };
      else if (e.th || e.tq) p.buf = { k: 'pass', t: 0.45, dir, kind: e.tq ? 'throughLob' : 'through' };
    } else {
      if (e.sc && carrier && dist(p, carrier) < 2.1) tryTackle(m, p);
      else if (e.sc && !carrier) p.buf = { k: 'shoot', t: 0.45, st: 0, aim: my }; // 걷어내기
      if (e.tk) tryTackle(m, p);
      if (e.lo) slideTackle(m, p);
      if (e.th) t.gkRush = 1.6;
    }

    // 공중볼 헤딩 / 발리
    if (p.buf && m.owner < 0 && p.kickCD <= 0) {
      const b = m.ball;
      if (b.z > 1.1 && b.z < 2.8 && hyp(p.x - b.x, p.y - b.y) < 1.6) {
        const bf = p.buf; p.buf = null;
        if (bf.k === 'shoot') doShoot(m, p, 0.6, bf.aim, 5);
        else { const q = pickBestMate(m, p, bf.dir).q; if (q) passTo(m, p, q, 'ground'); }
      }
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
    const ctrlP = t.human && t.ctrl >= 0 ? player(m, side, t.ctrl) : null;

    let chaser = null, helper = null;
    if (!(owner && owner.team === side)) {
      const ownPass = !owner && m.passTarget >= 0 && m.players[m.passTarget].team === side && m.passT < 3;
      if (!ownPass) {
        const ctrlNear = ctrlP && dist(ctrlP, m.ball) < 10;
        if (!ctrlNear) {
          let bd = 1e9;
          for (let i = 1; i < PER_TEAM; i++) {
            if (t.human && i === t.ctrl) continue;
            const q = player(m, side, i); const d = dist(q, m.ball);
            if (d < bd) { bd = d; chaser = q; }
          }
        }
        // Q 누르고 있기 = 협력 수비
        if (t.human && t.coop && owner && owner.team !== side) {
          let bd = 1e9;
          for (let i = 1; i < PER_TEAM; i++) {
            if (i === t.ctrl) continue;
            const q = player(m, side, i); if (q === chaser) continue;
            const d = dist(q, owner); if (d < bd) { bd = d; helper = q; }
          }
        }
      }
    }

    for (let i = 0; i < PER_TEAM; i++) {
      const p = player(m, side, i);
      if (t.human && i === t.ctrl) continue;
      p.think -= dt;
      if (p.act === 'slide' && p.actT > 0) continue;
      if (p.role === 'GK') { aiGK(m, p, t, dt); continue; }
      if (owner === p) { aiCarrier(m, p, t, dt); continue; }
      const sp = speedOf(m, p, false), spS = speedOf(m, p, true);
      if (m.passTarget === p.id && !owner) { const ip = interceptPoint(m, p, spS); steerTo(p, ip.x, ip.y, spS); continue; }
      if (p === chaser || p === helper) {
        if (owner) {
          const gx = -HL * t.dir; const dx = gx - owner.x, dy = -owner.y, d = hyp(dx, dy) || 1;
          steerTo(p, owner.x + dx / d * 0.8, owner.y + dy / d * 0.8, spS);
          if (dist(p, owner) < 1.8 && p.tackleCD <= 0 && Math.random() < dt * 2.2 * t.diff.tackle) tryTackle(m, p);
        } else { const ip = interceptPoint(m, p, spS); steerTo(p, ip.x, ip.y, spS); }
        continue;
      }
      if (p.run) {
        if (!weHave || p.run.t <= 0) p.run = null;
        else { p.run.t -= dt; steerTo(p, p.run.x, p.run.y, spS); continue; }
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
    const ahead = (r.q.x - p.x) * m.teams[p.team].dir > 6;
    passTo(m, p, r.q, lane < 1.5 && dist(p, r.q) > 16 ? 'lob' : (ahead && lane > 3 && Math.random() < 0.35 ? 'through' : 'ground'));
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
      if (Math.random() < chance) {
        const r = Math.random(), type = r < 0.15 ? 1 : r < 0.22 ? 4 : 0;
        doShoot(m, p, clamp(0.45 + dG / 40 + Math.random() * 0.2, 0.4, 0.95), null, type); return;
      }
    }
    if (p.x * dir > HL - 30 && Math.abs(p.y) > 16 && Math.random() < 0.3) { if (crossTo(m, p, Math.random() < 0.4)) return; }
    if (near < 3.2 && Math.random() < 0.65) { if (aiPass(m, p, -1e9)) return; }
    if (Math.random() < 0.22) aiPass(m, p, 2.4);
  }

  function aiGK(m, gk, t, dt) {
    const dir = t.dir, gx = -HL * dir, b = m.ball;
    if (m.owner === gk.id) {
      gk.hold += dt;
      if (gk.hold > 1.2) { if (!aiPass(m, gk, 1.6)) passTo(m, gk, player(m, t.side, 6), 'long'); }
      return;
    }
    // W = 골키퍼 차출
    if (t.gkRush > 0) { steerTo(gk, clamp(b.x, -HL + 1, HL - 1), clamp(b.y, -20, 20), 8.5 * t.diff.gk); return; }
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
        b.x = s * (HL - 0.15); b.vx = -b.vx * 0.55; b.vy += (Math.random() - 0.5) * 4; resetBallSpin(b);
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
    const b = m.ball; Object.assign(b, { x, y, z: 0, vx: 0, vy: 0, vz: 0 }); resetBallSpin(b);
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
    for (const p of m.players) resetPlayerState(p);
    for (const tt of m.teams) { tt.oneTwo = null; tt.gkRush = 0; }
    taker.x = x - Math.cos(face) * 0.7; taker.y = y - Math.sin(face) * 0.7; taker.face = face;
    taker.think = 0.3; taker.mustPass = true;
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
    for (const p of m.players) { p.act = null; p.actT = 0; }
  }
  function celebrate(m, dt) {
    for (const p of m.players) { p.tvx = 0; p.tvy = 0; p.faceLock = null; }
    const sc = m.scorer >= 0 ? m.players[m.scorer] : null;
    if (sc && sc.team === m.scoringSide) {
      const s = Math.sign(sc.x) || 1;
      steerTo(sc, s * (HL - 3), (Math.sign(sc.y) || 1) * (HW - 3), 7.5);
      for (const p of m.players) if (p.team === sc.team && p !== sc && p.role !== 'GK' && dist(p, sc) < 30) steerTo(p, sc.x, sc.y, 6.5);
    }
    movePlayers(m, dt); separate(m);
  }

  // ---------- 전송용 스냅샷 ----------
  // 선수 1명당 [x, y, 방향, 속도, 동작] (동작: 0 없음, 1 슬라이딩, 2 넘어짐, 3 등지기/조키)
  const STRIDE = 5;
  function snapshot(m) {
    const p = new Array(m.players.length * STRIDE);
    for (let i = 0; i < m.players.length; i++) {
      const q = m.players[i], o = i * STRIDE;
      p[o] = r2(q.x); p[o + 1] = r2(q.y); p[o + 2] = r2(q.face); p[o + 3] = r2(hyp(q.vx, q.vy));
      p[o + 4] = q.act === 'slide' ? 1 : q.act === 'fall' ? 2 : (q.shield || q.jockey) ? 3 : 0;
    }
    const ch = m.teams.map(t => (t.ctrl >= 0 ? r2(player(m, t.side, t.ctrl).charge) : -1));
    return {
      p, b: [r2(m.ball.x), r2(m.ball.y), r2(m.ball.z)], o: m.owner,
      s: [m.teams[0].score, m.teams[1].score], tm: Math.round(m.time * 10) / 10, d: m.duration,
      ph: m.phase, c: [m.teams[0].ctrl, m.teams[1].ctrl], ch, msg: m.msg, k: m.kicks,
      st: [Math.round(m.stats.poss[0]), Math.round(m.stats.poss[1]), m.stats.shots[0], m.stats.shots[1]]
    };
  }

  return {
    TEAMS, ROLES, NUMS, PER_TEAM, DT, HL, HW, GOAL_HW, GOAL_H, DIFF, STRIDE,
    COUNTERS, INPUT_KEYS, emptyInput, packInput, unpackInput,
    createMatch, step, snapshot
  };
});
