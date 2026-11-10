/*
 * PITCH ONLINE - 화면(Three.js 3D 중계 시점), 메뉴, 조작, 온라인 연결
 */
(() => {
  'use strict';
  const S = window.Sim;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const N = S.PER_TEAM * 2;

  const G = {
    mode: null, playing: false, paused: false, match: null, snap: null, side: 0, teams: [0, 1],
    ws: null, endShown: false, lastMsgId: -1, lastKicks: 0, aiOpts: null, roomCode: null
  };

  // =====================================================================
  // 소리 (모두 코드로 합성 - 외부 파일 없음)
  // =====================================================================
  const Snd = {
    ctx: null, crowdGain: null,
    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      try {
        const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
        let last = 0;
        for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
        const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
        const g = this.crowdGain = ctx.createGain(); g.gain.value = 0;
        src.connect(lp); lp.connect(g); g.connect(ctx.destination); src.start();
      } catch (e) { this.ctx = null; }
    },
    crowd(level, time) {
      if (!this.ctx) return;
      const g = this.crowdGain.gain, t = this.ctx.currentTime;
      g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(level, t + (time || 1.2));
    },
    whistle(n) {
      if (!this.ctx) return;
      const ctx = this.ctx; let t = ctx.currentTime + 0.02; n = n || 1;
      for (let i = 0; i < n; i++) {
        const o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), g = ctx.createGain();
        o.frequency.value = 2800; lfo.frequency.value = 38; lg.gain.value = 120;
        lfo.connect(lg); lg.connect(o.frequency);
        const dur = (n > 1 && i === n - 1) ? 0.7 : 0.3;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 0.02);
        g.gain.setValueAtTime(0.06, t + dur - 0.05); g.gain.linearRampToValueAtTime(0, t + dur);
        o.connect(g); g.connect(ctx.destination);
        o.start(t); lfo.start(t); o.stop(t + dur); lfo.stop(t + dur);
        t += dur + 0.12;
      }
    },
    kick() {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.09);
      g.gain.setValueAtTime(0.28, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.13);
    },
    goal() { this.crowd(0.55, 0.3); clearTimeout(this._gt); this._gt = setTimeout(() => this.crowd(G.playing ? 0.1 : 0.03, 2.5), 2800); }
  };

  // =====================================================================
  // 조작: 키보드 / 게임패드 / 터치
  // =====================================================================
  const inp = { mx: 0, my: 0, sp: false, pa: 0, lo: 0, sw: 0, sh: false };
  const keys = Object.create(null);
  const K = { pa: ['KeyJ', 'KeyZ'], sh: ['KeyK', 'KeyX'], lo: ['KeyL', 'KeyC'], sw: ['KeyQ', 'Space'] };
  const BLOCK = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', ...K.pa, ...K.sh, ...K.lo, ...K.sw]);

  addEventListener('keydown', e => {
    if (!G.playing) return;
    if (e.code === 'Escape') { togglePause(); return; }
    if (BLOCK.has(e.code)) e.preventDefault();
    if (e.repeat || G.paused) return;
    keys[e.code] = true;
    if (K.pa.includes(e.code)) inp.pa++;
    if (K.lo.includes(e.code)) inp.lo++;
    if (K.sw.includes(e.code)) inp.sw++;
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  const touch = { id: null, x: 0, y: 0, sprint: false, sh: false, cx: 0, cy: 0 };
  const isTouch = matchMedia('(pointer: coarse)').matches;
  (function setupTouch() {
    const zone = $('#joy-zone'), base = $('#joy-base'), knob = $('#joy-knob');
    const R = 55;
    zone.addEventListener('pointerdown', e => {
      if (touch.id !== null) return;
      touch.id = e.pointerId; zone.setPointerCapture(e.pointerId);
      touch.cx = e.clientX; touch.cy = e.clientY;
      base.style.left = e.clientX + 'px'; base.style.top = e.clientY + 'px'; base.style.opacity = '1';
      touch.x = touch.y = 0; knob.style.transform = '';
    });
    zone.addEventListener('pointermove', e => {
      if (e.pointerId !== touch.id) return;
      let dx = (e.clientX - touch.cx) / R, dy = (e.clientY - touch.cy) / R;
      const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
      touch.x = Math.abs(dx) < 0.12 ? 0 : dx; touch.y = Math.abs(dy) < 0.12 ? 0 : dy;
      knob.style.transform = `translate(${dx * R}px, ${dy * R}px)`;
    });
    const end = e => {
      if (e.pointerId !== touch.id) return;
      touch.id = null; touch.x = touch.y = 0; knob.style.transform = ''; base.style.opacity = '';
    };
    zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
    for (const b of $$('#tbtns .tb')) {
      const act = b.dataset.act;
      b.addEventListener('pointerdown', e => {
        e.preventDefault(); b.classList.add('down'); Snd.init();
        if (act === 'pa') inp.pa++; else if (act === 'lo') inp.lo++; else if (act === 'sw') inp.sw++;
        else if (act === 'sh') touch.sh = true; else if (act === 'sprint') touch.sprint = true;
      });
      const up = () => { b.classList.remove('down'); if (act === 'sh') touch.sh = false; if (act === 'sprint') touch.sprint = false; };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
    }
    $('#touch').addEventListener('contextmenu', e => e.preventDefault());
  })();

  let padPrev = [];
  function pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const b = i => !!(gp.buttons[i] && gp.buttons[i].pressed);
      const edge = i => b(i) && !padPrev[i];
      let ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      if (Math.hypot(ax, ay) < 0.2) ax = ay = 0;
      if (b(14)) ax = -1; if (b(15)) ax = 1; if (b(12)) ay = -1; if (b(13)) ay = 1;
      if (edge(0)) inp.pa++;
      if (edge(3)) inp.lo++;
      if (edge(4)) inp.sw++;
      if (edge(9)) togglePause();
      padPrev = gp.buttons.map(x => x.pressed);
      return { ax, ay, sh: b(1), sp: b(5) || b(7) };
    }
    return null;
  }

  function updateInput() {
    let mx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    let my = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
    let sp = !!(keys.ShiftLeft || keys.ShiftRight), sh = !!(keys.KeyK || keys.KeyX);
    if (touch.id !== null) { mx = touch.x; my = touch.y; }
    sp = sp || touch.sprint; sh = sh || touch.sh;
    const gp = pollPad();
    if (gp) { if (gp.ax || gp.ay) { mx = gp.ax; my = gp.ay; } sp = sp || gp.sp; sh = sh || gp.sh; }
    const l = Math.hypot(mx, my); if (l > 1) { mx /= l; my /= l; }
    if (G.paused) { mx = my = 0; sp = sh = false; }
    inp.mx = mx; inp.my = my; inp.sp = sp; inp.sh = sh;
  }

  // =====================================================================
  // 3D 장면
  // =====================================================================
  if (typeof THREE === 'undefined') {
    document.body.insertAdjacentHTML('beforeend', '<div style="position:fixed;inset:0;display:grid;place-items:center;z-index:99;background:#0a1220;color:#fff;font:700 18px sans-serif;text-align:center;padding:20px">3D 라이브러리를 불러오지 못했어요.<br>인터넷 연결을 확인하고 새로고침해 주세요.</div>');
    return;
  }

  const canvas = $('#view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1424);
  scene.fog = new THREE.Fog(0x0b1424, 130, 280);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 700);
  scene.add(new THREE.HemisphereLight(0xe4eeff, 0x2a4a22, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 0.75); sun.position.set(-30, 80, 40); scene.add(sun);

  function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }

  // ---- 잔디와 라인 ----
  (function buildPitch() {
    const MW = 115, MH = 78, W = 2048, H = Math.round(W * MH / MW), s = W / MW;
    const [c, g] = makeCanvas(W, H);
    const X = x => (x + MW / 2) * s, Y = y => (y + MH / 2) * s;
    g.fillStyle = '#2f7d32'; g.fillRect(0, 0, W, H);
    const n = 18;
    for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? '#3f9a3e' : '#378c37'; g.fillRect(X(-S.HL + i * 105 / n), Y(-S.HW - 2), 105 / n * s + 1, 72 * s); }
    for (let i = 0; i < 14000; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`; g.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
    g.strokeStyle = 'rgba(255,255,255,.92)'; g.fillStyle = '#fff'; g.lineWidth = 0.14 * s;
    const rect = (x1, y1, x2, y2) => g.strokeRect(X(Math.min(x1, x2)), Y(Math.min(y1, y2)), Math.abs(x2 - x1) * s, Math.abs(y2 - y1) * s);
    const dot = (x, y) => { g.beginPath(); g.arc(X(x), Y(y), 0.25 * s, 0, Math.PI * 2); g.fill(); };
    rect(-S.HL, -S.HW, S.HL, S.HW);
    g.beginPath(); g.moveTo(X(0), Y(-S.HW)); g.lineTo(X(0), Y(S.HW)); g.stroke();
    g.beginPath(); g.arc(X(0), Y(0), 9.15 * s, 0, Math.PI * 2); g.stroke();
    dot(0, 0);
    const a = Math.acos(5.5 / 9.15);
    for (const sd of [-1, 1]) {
      const gx = sd * S.HL;
      rect(gx, -20.16, gx - sd * 16.5, 20.16);
      rect(gx, -9.16, gx - sd * 5.5, 9.16);
      const px = gx - sd * 11; dot(px, 0);
      g.beginPath();
      if (sd > 0) g.arc(X(px), Y(0), 9.15 * s, Math.PI - a, Math.PI + a); else g.arc(X(px), Y(0), 9.15 * s, -a, a);
      g.stroke();
    }
    g.save(); g.beginPath(); g.rect(X(-S.HL), Y(-S.HW), 105 * s, 68 * s); g.clip();
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) { g.beginPath(); g.arc(X(sx * S.HL), Y(sy * S.HW), 1 * s, 0, Math.PI * 2); g.stroke(); }
    g.restore();
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(MW, MH), new THREE.MeshLambertMaterial({ map: tex }));
    pitch.rotation.x = -Math.PI / 2; scene.add(pitch);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshLambertMaterial({ color: 0x1d4422 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; scene.add(ground);
  })();

  // ---- 관중석 ----
  let crowdTex; const standTexes = [];
  (function buildStadium() {
    const [c, g] = makeCanvas(512, 256);
    g.fillStyle = '#18202e'; g.fillRect(0, 0, 512, 256);
    const shirts = ['#d32f2f', '#1b2a6b', '#ffffff', '#ffca28', '#4fc3f7', '#7b1fa2', '#2e7d32', '#ff7043', '#eceff1', '#212121'];
    const skins = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
    for (let row = 0; row < 16; row++) {
      g.fillStyle = row % 2 ? '#222c3d' : '#1c2534'; g.fillRect(0, row * 16, 512, 16);
      for (let x = 2; x < 512; x += 8) {
        if (Math.random() < 0.12) continue;
        g.fillStyle = shirts[Math.floor(Math.random() * shirts.length)]; g.fillRect(x, row * 16 + 7, 6, 8);
        g.fillStyle = skins[Math.floor(Math.random() * skins.length)]; g.fillRect(x + 1, row * 16 + 2, 4, 5);
      }
    }
    crowdTex = new THREE.CanvasTexture(c);
    crowdTex.wrapS = crowdTex.wrapT = THREE.RepeatWrapping;
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x141c2b });
    const backMat = new THREE.MeshLambertMaterial({ color: 0x0e1522 });
    function stand(len, x, z, rot) {
      const grp = new THREE.Group(), depth = 18, rise = 14, L = Math.hypot(depth, rise), ang = Math.atan2(rise, depth);
      const tex = crowdTex.clone(); tex.needsUpdate = true; tex.repeat.set(len / 20, 2.2); standTexes.push(tex);
      const slope = new THREE.Mesh(new THREE.PlaneGeometry(len, L), new THREE.MeshBasicMaterial({ map: tex }));
      slope.rotation.x = -(Math.PI / 2 - ang); slope.position.set(0, 1.6 + rise / 2, -depth / 2); grp.add(slope);
      const wall = new THREE.Mesh(new THREE.BoxGeometry(len, 1.6, 0.4), wallMat); wall.position.set(0, 0.8, 0); grp.add(wall);
      const back = new THREE.Mesh(new THREE.BoxGeometry(len, 7, 0.8), backMat); back.position.set(0, 1.6 + rise + 3.5, -depth); grp.add(back);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(len, 0.5, 12), backMat); roof.position.set(0, 1.6 + rise + 7, -depth + 5); grp.add(roof);
      grp.position.set(x, 0, z); grp.rotation.y = rot; scene.add(grp);
    }
    stand(140, 0, -S.HW - 9, 0);
    stand(140, 0, S.HW + 9, Math.PI);
    stand(92, S.HL + 11, 0, -Math.PI / 2);
    stand(92, -S.HL - 11, 0, Math.PI / 2);

    // 광고판
    const [ac, ag] = makeCanvas(1024, 64);
    const grad = ag.createLinearGradient(0, 0, 1024, 0); grad.addColorStop(0, '#00c853'); grad.addColorStop(0.5, '#00b8d4'); grad.addColorStop(1, '#00c853');
    ag.fillStyle = grad; ag.fillRect(0, 0, 1024, 64);
    ag.fillStyle = '#04170d'; ag.font = 'italic 900 38px sans-serif'; ag.textBaseline = 'middle';
    ag.fillText('PITCH ONLINE', 30, 33); ag.fillText('⚽  피치 온라인', 360, 33); ag.fillText('PITCH ONLINE', 700, 33);
    const adTex = new THREE.CanvasTexture(ac); adTex.wrapS = THREE.RepeatWrapping;
    function board(len, x, z, rot) {
      const t = adTex.clone(); t.needsUpdate = true; t.repeat.set(len / 30, 1);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.9), new THREE.MeshBasicMaterial({ map: t }));
      m.position.set(x, 0.45, z); m.rotation.y = rot; scene.add(m);
    }
    board(106, 0, -S.HW - 3.5, 0);
    board(30, S.HL + 4.5, -20, -Math.PI / 2); board(30, S.HL + 4.5, 20, -Math.PI / 2);
    board(30, -S.HL - 4.5, -20, Math.PI / 2); board(30, -S.HL - 4.5, 20, Math.PI / 2);

    // 코너 깃발
    const poleMat = new THREE.MeshLambertMaterial({ color: 0xeeeeee }), flagMat = new THREE.MeshBasicMaterial({ color: 0xffd54f, side: THREE.DoubleSide });
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 6), poleMat); pole.position.set(sx * S.HL, 0.75, sy * S.HW); scene.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.32), flagMat); flag.position.set(sx * S.HL + 0.22, 1.33, sy * S.HW); scene.add(flag);
    }
  })();

  // ---- 골대와 그물 ----
  (function buildGoals() {
    const white = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const postGeo = new THREE.CylinderGeometry(0.07, 0.07, S.GOAL_H, 10);
    const barGeo = new THREE.CylinderGeometry(0.07, 0.07, S.GOAL_HW * 2 + 0.14, 10);
    for (const sd of [-1, 1]) {
      const gx = sd * S.HL, hw = S.GOAL_HW, H = S.GOAL_H, back = sd * (S.HL + 2), hb = 1.9;
      for (const py of [-hw, hw]) { const m = new THREE.Mesh(postGeo, white); m.position.set(gx, H / 2, py); scene.add(m); }
      const bar = new THREE.Mesh(barGeo, white); bar.rotation.x = Math.PI / 2; bar.position.set(gx, H, 0); scene.add(bar);
      const pts = [];
      const grid = (o, u, v, nu, nv) => {
        for (let i = 0; i <= nu; i++) { const a = [o[0] + u[0] * i / nu, o[1] + u[1] * i / nu, o[2] + u[2] * i / nu]; pts.push(...a, a[0] + v[0], a[1] + v[1], a[2] + v[2]); }
        for (let j = 0; j <= nv; j++) { const a = [o[0] + v[0] * j / nv, o[1] + v[1] * j / nv, o[2] + v[2] * j / nv]; pts.push(...a, a[0] + u[0], a[1] + u[1], a[2] + u[2]); }
      };
      grid([back, 0, -hw], [0, 0, 2 * hw], [0, hb, 0], 30, 8);
      grid([gx, H, -hw], [0, 0, 2 * hw], [back - gx, hb - H, 0], 30, 8);
      grid([gx, 0, -hw], [back - gx, 0, 0], [0, H, 0], 8, 10);
      grid([gx, 0, hw], [back - gx, 0, 0], [0, H, 0], 8, 10);
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      scene.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 })));
    }
  })();

  // ---- 그림자 텍스처 ----
  const shadowTex = (() => {
    const [c, g] = makeCanvas(64, 64);
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
  const shadowGeo = new THREE.PlaneGeometry(1, 1);

  // ---- 공 ----
  const BALL_R = 0.26;
  const ballMesh = (() => {
    const [c, g] = makeCanvas(256, 128);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#16181d';
    const spots = [[32, 30], [96, 64], [160, 30], [224, 64], [32, 98], [160, 98], [0, 64], [256, 64], [128, 5], [128, 123]];
    for (const [x, y] of spots) { g.beginPath(); for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2 - Math.PI / 2; g.lineTo(x + Math.cos(a) * 14, y + Math.sin(a) * 14); } g.fill(); }
    const m = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 20, 14), new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(c) }));
    scene.add(m); return m;
  })();
  const ballShadow = new THREE.Mesh(shadowGeo, shadowMat); ballShadow.rotation.x = -Math.PI / 2; ballShadow.scale.set(0.9, 0.9, 1); scene.add(ballShadow);

  // ---- 선수 ----
  const GEO = {
    torso: new THREE.CylinderGeometry(0.27, 0.22, 0.72, 10), shorts: new THREE.CylinderGeometry(0.235, 0.26, 0.28, 10),
    head: new THREE.SphereGeometry(0.15, 12, 10), hair: new THREE.SphereGeometry(0.157, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    leg: new THREE.BoxGeometry(0.13, 0.78, 0.14), boot: new THREE.BoxGeometry(0.15, 0.09, 0.26), arm: new THREE.BoxGeometry(0.1, 0.58, 0.1)
  };
  const SKINS = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];
  const HAIRS = [0x1d1510, 0x3b2a1a, 0x0d0d0d, 0x6b4a2b, 0x2a1d14];
  const matCache = {};
  const mat = c => matCache[c] || (matCache[c] = new THREE.MeshLambertMaterial({ color: c }));

  function makePlayer(shirt, shorts, socks, i) {
    const g = new THREE.Group();
    const torso = new THREE.Mesh(GEO.torso, mat(shirt)); torso.position.y = 1.27; g.add(torso);
    const sh = new THREE.Mesh(GEO.shorts, mat(shorts)); sh.position.y = 0.86; g.add(sh);
    const head = new THREE.Mesh(GEO.head, mat(SKINS[i % SKINS.length])); head.position.y = 1.8; g.add(head);
    const hair = new THREE.Mesh(GEO.hair, mat(HAIRS[(i * 3) % HAIRS.length])); hair.position.y = 1.82; g.add(hair);
    const legs = [], arms = [];
    for (const s of [-1, 1]) {
      const lp = new THREE.Group(); lp.position.set(s * 0.12, 0.8, 0);
      const leg = new THREE.Mesh(GEO.leg, mat(socks)); leg.position.y = -0.39; lp.add(leg);
      const boot = new THREE.Mesh(GEO.boot, mat(0x111111)); boot.position.set(0, -0.76, 0.05); lp.add(boot);
      g.add(lp); legs.push(lp);
      const ap = new THREE.Group(); ap.position.set(s * 0.34, 1.56, 0);
      const arm = new THREE.Mesh(GEO.arm, mat(shirt)); arm.position.y = -0.27; ap.add(arm);
      g.add(ap); arms.push(ap);
    }
    const shadow = new THREE.Mesh(shadowGeo, shadowMat); shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02; shadow.scale.set(1.3, 1.3, 1); g.add(shadow);
    g.userData = { legs, arms, phase: Math.random() * 6 };
    return g;
  }

  let players = [];
  const ringMine = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.95, 32), new THREE.MeshBasicMaterial({ color: 0xffd54f, transparent: true, opacity: 0.95, depthWrite: false }));
  ringMine.rotation.x = -Math.PI / 2; ringMine.position.y = 0.04; scene.add(ringMine);
  const ringOpp = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.95, 32), new THREE.MeshBasicMaterial({ color: 0x18ffff, transparent: true, opacity: 0.8, depthWrite: false }));
  ringOpp.rotation.x = -Math.PI / 2; ringOpp.position.y = 0.04; scene.add(ringOpp);
  const arrowMine = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.45, 4), new THREE.MeshBasicMaterial({ color: 0xffd54f }));
  arrowMine.rotation.x = Math.PI; scene.add(arrowMine);

  function kitsFor(teams) {
    const k = teams.map(i => { const t = S.TEAMS[i]; return { shirt: t.kit[0], shorts: t.kit[1], socks: t.kit[2], gk: t.gkKit }; });
    if (teams[0] === teams[1]) k[1] = { shirt: k[0].shorts, shorts: k[0].shirt, socks: k[0].shorts, gk: '#ff9800' };
    return k;
  }

  function setupMatchVisuals(teams) {
    for (const p of players) scene.remove(p);
    players = [];
    const kits = G.kits = kitsFor(teams);
    for (let i = 0; i < N; i++) {
      const side = i < S.PER_TEAM ? 0 : 1, idx = i % S.PER_TEAM, k = kits[side];
      const p = idx === 0 ? makePlayer(k.gk, '#1a1a1a', k.gk, i) : makePlayer(k.shirt, k.shorts, k.socks, i);
      scene.add(p); players.push(p);
    }
    view.init = false;
    $('#sb-n0').textContent = S.TEAMS[teams[0]].id; $('#sb-n1').textContent = S.TEAMS[teams[1]].id;
    $('#sb-c0').style.background = kits[0].shirt; $('#sb-c1').style.background = kits[1].shirt;
    hudCache.s0 = hudCache.s1 = hudCache.time = hudCache.ctrl = null;
  }

  // =====================================================================
  // 매 프레임 그리기
  // =====================================================================
  const view = { init: false, x: new Float32Array(N), y: new Float32Array(N), f: new Float32Array(N), bx: 0, by: 0, bz: 0 };
  const cam = { x: 0, z: 0 };
  const tmpAxis = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
  const hudCache = {};

  function lerpAng(a, b, t) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; }

  function renderMatch(s, dt) {
    const k = G.mode === 'online' && view.init ? Math.min(1, dt * 18) : 1;
    for (let i = 0; i < N; i++) {
      const tx = s.p[i * 4], ty = s.p[i * 4 + 1], tf = s.p[i * 4 + 2], sp = s.p[i * 4 + 3];
      view.x[i] += (tx - view.x[i]) * k; view.y[i] += (ty - view.y[i]) * k; view.f[i] = lerpAng(view.f[i], tf, k);
      if (k === 1) { view.x[i] = tx; view.y[i] = ty; view.f[i] = tf; }
      const p = players[i]; if (!p) continue;
      p.visible = true;
      p.position.set(view.x[i], 0, view.y[i]);
      p.rotation.y = Math.PI / 2 - view.f[i];
      const ud = p.userData; ud.phase += sp * dt * 1.9;
      const amp = Math.min(sp / 7, 1) * 0.8, sw = Math.sin(ud.phase) * amp;
      ud.legs[0].rotation.x = sw; ud.legs[1].rotation.x = -sw;
      ud.arms[0].rotation.x = -sw * 0.8; ud.arms[1].rotation.x = sw * 0.8;
    }
    // 공
    const pbx = view.bx, pby = view.by;
    const [bx, by, bz] = s.b;
    view.bx += (bx - view.bx) * k; view.by += (by - view.by) * k; view.bz += (bz - view.bz) * k;
    if (k === 1) { view.bx = bx; view.by = by; view.bz = bz; }
    const dx = view.bx - pbx, dz = view.by - pby, d = Math.hypot(dx, dz);
    if (d > 1e-4 && d < 5) { tmpAxis.set(dz, 0, -dx).normalize(); tmpQ.setFromAxisAngle(tmpAxis, d / BALL_R); ballMesh.quaternion.premultiply(tmpQ); }
    ballMesh.position.set(view.bx, view.bz + BALL_R, view.by);
    ballShadow.position.set(view.bx, 0.03, view.by);
    const sc = 0.9 / (1 + view.bz * 0.25); ballShadow.scale.set(sc, sc, 1);
    view.init = true;

    // 조작 선수 표시
    const mine = s.c[G.side] >= 0 ? G.side * S.PER_TEAM + s.c[G.side] : -1;
    if (mine >= 0 && s.ph !== 'ended') {
      ringMine.visible = arrowMine.visible = true;
      ringMine.position.x = arrowMine.position.x = view.x[mine];
      ringMine.position.z = arrowMine.position.z = view.y[mine];
      arrowMine.position.y = 2.55 + Math.sin(performance.now() / 180) * 0.08;
    } else ringMine.visible = arrowMine.visible = false;
    const oside = 1 - G.side, opp = G.mode === 'online' && s.c[oside] >= 0 ? oside * S.PER_TEAM + s.c[oside] : -1;
    if (opp >= 0 && s.ph !== 'ended') { ringOpp.visible = true; ringOpp.position.x = view.x[opp]; ringOpp.position.z = view.y[opp]; }
    else ringOpp.visible = false;

    updateCamera(view.bx, view.by, dt);
    updateHUD(s, mine);
    drawRadar(s, mine);
    const bounce = s.ph === 'goal' ? Math.abs(Math.sin(performance.now() / 90)) * 0.012 : 0;
    for (const t of standTexes) t.offset.y = bounce;
  }

  function updateCamera(bx, by, dt) {
    const aspect = innerWidth / innerHeight;
    const far = aspect < 0.8 ? 1.75 : aspect < 1.3 ? 1.3 : 1;
    cam.x += (clamp(bx * 0.88, -34, 34) - cam.x) * Math.min(1, dt * 2.2);
    cam.z += (clamp(by * 0.3, -8, 8) - cam.z) * Math.min(1, dt * 1.5);
    camera.position.set(cam.x, 26 * far, 50 * far + cam.z);
    camera.lookAt(cam.x, 0, cam.z - 4);
  }

  let menuT = 0;
  function renderMenu(dt) {
    menuT += dt;
    for (const p of players) p.visible = false;
    ringMine.visible = ringOpp.visible = arrowMine.visible = false;
    ballMesh.position.set(0, BALL_R, 0); ballShadow.position.set(0, 0.03, 0);
    ballMesh.rotation.y += dt * 0.6;
    const a = menuT * 0.07;
    camera.position.set(Math.sin(a) * 62, 20 + Math.sin(menuT * 0.11) * 4, Math.cos(a) * 46);
    camera.lookAt(0, 0, 0);
  }

  // ---- HUD ----
  const bigmsg = $('#bigmsg');
  let msgTimer = 0;
  function fmtTime(s) {
    const gs = Math.min(5400, Math.floor(s.tm / s.d * 5400));
    return String(Math.floor(gs / 60)).padStart(2, '0') + ':' + String(gs % 60).padStart(2, '0');
  }
  function updateHUD(s, mine) {
    if (hudCache.s0 !== s.s[0]) { hudCache.s0 = s.s[0]; $('#sb-s0').textContent = s.s[0]; }
    if (hudCache.s1 !== s.s[1]) { hudCache.s1 = s.s[1]; $('#sb-s1').textContent = s.s[1]; }
    const t = fmtTime(s); if (hudCache.time !== t) { hudCache.time = t; $('#sb-time').textContent = t; }
    if (mine >= 0 && hudCache.ctrl !== mine) {
      hudCache.ctrl = mine;
      const idx = mine % S.PER_TEAM, team = S.TEAMS[G.teams[G.side]];
      $('#ctrl-num').textContent = S.NUMS[idx]; $('#ctrl-name').textContent = team.players[idx];
    }
    const ch = s.ch[G.side];
    const pw = $('#power');
    if (ch >= 0) { pw.classList.add('show'); pw.querySelector('i').style.width = Math.min(100, ch / 0.9 * 100) + '%'; }
    else pw.classList.remove('show');

    if (s.msg && s.msg.id !== G.lastMsgId) {
      const first = G.lastMsgId === -1;
      G.lastMsgId = s.msg.id;
      bigmsg.querySelector('.bm-text').textContent = s.msg.text;
      bigmsg.querySelector('.bm-sub').textContent = s.msg.sub;
      bigmsg.classList.toggle('goal', s.msg.text === 'GOAL!');
      bigmsg.classList.remove('show'); void bigmsg.offsetWidth; bigmsg.classList.add('show');
      clearTimeout(msgTimer);
      msgTimer = setTimeout(() => bigmsg.classList.remove('show'), s.msg.text === 'GOAL!' ? 3000 : 1800);
      if (s.msg.text === '킥오프') Snd.whistle(1);
      else if (s.msg.text === '경기 종료') Snd.whistle(3);
      else if (s.msg.text === 'GOAL!') Snd.goal();
      else if (s.msg.text === '선방!' || s.msg.text === '골대 강타!') { Snd.crowd(0.3, 0.2); setTimeout(() => Snd.crowd(0.1, 1.5), 900); }
      if (first && s.msg.text !== '킥오프') bigmsg.classList.remove('show');
    }
    if (s.k !== G.lastKicks) { if (G.lastKicks !== 0 || s.k < 3) Snd.kick(); G.lastKicks = s.k; }
    if (s.ph === 'ended' && !G.endShown) { G.endShown = true; setTimeout(() => showEnd(s), 1800); }
  }

  const radar = $('#radar'), rctx = radar.getContext('2d');
  function drawRadar(s, mine) {
    const W = radar.width, H = radar.height, pad = 6, sx = (W - pad * 2) / 105, sy = (H - pad * 2) / 68;
    const X = x => pad + (x + 52.5) * sx, Y = y => pad + (y + 34) * sy;
    rctx.clearRect(0, 0, W, H);
    rctx.strokeStyle = 'rgba(255,255,255,.45)'; rctx.lineWidth = 1;
    rctx.strokeRect(pad, pad, W - pad * 2, H - pad * 2);
    rctx.beginPath(); rctx.moveTo(X(0), Y(-34)); rctx.lineTo(X(0), Y(34)); rctx.stroke();
    rctx.beginPath(); rctx.arc(X(0), Y(0), 9.15 * sx, 0, Math.PI * 2); rctx.stroke();
    rctx.strokeRect(X(-52.5), Y(-20.16), 16.5 * sx, 40.32 * sy);
    rctx.strokeRect(X(52.5 - 16.5), Y(-20.16), 16.5 * sx, 40.32 * sy);
    for (let i = 0; i < N; i++) {
      const side = i < S.PER_TEAM ? 0 : 1, k = G.kits[side];
      rctx.fillStyle = i % S.PER_TEAM === 0 ? k.gk : k.shirt;
      rctx.beginPath(); rctx.arc(X(s.p[i * 4]), Y(s.p[i * 4 + 1]), 3.4, 0, Math.PI * 2); rctx.fill();
      rctx.strokeStyle = 'rgba(0,0,0,.6)'; rctx.stroke();
      if (i === mine) { rctx.strokeStyle = '#ffd54f'; rctx.lineWidth = 2; rctx.beginPath(); rctx.arc(X(s.p[i * 4]), Y(s.p[i * 4 + 1]), 6, 0, Math.PI * 2); rctx.stroke(); rctx.lineWidth = 1; }
    }
    rctx.fillStyle = '#fff'; rctx.beginPath(); rctx.arc(X(s.b[0]), Y(s.b[1]), 2.6, 0, Math.PI * 2); rctx.fill();
    rctx.strokeStyle = '#000'; rctx.stroke();
  }

  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.fov = camera.aspect < 0.8 ? 50 : 38;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize); resize();

  // =====================================================================
  // 메뉴
  // =====================================================================
  const store = {
    get(k, d) { try { const v = localStorage.getItem('pitch-' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('pitch-' + k, JSON.stringify(v)); } catch (e) {} }
  };

  function showScreen(id) {
    for (const s of $$('.screen')) s.classList.toggle('active', s.id === id);
    $('#menu').classList.remove('hidden');
  }
  for (const b of $$('[data-go]')) b.addEventListener('click', () => { Snd.init(); showScreen(b.dataset.go); });

  function makePicker(el, key, init) {
    let idx = store.get(key, init);
    if (!(idx >= 0 && idx < S.TEAMS.length)) idx = init;
    el.innerHTML = '<button class="arrow" aria-label="이전 팀">◀</button><div class="tcard"></div><button class="arrow" aria-label="다음 팀">▶</button>';
    const [prev, card, next] = el.children;
    const draw = () => {
      const t = S.TEAMS[idx];
      card.innerHTML = `<div class="kit" style="background:linear-gradient(135deg,${t.kit[0]} 50%,${t.kit[1]} 50%)"></div>
        <div class="ovr">${t.ovr}<small>OVR</small></div><div class="tname">${t.name}</div>
        <div class="tstats">${['pac', 'sho', 'pas', 'def', 'gk'].map((s, i) => `<div><b>${t[s]}</b><span>${['PAC', 'SHO', 'PAS', 'DEF', 'GK'][i]}</span></div>`).join('')}</div>`;
      store.set(key, idx);
    };
    prev.addEventListener('click', () => { idx = (idx + S.TEAMS.length - 1) % S.TEAMS.length; draw(); });
    next.addEventListener('click', () => { idx = (idx + 1) % S.TEAMS.length; draw(); });
    draw();
    return { get value() { return idx; } };
  }
  function makeSeg(id, key) {
    const el = $(id); const saved = store.get(key, null);
    const btns = $$(id + ' button');
    if (saved !== null) btns.forEach(b => b.classList.toggle('on', b.dataset.v === String(saved)));
    btns.forEach(b => b.addEventListener('click', () => { btns.forEach(x => x.classList.toggle('on', x === b)); store.set(key, b.dataset.v); }));
    return { get value() { const on = el.querySelector('.on'); return on ? on.dataset.v : btns[0].dataset.v; } };
  }
  const pickMy = makePicker($('#pick-ai-my'), 'my', 0);
  const pickCpu = makePicker($('#pick-ai-cpu'), 'cpu', 1);
  const pickOn = makePicker($('#pick-on'), 'on', 0);
  const segDiff = makeSeg('#seg-diff', 'diff'), segDurAi = makeSeg('#seg-dur-ai', 'durai'), segDurOn = makeSeg('#seg-dur-on', 'duron');

  function toast(t) {
    const el = $('#toast'); el.textContent = t; el.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // ---- 경기 시작 / 종료 ----
  function enterMatch(teams) {
    G.teams = teams; G.playing = true; G.paused = false; G.endShown = false; G.lastMsgId = -1; G.lastKicks = 0;
    setupMatchVisuals(teams);
    $('#menu').classList.add('hidden'); $('#hud').classList.remove('hidden');
    $('#end').classList.add('hidden'); $('#pause').classList.add('hidden');
    $('#touch').classList.toggle('hidden', !isTouch);
    Snd.init(); Snd.crowd(0.1, 1.5);
    canvas.focus && canvas.focus();
  }
  function startAI() {
    const o = G.aiOpts;
    G.mode = 'ai'; G.side = 0;
    G.match = S.createMatch({ teams: o.teams, humans: [true, false], difficulty: o.diff, duration: o.dur });
    G.snap = S.snapshot(G.match);
    enterMatch(o.teams);
  }
  $('#btn-start-ai').addEventListener('click', () => {
    G.aiOpts = { teams: [pickMy.value, pickCpu.value], diff: segDiff.value, dur: +segDurAi.value };
    startAI();
  });

  function goMenu(screen) {
    G.playing = false; G.paused = false; G.mode = null; G.match = null; G.snap = null;
    $('#hud').classList.add('hidden'); $('#touch').classList.add('hidden');
    $('#pause').classList.add('hidden'); $('#end').classList.add('hidden');
    bigmsg.classList.remove('show');
    closeNet();
    resetOnlineUI();
    showScreen(screen || 'scr-main');
    Snd.crowd(0.03, 1.5);
  }

  function showEnd(s) {
    const me = G.side, opp = 1 - me;
    const n0 = S.TEAMS[G.teams[0]], n1 = S.TEAMS[G.teams[1]];
    $('#end-n0').textContent = n0.id; $('#end-n1').textContent = n1.id;
    $('#end-c0').style.background = G.kits[0].shirt; $('#end-c1').style.background = G.kits[1].shirt;
    $('#end-s').textContent = `${s.s[0]} : ${s.s[1]}`;
    $('#end-result').textContent = s.s[me] > s.s[opp] ? '🏆 승리!' : s.s[me] < s.s[opp] ? '패배' : '무승부';
    const tot = (s.st[0] + s.st[1]) || 1;
    const p0 = Math.round(s.st[0] / tot * 100);
    $('#es-p0').textContent = p0 + '%'; $('#es-p1').textContent = (100 - p0) + '%';
    $('#es-s0').textContent = s.st[2]; $('#es-s1').textContent = s.st[3];
    $('#end-status').textContent = '';
    $('#btn-rematch').classList.remove('hidden');
    $('#end').classList.remove('hidden');
    Snd.crowd(0.05, 3);
  }
  $('#btn-end-menu').addEventListener('click', () => goMenu(G.mode === 'online' ? 'scr-online' : 'scr-main'));
  $('#btn-rematch').addEventListener('click', () => {
    if (G.mode === 'ai') startAI();
    else if (G.mode === 'online') { send({ t: 'rematch' }); $('#end-status').textContent = '상대의 응답을 기다리는 중…'; }
  });

  // ---- 일시정지 ----
  function togglePause() {
    if (!G.playing || !$('#end').classList.contains('hidden')) return;
    const el = $('#pause');
    const show = el.classList.contains('hidden');
    el.classList.toggle('hidden', !show);
    if (G.mode === 'ai') G.paused = show;
    $('#pause-title').textContent = G.mode === 'ai' ? '일시정지' : '메뉴';
    $('#pause-note').textContent = G.mode === 'online' ? '온라인 경기는 멈추지 않아요!' : '';
  }
  $('#btn-pause').addEventListener('click', togglePause);
  $('#btn-resume').addEventListener('click', togglePause);
  $('#btn-quit').addEventListener('click', () => goMenu(G.mode === 'online' ? 'scr-online' : 'scr-main'));

  // =====================================================================
  // 온라인
  // =====================================================================
  const setStatus = t => { $('#online-status').textContent = t; };
  function wsURL() { return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'; }
  function connect() {
    return new Promise((resolve, reject) => {
      if (G.ws && G.ws.readyState === 1) return resolve();
      if (location.protocol === 'file:') return reject(new Error('file'));
      setStatus('서버에 연결하는 중…');
      let ws, opened = false;
      try { ws = new WebSocket(wsURL()); } catch (e) { return reject(e); }
      G.ws = ws;
      const timer = setTimeout(() => { if (!opened) { try { ws.close(); } catch (e) {} reject(new Error('timeout')); } }, 20000);
      ws.onopen = () => { opened = true; clearTimeout(timer); resolve(); };
      ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } onNet(m); };
      ws.onerror = () => {};
      ws.onclose = () => {
        clearTimeout(timer);
        if (!opened) reject(new Error('closed'));
        if (G.ws === ws) G.ws = null;
        if (G.mode === 'online' && G.playing) { toast('서버와의 연결이 끊어졌어요.'); goMenu('scr-online'); }
      };
    });
  }
  function closeNet() { if (G.ws) { const ws = G.ws; G.ws = null; try { ws.close(); } catch (e) {} } }
  function send(o) { if (G.ws && G.ws.readyState === 1) G.ws.send(JSON.stringify(o)); }
  function netFail(e) {
    setStatus(e && e.message === 'file'
      ? '온라인 대전은 서버(npm start 또는 Render)에서 열어야 해요.'
      : '서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요. (무료 서버는 깨어나는 데 시간이 걸릴 수 있어요)');
  }
  function resetOnlineUI() { $('#room-box').classList.add('hidden'); G.roomCode = null; setStatus(''); }

  function onNet(m) {
    switch (m.t) {
      case 'created':
        G.roomCode = m.code;
        $('#room-code').textContent = m.code; $('#room-box').classList.remove('hidden');
        setStatus('친구를 기다리는 중… 방 코드나 초대 링크를 보내 주세요.');
        break;
      case 'start':
        G.mode = 'online'; G.side = m.side; G.snap = null;
        enterMatch(m.teams);
        toast(m.side === 0 ? '경기 시작! 당신은 왼쪽 → 오른쪽으로 공격해요' : '경기 시작! 당신은 오른쪽 → 왼쪽으로 공격해요');
        break;
      case 'state':
        G.snap = m.s;
        break;
      case 'error':
        setStatus(m.msg);
        break;
      case 'left':
        if (G.playing) { toast('상대가 경기를 떠났어요.'); goMenu('scr-online'); }
        else { resetOnlineUI(); setStatus('상대가 나갔어요.'); }
        break;
      case 'rematch-wait': $('#end-status').textContent = '상대의 응답을 기다리는 중…'; break;
      case 'rematch-ask': $('#end-status').textContent = '상대가 한 판 더 하재요! [다시 하기]를 눌러 주세요.'; break;
    }
  }

  $('#btn-create').addEventListener('click', () => {
    Snd.init();
    connect().then(() => send({ t: 'create', team: pickOn.value, dur: +segDurOn.value })).catch(netFail);
  });
  $('#btn-join').addEventListener('click', () => {
    Snd.init();
    const code = $('#join-code').value.trim().toUpperCase();
    if (code.length !== 4) return setStatus('방 코드 4자리를 입력해 주세요.');
    connect().then(() => { setStatus('참가하는 중…'); send({ t: 'join', code, team: pickOn.value }); }).catch(netFail);
  });
  $('#join-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-join').click(); });
  $('#btn-copy').addEventListener('click', () => {
    const link = location.origin + location.pathname + '?room=' + G.roomCode;
    const text = `PITCH ONLINE 한 판 하자! 방 코드: ${G.roomCode}`;
    if (navigator.share && isTouch) navigator.share({ title: 'PITCH ONLINE', text, url: link }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => toast('초대 링크를 복사했어요!'), () => toast(link));
    else toast(link);
  });
  $('#btn-online-back').addEventListener('click', () => { send({ t: 'leave' }); closeNet(); resetOnlineUI(); showScreen('scr-main'); });

  setInterval(() => {
    if (G.mode !== 'online' || !G.playing) return;
    const r = v => Math.round(v * 100) / 100;
    send({ t: 'i', i: [r(inp.mx), r(inp.my), inp.sp ? 1 : 0, inp.pa, inp.lo, inp.sw, inp.sh ? 1 : 0] });
  }, 33);

  // 초대 링크로 들어온 경우
  const roomParam = new URLSearchParams(location.search).get('room');
  if (roomParam) {
    showScreen('scr-online');
    $('#join-code').value = roomParam.toUpperCase().slice(0, 4);
    setStatus('팀을 고르고 [참가]를 눌러 주세요!');
  }

  // =====================================================================
  // 메인 루프
  // =====================================================================
  let lastT = performance.now(), acc = 0;
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - lastT) / 1000)); lastT = now;
    if (G.playing) updateInput();
    if (G.mode === 'ai' && G.match && !G.paused) {
      acc += dt; let n = 0;
      while (acc >= S.DT && n < 6) { S.step(G.match, S.DT, [inp, null]); acc -= S.DT; n++; }
      if (n === 6) acc = 0;
      G.snap = S.snapshot(G.match);
    }
    if (G.playing && G.snap && players.length) renderMatch(G.snap, dt); else renderMenu(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
