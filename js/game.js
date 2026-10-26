/* Steppe Hawk — UAV Strike Simulator
 * Single-file canvas game. No dependencies; runs in any modern browser and installs on Android as a PWA.
 * World units are metres; world y points north. The camera is an orthographic oblique sensor view
 * looking from the orbiting drone toward the aim point (the laser spot).
 */
'use strict';
(() => {

// ============================================================ utilities
const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const hyp = Math.hypot;
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
let rnd = Math.random;
const rr = (a, b) => a + (b - a) * rnd();
const ri = (a, b) => Math.floor(rr(a, b + 1));
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const chance = p => rnd() < p;
function makeNoise(seed) {
  const r = mulberry32(seed), N = 256, p = new Float32Array(N * N);
  for (let i = 0; i < p.length; i++) p[i] = r();
  const g = (a, b) => p[(a & 255) + (b & 255) * N];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return lerp(lerp(g(xi, yi), g(xi + 1, yi), u), lerp(g(xi, yi + 1), g(xi + 1, yi + 1), u), v);
  };
}
function fbm(n, x, y) { return n(x, y) * 0.5 + n(x * 2.1, y * 2.1) * 0.27 + n(x * 4.3, y * 4.3) * 0.15 + n(x * 8.7, y * 8.7) * 0.08; }
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
  return hyp(px - ax - dx * t, py - ay - dy * t);
}
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const fmtT = s => { s = Math.max(0, Math.ceil(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
};

// ============================================================ constants
const WORLD = 4000, SP = 250, NG = 16, LANE = 3.2;
const T0 = 6, T1 = 10;                      // town lattice range (village centre at 2000,2000)
const ZOOMS = [2400, 1200, 600, 300, 150, 75, 38];
const WEAPONS = {
  LGM: { key: 'LGM', name: 'LGM-L', long: 'Light guided missile', speed: 470, kill: 9, wound: 18, track: 90, call: 'RIFLE' },
  LGB: { key: 'LGB', name: 'LGB-H', long: 'Heavy guided bomb', speed: 270, kill: 22, wound: 42, track: 45, call: 'BOMB AWAY' },
};
const VT = {
  car:     { L: 4.4, W: 1.8, H: 1.5, occ: 1 },
  van:     { L: 5.2, W: 2.0, H: 2.2, occ: 2 },
  bus:     { L: 10.5, W: 2.5, H: 3.0, occ: 7 },
  tractor: { L: 4.2, W: 2.2, H: 2.6, occ: 1 },
  truck:   { L: 7.6, W: 2.5, H: 2.9, occ: 2 },
  fuel:    { L: 8.4, W: 2.5, H: 2.8, occ: 2 },
  tank:    { L: 7.0, W: 3.5, H: 2.3, occ: 3 },
  ifv:     { L: 6.8, W: 3.2, H: 2.2, occ: 6 },
  spg:     { L: 7.2, W: 3.4, H: 2.9, occ: 4 },
  tel:     { L: 9.4, W: 3.2, H: 3.3, occ: 3 },
  radar:   { L: 7.0, W: 3.0, H: 3.0, occ: 3 },
  staff:   { L: 5.4, W: 2.3, H: 2.0, occ: 3 },
};
const CIV_CAR = [[176, 38, 36], [222, 222, 216], [40, 62, 124], [196, 188, 168], [34, 34, 36], [90, 110, 70], [150, 150, 158]];
const CLOTH = [[196, 62, 52], [60, 84, 160], [226, 226, 214], [52, 52, 54], [120, 92, 62], [64, 118, 74], [190, 168, 92], [140, 70, 120]];
const MIL = [[96, 102, 72], [84, 90, 64], [108, 104, 78]];
const ROOFS = [[150, 62, 46], [72, 112, 92], [128, 128, 132], [70, 92, 132], [118, 76, 54]];
const PAL_NAMES = ['WHOT', 'BHOT', 'TV'];

// ============================================================ canvas
const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
// W/H are the camera view size; SW/SH the whole screen. On a split layout (half-folded foldable,
// tall portrait screen) the view takes one region and PANEL holds the touch controls and minimap.
let W = 0, H = 0, SW = 0, SH = 0, DPR = 1, UI = 1;
const VR = { x: 0, y: 0 };
let PANEL = null, MMP = null, LAYOUT = 'full', foldInfo = null, renderScale = 1;
const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
const isNative = !!window.SteppeHawkNative;
function segments() {
  const f = foldInfo; // from the Android app (Jetpack WindowManager), in CSS px
  if (f && (f.state === 'HALF_OPENED' || f.separating)) {
    if (f.orientation === 'HORIZONTAL') return [{ x: 0, y: 0, w: SW, h: f.y }, { x: 0, y: f.y + f.h, w: SW, h: SH - f.y - f.h }];
    return [{ x: 0, y: 0, w: f.x, h: SH }, { x: f.x + f.w, y: 0, w: SW - f.x - f.w, h: SH }];
  }
  const vs = window.viewport && window.viewport.segments; // Viewport Segments API (Chrome on foldables)
  if (vs && vs.length === 2) return vs.map(r => ({ x: r.x, y: r.y, w: r.width, h: r.height }));
  return null;
}
function resize() {
  SW = window.innerWidth; SH = window.innerHeight;
  DPR = Math.max(0.75, Math.min(window.devicePixelRatio || 1, isTouch ? 1.75 : 2) * renderScale);
  cv.width = Math.round(SW * DPR); cv.height = Math.round(SH * DPR);
  let view = { x: 0, y: 0, w: SW, h: SH };
  PANEL = null; LAYOUT = 'full';
  if (isTouch) {
    const seg = segments();
    if (seg && seg.every(r => r.w > 140 && r.h > 140)) {
      // tabletop (hinge horizontal): view on the upper half, controls on the lower half.
      // book (hinge vertical): view on the left page, controls on the right page.
      view = seg[0]; PANEL = seg[1]; LAYOUT = seg[1].y > seg[0].y ? 'tabletop' : 'book';
    } else if (SH > SW * 1.25) {
      const vh = Math.round(SH * 0.64);
      view = { x: 0, y: 0, w: SW, h: vh }; PANEL = { x: 0, y: vh, w: SW, h: SH - vh }; LAYOUT = 'portrait';
    }
  }
  VR.x = view.x; VR.y = view.y; W = view.w; H = view.h;
  UI = clamp(Math.min(W, H) / 640, 0.72, 1.15);
  layoutTouch();
}
function layoutTouch() {
  const el = document.getElementById('touch');
  MMP = null;
  el.classList.toggle('deck', !!PANEL);
  const stack = !!PANEL && PANEL.h > PANEL.w * 1.1;
  el.classList.toggle('stack', stack);
  if (PANEL) {
    Object.assign(el.style, { left: PANEL.x + 'px', top: PANEL.y + 'px', width: PANEL.w + 'px', height: PANEL.h + 'px' });
    // the minimap moves into the panel when it fits beside (or above) the buttons
    const s = Math.floor(stack ? Math.min(PANEL.w - 24, PANEL.h - 270, 260) : Math.min(PANEL.h - 24, PANEL.w - 268, 260));
    if (s >= 90) MMP = stack ? { x: PANEL.x + (PANEL.w - s) / 2, y: PANEL.y + 14, s } : { x: PANEL.x + 12, y: PANEL.y + (PANEL.h - s) / 2, s };
  } else for (const k of ['left', 'top', 'width', 'height']) el.style[k] = '';
}
window.addEventListener('resize', resize);
if (window.viewport && window.viewport.addEventListener) window.viewport.addEventListener('segmentschange', resize);
window.__setFold = f => { foldInfo = f; resize(); };
resize();

// ============================================================ audio
const Snd = {
  ctx: null, master: null, nbuf: null, muted: false,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.55; this.master.connect(this.ctx.destination);
      const c = this.ctx, b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.nbuf = b;
      const o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
      o.type = 'sawtooth'; o.frequency.value = 52; f.type = 'lowpass'; f.frequency.value = 160; g.gain.value = 0.02;
      o.connect(f); f.connect(g); g.connect(this.master); o.start();
    } catch (e) { this.ctx = null; }
  },
  tone(f, d, type = 'square', v = 0.06, f2) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + d + 0.05);
  },
  noise(d, v, freq = 1000, type = 'lowpass', f2) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.nbuf; s.loop = true; f.type = type; f.frequency.setValueAtTime(freq, t);
    if (f2) f.frequency.exponentialRampToValueAtTime(f2, t + d);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t + d + 0.05);
  },
  boom(k = 1) { this.noise(1.8, 0.5 * k, 700, 'lowpass', 50); this.tone(65, 0.9, 'sine', 0.3 * k, 28); },
  thud() { this.noise(0.6, 0.12, 300, 'lowpass', 60); },
  launch() { this.noise(1.3, 0.14, 3200, 'bandpass', 500); this.tone(880, 0.16, 'square', 0.04, 440); },
  click() { this.tone(1700, 0.035, 'square', 0.025); },
  lock() { this.tone(1150, 0.06, 'square', 0.035); setTimeout(() => this.tone(1550, 0.08, 'square', 0.035), 70); },
  pid() { this.tone(900, 0.08, 'triangle', 0.06); setTimeout(() => this.tone(1350, 0.14, 'triangle', 0.06), 90); },
  radio() { this.noise(0.14, 0.05, 2400, 'bandpass'); },
  warn() { this.tone(1050, 0.11, 'square', 0.06); },
  flare() { this.noise(0.5, 0.12, 4000, 'highpass', 1500); },
  hit() { this.noise(1.2, 0.4, 1600, 'lowpass', 90); this.tone(110, 0.6, 'sawtooth', 0.14, 36); },
};

// ============================================================ world generation
function genWorld(M) {
  const Wd = {
    nodes: new Map(), edges: [], blds: [], trees: [], farms: [], compounds: [], axes: [], parks: [],
    market: null, winter: !!M.winter, riverX: null, powerlines: [], pylons: [], wires: [],
  };
  const key = (i, j) => i + ',' + j;
  const edgeSet = new Set();
  const node = (i, j) => {
    const k = key(i, j); let n = Wd.nodes.get(k);
    if (!n) { n = { k, i, j, x: i * SP, y: j * SP, adj: [] }; Wd.nodes.set(k, n); }
    return n;
  };
  Wd.node = node;
  const link = (a, b, type) => {
    const k = a.k < b.k ? a.k + '|' + b.k : b.k + '|' + a.k;
    if (edgeSet.has(k)) return;
    edgeSet.add(k); a.adj.push(b); b.adj.push(a); Wd.edges.push({ a, b, type });
  };
  const line = (i0, j0, i1, j1, type) => {
    const di = Math.sign(i1 - i0), dj = Math.sign(j1 - j0); let i = i0, j = j0;
    while (i !== i1 || j !== j1) { const n = node(i, j); i += di; j += dj; link(n, node(i, j), type); }
  };
  // river: winds north-south east of the village
  const rph = rr(0, 6);
  const riverX = y => 2960 + 150 * Math.sin(y / 520 + rph) + 60 * Math.sin(y / 170 + rph * 2);
  Wd.riverX = riverX;
  const nearRiver = (x, y, m) => Math.abs(x - riverX(y)) < m;

  line(0, 8, 16, 8, 'hwy'); line(8, 0, 8, 16, 'hwy');
  for (let i = T0; i <= T1; i++) line(i, T0, i, T1, 'town');
  for (let j = T0; j <= T1; j++) line(T0, j, T1, j, 'town');

  // field roads & farm complexes in each quadrant
  const quads = [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 1], [-1, -1]];
  for (let q = 0; q < quads.length; q++) {
    const [sx, sy] = quads[q];
    for (let tries = 0; tries < 30; tries++) {
      const i = 8 + sx * ri(3, 7), j = 8 + sy * ri(3, 7);
      const cx = i * SP + sx * 80, cy = j * SP;
      if (cx < 120 || cx > WORLD - 120) continue;
      if (nearRiver(cx, cy, 170)) continue;
      if (Wd.compounds.some(c => hyp(c.x - cx, c.y - cy) < 520)) continue;
      if (Math.abs(i - 8) > 1 && Math.abs(j - 8) > 1) {
        line(i, j, 8, j, 'dirt');
        // dirt roads crossing the river are fords/bridges; acceptable visually
        Wd.compounds.push(makeFarm(Wd, cx, cy, -sx, node(i, j)));
        break;
      }
    }
  }
  // a couple of extra field tracks for traffic variety
  line(3, 3, 3, 8, 'dirt'); line(13, 8, 13, 13, 'dirt');

  // village blocks
  const mcell = [7, 8];                         // market square cell (x 1750-2000, y 2000-2250)
  const ccell = [8, 6];                         // church
  for (let i = T0; i < T1; i++) for (let j = T0; j < T1; j++) {
    const x0 = i * SP, y0 = j * SP;
    const centre = (i === 7 || i === 8) && (j === 7 || j === 8);
    if (i === mcell[0] && j === mcell[1]) { makeMarket(Wd, x0, y0); continue; }
    if (i === ccell[0] && j === ccell[1]) {
      addBld(Wd, { x: x0 + 125, y: y0 + 125, w: 16, d: 30, a: 0, h: 11, dome: true, wallDay: [236, 232, 220], roofDay: [80, 120, 100] });
      for (let k = 0; k < 10; k++) addTree(Wd, x0 + rr(30, 220), y0 + pick([rr(25, 70), rr(180, 225)]), rr(3, 5), rr(7, 11));
      continue;
    }
    if (centre) {
      // Soviet-era apartment blocks
      const n = ri(2, 3);
      for (let k = 0; k < n; k++) {
        const horiz = chance(0.5);
        addBld(Wd, {
          x: x0 + 125 + (horiz ? rr(-20, 20) : (k - (n - 1) / 2) * 70), y: y0 + 125 + (horiz ? (k - (n - 1) / 2) * 62 : rr(-20, 20)),
          w: horiz ? rr(70, 95) : 13, d: horiz ? 13 : rr(70, 95), a: 0, h: pick([12, 15, 15, 18]),
          wallDay: [205, 200, 188], roofDay: [110, 110, 112], heatBias: 0.05,
        });
      }
      for (let k = 0; k < 6; k++) addTree(Wd, x0 + rr(20, 230), y0 + rr(20, 230), rr(3, 5), rr(7, 12), true);
      for (let k = 0; k < 4; k++) Wd.parks.push({ x: x0 + rr(30, 220), y: y0 + pick([22, 228]), a: 0 });
      continue;
    }
    // private houses with gardens along the street frontage
    const lots = 4, L = (SP - 24) / lots;
    for (let a = 0; a < lots; a++) for (let b = 0; b < lots; b++) {
      const edge = a === 0 || b === 0 || a === lots - 1 || b === lots - 1;
      const lx = x0 + 12 + (a + 0.5) * L, ly = y0 + 12 + (b + 0.5) * L;
      if (edge && chance(0.8)) {
        const w = rr(8, 12), d = rr(7, 10);
        // push the house toward the street
        const px = a === 0 ? -1 : a === lots - 1 ? 1 : 0, py = b === 0 ? -1 : b === lots - 1 ? 1 : 0;
        addBld(Wd, { x: lx + px * (L / 2 - w / 2 - 4) + rr(-3, 3), y: ly + py * (L / 2 - d / 2 - 4) + rr(-3, 3), w, d, a: 0, h: rr(3.2, 4.5), gable: true, wallDay: pick([[232, 226, 210], [222, 208, 170], [210, 216, 222]]) });
        if (chance(0.5)) addTree(Wd, lx - px * 12 + rr(-6, 6), ly - py * 12 + rr(-6, 6), rr(2.5, 4), rr(5, 8), true);
        if (chance(0.25)) Wd.parks.push({ x: lx + px * (L / 2 - 2), y: ly + py * (L / 2 - 2), a: px ? Math.PI / 2 : 0 });
      } else if (chance(0.35)) addTree(Wd, lx + rr(-12, 12), ly + rr(-12, 12), rr(3, 4.5), rr(6, 10), true);
    }
  }
  // sidewalk axes for pedestrians
  for (const e of Wd.edges) {
    const inTown = e.a.i >= T0 && e.a.i <= T1 && e.a.j >= T0 && e.a.j <= T1 && e.b.i >= T0 && e.b.i <= T1 && e.b.j >= T0 && e.b.j <= T1;
    if (!inTown) continue;
    const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, l = hyp(dx, dy);
    Wd.axes.push({ x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2, ux: dx / l, uy: dy / l, len: l - 20 });
  }

  // fields: one crop per lattice cell; tree windbreaks along cell edges
  Wd.fields = [];
  const crops = M.winter ? ['snow', 'snow', 'snowp'] : ['wheat', 'wheat', 'sun', 'soil', 'green', 'green', 'grass'];
  for (let i = 0; i < NG; i++) for (let j = 0; j < NG; j++) {
    if (i >= T0 && i < T1 && j >= T0 && j < T1) continue;
    Wd.fields.push({ x0: i * SP + 8, y0: j * SP + 8, x1: (i + 1) * SP - 8, y1: (j + 1) * SP - 8, crop: pick(crops), dir: chance(0.5) });
  }
  const segs = Wd.edges.map(e => [e.a.x, e.a.y, e.b.x, e.b.y]);
  const onRoad = (x, y, m) => { for (const s of segs) if (distSeg(x, y, s[0], s[1], s[2], s[3]) < m) return true; return false; };
  const blocked = (x, y) => nearRiver(x, y, 34) || onRoad(x, y, 9) || Wd.compounds.some(c => hyp(c.x - x, c.y - y) < 70) ||
    (x > T0 * SP - 10 && x < T1 * SP + 10 && y > T0 * SP - 10 && y < T1 * SP + 10);
  for (let i = 0; i <= NG; i++) for (let j = 0; j < NG; j++) {
    for (const vert of [true, false]) {
      if (!chance(0.24)) continue;
      const off = chance(0.5) ? 16 : -16;
      for (let s = 10; s < SP - 10; s += 9) {
        const x = vert ? i * SP + off + rr(-1.5, 1.5) : j * SP + s, y = vert ? j * SP + s : i * SP + off + rr(-1.5, 1.5);
        if (x < 4 || y < 4 || x > WORLD - 4 || y > WORLD - 4 || blocked(x, y)) continue;
        addTree(Wd, x, y, rr(3, 4.6), rr(8, 14));
      }
    }
  }
  // riverbank willows
  for (let y = 20; y < WORLD; y += rr(12, 40)) {
    const side = chance(0.5) ? 1 : -1, x = riverX(y) + side * rr(30, 40);
    if (!onRoad(x, y, 12)) addTree(Wd, x, y, rr(3.5, 5.5), rr(8, 12));
  }

  // roadside farmsteads
  for (let k = 0; k < 14; k++) {
    const e = pick(Wd.edges.filter(e => e.type !== 'town'));
    const t = rr(0.2, 0.8), dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, l = hyp(dx, dy);
    const side = chance(0.5) ? 1 : -1, ox = dy / l * side * 26, oy = -dx / l * side * 26;
    const x = e.a.x + dx * t + ox, y = e.a.y + dy * t + oy;
    if (nearRiver(x, y, 60) || (x > 1450 && x < 2550 && y > 1450 && y < 2550) || Wd.compounds.some(c => hyp(c.x - x, c.y - y) < 150)) continue;
    const a = Math.atan2(dy, dx);
    addBld(Wd, { x, y, w: rr(9, 13), d: rr(7, 9), a, h: rr(3.5, 4.5), gable: true });
    if (chance(0.6)) addBld(Wd, { x: x + ox * 0.6 + Math.cos(a) * 14, y: y + oy * 0.6 + Math.sin(a) * 14, w: rr(8, 12), d: rr(5, 7), a, h: 3, gable: true, roofDay: [120, 120, 124] });
    for (let n = 0; n < 4; n++) addTree(Wd, x + ox * 0.9 + rr(-16, 16), y + oy * 0.9 + rr(-16, 16), rr(3, 4.5), rr(6, 10), true);
    Wd.farms.push({ x, y });
  }
  makePowerlines(Wd);
  buildGround(Wd, M);
  return Wd;
}

// Transmission and distribution lines: pylons/poles with sagging wires. The FPV modes build real
// geometry from these (and use the spans as "fly under the wires" gaps); the UAV view draws them flat.
function makePowerlines(Wd) {
  const near = (x, y, m) => Math.abs(x - Wd.riverX(y)) < m;
  const run = (kind, h, pts, arms) => {
    const poles = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[i + 1] || pts[i - 1] || p, dir = Math.atan2(q.y - p.y, q.x - p.x) + Math.PI / 2;
      poles.push({ x: p.x, y: p.y, h, dir, arms });
      Wd.pylons.push({ x: p.x, y: p.y, h, dir, kind });
    }
    for (let i = 0; i < poles.length - 1; i++) {
      const a = poles[i], b = poles[i + 1], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const span = hyp(b.x - a.x, b.y - a.y);
      // one sagging mid-point per level for a cheap catenary
      for (let L = 0; L < arms; L++) {
        const yh = h - L * (kind === 'tx' ? 4.2 : 1.6), sag = Math.min(span * 0.07, kind === 'tx' ? 6 : 2);
        Wd.wires.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, mx, my, h: yh, sag });
      }
    }
    Wd.powerlines.push({ kind, h, poles, arms });
  };
  // a transmission line sweeping across the southern fields, crossing the river
  const tx = [];
  for (let x = 220; x <= 3820; x += 300) { const y = 1180 + 70 * Math.sin(x / 900); if (!near(x, y, 24)) tx.push({ x, y }); }
  run('tx', 34, tx, 2);
  // a second line up the eastern side
  const tx2 = [];
  for (let y = 300; y <= 3760; y += 320) tx2.push({ x: 3480 + 50 * Math.sin(y / 700), y });
  run('tx', 30, tx2, 2);
  // a low distribution line along the open field west of the village (tight "under the wires" gap)
  const dist = [];
  for (let x = 360; x <= 1380; x += 90) dist.push({ x, y: 1640 });
  run('dist', 9, dist, 1);
}

function addBld(Wd, o) {
  const b = Object.assign({ kind: 'bld', h: 4, a: 0, alive: true, gable: false, dome: false, heatBias: 0 }, o);
  if (!b.wallDay) b.wallDay = [226, 220, 204];
  if (!b.roofDay) b.roofDay = pick(ROOFS);
  if (Wd.winter && !b.dome) b.roofDay = [236, 240, 244];
  b.c = rectCorners(b);
  b.r = hyp(b.w, b.d) / 2;
  Wd.blds.push(b);
  return b;
}
function addTree(Wd, x, y, r, h, garden) {
  Wd.trees.push({ kind: 'tree', x, y, r, h, alive: true, burn: 0, tint: rr(0.85, 1.12), garden: !!garden });
}
function rectCorners(b) {
  const c = Math.cos(b.a), s = Math.sin(b.a), hw = b.w / 2, hd = b.d / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => [b.x + u * c - v * s, b.y + u * s + v * c]);
}
function makeFarm(Wd, cx, cy, gateDir, gateNode) {
  // collective-farm complex: long barns, a silo and a perimeter fence
  const S = 110, wallH = 2.2, t = 1.2, gap = 14;
  const walls = [
    [cx, cy + S / 2, S, t, 'n'], [cx, cy - S / 2, S, t, 's'], [cx + S / 2, cy, t, S, 'e'], [cx - S / 2, cy, t, S, 'w'],
  ];
  const gateSide = gateDir > 0 ? 'e' : 'w';
  for (const [x, y, w, d, side] of walls) {
    const day = [150, 146, 136];
    if (side === gateSide) {
      const segL = (S - gap) / 2;
      addBld(Wd, { kind: 'wall', x, y: y - (gap / 2 + segL / 2), w, d: segL, h: wallH, wallDay: day, roofDay: day });
      addBld(Wd, { kind: 'wall', x, y: y + (gap / 2 + segL / 2), w, d: segL, h: wallH, wallDay: day, roofDay: day });
    } else addBld(Wd, { kind: 'wall', x, y, w, d, h: wallH, wallDay: day, roofDay: day });
  }
  const barns = [];
  barns.push(addBld(Wd, { x: cx - gateDir * 18, y: cy + 30, w: 62, d: 15, a: 0, h: 7, gable: true, roofDay: [132, 134, 138], wallDay: [200, 196, 186] }));
  barns.push(addBld(Wd, { x: cx - gateDir * 18, y: cy - 28, w: 62, d: 15, a: 0, h: 7, gable: true, roofDay: [120, 76, 56], wallDay: [200, 196, 186] }));
  addBld(Wd, { x: cx - gateDir * 46, y: cy + 2, w: 7, d: 7, h: 14, dome: true, wallDay: [190, 192, 196], roofDay: [170, 172, 178] });
  return { x: cx, y: cy, gate: { x: cx + gateDir * (S / 2 + 8), y: cy }, node: gateNode, barns, yard: { x: cx + gateDir * 16, y: cy } };
}
function makeMarket(Wd, x0, y0) {
  Wd.market = { x: x0 + 125, y: y0 + 125, r: 70 };
  const cols = [[200, 60, 50], [60, 110, 170], [230, 200, 70], [70, 150, 90], [220, 220, 220]];
  for (let a = 0; a < 5; a++) for (let b = 0; b < 4; b++) {
    if (chance(0.15)) continue;
    const day = pick(cols);
    addBld(Wd, { kind: 'stall', x: x0 + 55 + a * 35, y: y0 + 70 + b * 36, w: 6, d: 4, h: 2.4, wallDay: day, roofDay: day });
  }
  addBld(Wd, { x: x0 + 125, y: y0 + 26, w: 70, d: 14, h: 6, roofDay: [96, 96, 100] });
  for (let k = 0; k < 8; k++) Wd.parks.push({ x: x0 + 20 + k * 26, y: y0 + 226, a: 0 });
}

// ------------------------------------------------------------ ground texture
const GS = 1024;
function buildGround(Wd, M) {
  const k = WORLD / GS, N = GS * GS, night = M.light < 0.5, win = !!M.winter;
  const heat = new Float32Array(N), cr = new Float32Array(N), cg = new Float32Array(N), cb = new Float32Array(N);
  const n1 = makeNoise(M.seed + 11), n2 = makeNoise(M.seed + 23);
  for (let py = 0; py < GS; py++) {
    const y = (py + 0.5) * k, rx = Wd.riverX(y);
    for (let px = 0; px < GS; px++) {
      const x = (px + 0.5) * k, i = py * GS + px;
      const n = fbm(n1, x / 420, y / 420), fine = n2(x / 14, y / 14);
      let h, c;
      if (win) { h = 0.12 + (n - 0.5) * 0.05; c = [232, 236, 240]; }
      else { h = (night ? 0.16 : 0.33) + (n - 0.5) * 0.14; c = [124, 136, 84]; }
      if (x > 1490 && x < 2510 && y > 1490 && y < 2510) {
        h = win ? 0.16 : night ? 0.22 : 0.38; c = win ? [214, 216, 218] : [138, 136, 104];
      }
      const m = 0.88 + 0.24 * n + (fine - 0.5) * 0.08;
      const dr = Math.abs(x - rx);
      if (dr < 24) { c = win ? [196, 210, 222] : [52, 74, 82]; h = win ? 0.1 : night ? 0.34 : 0.18; }
      else if (dr < 34) { c = win ? [220, 226, 230] : [110, 116, 76]; h = win ? 0.13 : night ? 0.25 : 0.24; }
      heat[i] = h + (fine - 0.5) * 0.03;
      cr[i] = c[0] * m; cg[i] = c[1] * m; cb[i] = c[2] * m;
    }
  }
  // fields
  for (const f of Wd.fields) {
    const x0 = Math.floor(f.x0 / k), x1 = Math.ceil(f.x1 / k), y0 = Math.floor(f.y0 / k), y1 = Math.ceil(f.y1 / k);
    for (let py = y0; py < y1; py++) {
      const y = (py + 0.5) * k, rx = Wd.riverX(y);
      for (let px = x0; px < x1; px++) {
        const x = (px + 0.5) * k;
        if (Math.abs(x - rx) < 36) continue;
        const i = py * GS + px, stripe = ((f.dir ? px : py) % 3) === 0 ? 0.9 : 1.03;
        const n = n2(x / 60, y / 60) * 0.18 + 0.91;
        let c, h;
        switch (f.crop) {
          case 'wheat': c = [214, 188, 112]; h = night ? 0.17 : 0.4; break;
          case 'sun': c = [206, 178, 38]; h = night ? 0.18 : 0.3; if (((px * 7 + py * 13) % 5) === 0) c = [84, 96, 40]; break;
          case 'soil': c = [72, 58, 46]; h = night ? 0.22 : 0.5; break;
          case 'green': c = [86, 124, 58]; h = night ? 0.15 : 0.26; break;
          case 'grass': c = [118, 138, 78]; h = night ? 0.16 : 0.3; break;
          case 'snow': c = [238, 241, 246]; h = 0.11; break;
          default: c = [226, 230, 234]; h = 0.13; stripe < 1 && (c = [150, 140, 128]); break; // snow over ploughed furrows
        }
        cr[i] = c[0] * stripe * n; cg[i] = c[1] * stripe * n; cb[i] = c[2] * stripe * n;
        heat[i] = h * (stripe < 1 ? 1.06 : 1) + (n - 1) * 0.04;
      }
    }
  }
  const mk = fn => {
    const c = document.createElement('canvas'); c.width = c.height = GS;
    const g = c.getContext('2d'), id = g.createImageData(GS, GS), d = id.data;
    for (let i = 0; i < N; i++) { const o = i * 4; fn(i, d, o); d[o + 3] = 255; }
    g.putImageData(id, 0, 0);
    return c;
  };
  const L = M.light;
  Wd.gWhot = mk((i, d, o) => { const v = clamp(heat[i], 0, 1) * 255; d[o] = d[o + 1] = d[o + 2] = v; });
  Wd.gBhot = mk((i, d, o) => { const v = 255 - clamp(heat[i], 0, 1) * 255; d[o] = d[o + 1] = d[o + 2] = v; });
  Wd.gTv = mk((i, d, o) => { d[o] = cr[i] * L; d[o + 1] = cg[i] * L; d[o + 2] = cb[i] * L * (L < 0.5 ? 1.35 : 1); });
  Wd.gDay = mk((i, d, o) => { d[o] = cr[i]; d[o + 1] = cg[i]; d[o + 2] = cb[i]; });
  Wd.groundHeat = night ? 0.16 : win ? 0.12 : 0.33;
  // minimap
  const mm = document.createElement('canvas'); mm.width = mm.height = 256;
  const g = mm.getContext('2d');
  g.save(); g.translate(0, 256); g.scale(1, -1); g.drawImage(Wd.gDay, 0, 0, 256, 256); g.restore();
  g.fillStyle = 'rgba(0,10,4,0.5)'; g.fillRect(0, 0, 256, 256);
  const s = 256 / WORLD;
  g.lineCap = 'round';
  for (const e of Wd.edges) {
    g.strokeStyle = e.type === 'dirt' ? 'rgba(200,180,140,0.55)' : 'rgba(230,230,230,0.8)';
    g.lineWidth = e.type === 'hwy' ? 2 : 1;
    g.beginPath(); g.moveTo(e.a.x * s, 256 - e.a.y * s); g.lineTo(e.b.x * s, 256 - e.b.y * s); g.stroke();
  }
  g.fillStyle = 'rgba(240,240,230,0.75)';
  for (const b of Wd.blds) g.fillRect(b.x * s - 0.6, 256 - b.y * s - 0.6, Math.max(1.2, b.w * s), Math.max(1.2, b.d * s));
  Wd.minimap = mm;
}

// ============================================================ entities
let uid = 0;
function mkPed(x, y, o = {}) {
  return Object.assign({
    kind: 'ped', id: ++uid, x, y, hd: rr(0, TAU), hx: x, hy: y, rad: 18, tx: x, ty: y, idle: rr(0, 8), walk: rr(1.1, 1.5),
    role: 'civ', hostile: false, alive: true, heat: rr(0.84, 0.93), flee: 0, fx: 0, fy: 0, day: pick(CLOTH),
    axis: null, along: 0, side: 8, identified: false, occ: 1,
  }, o);
}
function mkVeh(type, o = {}) {
  const T = VT[type];
  const v = Object.assign({
    kind: 'veh', id: ++uid, type, L: T.L, Wd: T.W, Hh: T.H, x: 0, y: 0, hd: 0, vhd: null, spd: 0, maxSpd: rr(10, 15),
    from: null, to: null, t: 0, len: 1, path: null, pi: 0, waits: null, waited: -1, onEnd: 'park', wait: 0, parked: false,
    hostile: false, alive: true, heat: 0.5, eng: 0.85, day: pick(CIV_CAR), occ: T.occ, identified: false, blocked: 0, turret: 0,
  }, o);
  if (v.hostile && !o.day) v.day = pick(MIL);
  return v;
}
function vehPos(v) {
  const A = v.from, B = v.to, dx = B.x - A.x, dy = B.y - A.y, L = hyp(dx, dy) || 1, ux = dx / L, uy = dy / L;
  v.len = L; v.x = A.x + ux * v.t + uy * LANE; v.y = A.y + uy * v.t - ux * LANE; v.hd = Math.atan2(uy, ux);
}
function placeOnEdge(v, a, b, t) { v.from = a; v.to = b; v.t = t; vehPos(v); v.vhd = v.hd; return v; }
function setPath(v, path, t = 0) { v.path = path; v.pi = 1; placeOnEdge(v, path[0], path[1], t); return v; }
function bfs(Wd, a, b) {
  const prev = new Map([[a, null]]), q = [a];
  while (q.length) {
    const n = q.shift(); if (n === b) break;
    for (const m of n.adj) if (!prev.has(m)) { prev.set(m, n); q.push(m); }
  }
  if (!prev.has(b)) return null;
  const p = []; for (let n = b; n; n = prev.get(n)) p.unshift(n);
  return p;
}

// ============================================================ game state
let G = null;
let state = 'menu';
let missionIndex = 0;

function newGame(mi, demo = false) {
  const M = MISSIONS[mi];
  rnd = mulberry32(M.seed);
  uid = 0;
  const Wd = genWorld(M);
  G = {
    M, mi, demo, Wd, t: 0, timeLeft: M.timeLimit, peds: [], vehs: [], missiles: [], threats: [], fx: [], parts: [], fires: [],
    aim: { x: 2000, y: 2000 }, aimT: { x: 2000, y: 2000 }, fovI: 1, fov: ZOOMS[1], lock: null, pidT: 0,
    drone: { cx: 2000, cy: 2000, ang: rr(0, TAU), R: 2400, Rt: 2400, alt: 4000, x: 0, y: 0, hp: 100, hdg: 0 },
    orbitStandoff: false, pal: M.light < 0.5 ? 0 : 0, sel: 'LGM', ammo: Object.assign({}, M.ammo), rail: 0, flares: M.flares || 6, flareT: 0,
    survival: !!M.survival, wave: 0, waveStart: 0,
    stats: { host: 0, civ: 0, shots: 0, hits: 0, structs: 0, hostVeh: 0 }, msgs: [], pois: [], objectives: [],
    over: null, endT: 0, static: 0, shake: 0, whiteout: 0, warnBeep: 0, help: !demo && mi === 0 && !M.training, helpT: 0, samArmed: true,
    firstImpact: false,
    weather: M.weather || (M.winter ? 'snow' : 'fair'),
    clouds: [], wind: { x: rr(-10, 10), y: rr(-10, 10) }, windT: 0,
    training: !demo && !!M.training, trainStep: 0, trainDone: {},
  };
  makeClouds(G);
  populate(G);
  M.setup(G);
  G.aimT.x = G.aim.x; G.aimT.y = G.aim.y;
  G.drone.cx = G.aim.x; G.drone.cy = G.aim.y;
  G.fov = ZOOMS[G.fovI];
  updateDrone(0);
}

function populate(G) {
  if (G.M.survival) return; // survival is a pure-combat sandbox — no civilians
  const Wd = G.Wd;
  // pedestrians on sidewalks
  for (let k = 0; k < (G.M.winter ? 45 : 70); k++) {
    const a = pick(Wd.axes), along = rr(-a.len / 2, a.len / 2), side = pick([-8.5, 8.5]);
    const p = mkPed(a.x + a.ux * along + a.uy * side, a.y + a.uy * along - a.ux * side, { axis: a, along, side });
    G.peds.push(p);
  }
  // market crowd
  if (Wd.market) for (let k = 0; k < 40; k++) {
    const m = Wd.market, ang = rr(0, TAU), r = Math.sqrt(rnd()) * m.r;
    G.peds.push(mkPed(m.x + Math.cos(ang) * r, m.y + Math.sin(ang) * r, { hx: m.x, hy: m.y, rad: m.r }));
  }
  // farmsteads
  for (const f of Wd.farms) for (let k = 0; k < ri(0, 2); k++) G.peds.push(mkPed(f.x + rr(-15, 15), f.y + rr(-15, 15), { hx: f.x, hy: f.y, rad: 25 }));
  // parked cars
  for (const p of Wd.parks) if (chance(0.65)) {
    const v = mkVeh(chance(0.85) ? 'car' : 'van', { parked: true, x: p.x + rr(-2, 2), y: p.y, hd: p.a + (chance(0.5) ? Math.PI : 0), heat: 0.3, eng: 0.3 });
    v.occ = 0; G.vehs.push(v);
  }
  // moving civilian traffic
  const edges = Wd.edges;
  const nTraffic = G.M.winter ? 16 : 24;
  for (let k = 0; k < nTraffic; k++) {
    const e = pick(edges), type = chance(0.08) ? 'bus' : chance(0.12) ? 'van' : chance(0.1) ? 'truck' : 'car';
    const v = mkVeh(type, { maxSpd: type === 'bus' ? rr(8, 11) : rr(10, 16) });
    if (type === 'truck') v.day = [176, 150, 70];
    if (type === 'bus') v.day = [222, 194, 60];
    const fwd = chance(0.5);
    placeOnEdge(v, fwd ? e.a : e.b, fwd ? e.b : e.a, rr(0, SP * 0.8));
    G.vehs.push(v);
  }
  // tractors working the fields (summer)
  if (!G.M.winter) for (let k = 0; k < 4; k++) {
    const f = pick(Wd.fields.filter(f => f.crop === 'soil' || f.crop === 'wheat'));
    const v = mkVeh('tractor', { parked: true, x: (f.x0 + f.x1) / 2, y: (f.y0 + f.y1) / 2, day: [40, 120, 60], field: f, fdir: f.dir, maxSpd: 3 });
    v.hd = f.dir ? Math.PI / 2 : 0; G.vehs.push(v);
  }
}

// ------------------------------------------------------------ weather & cloud shadows
function makeClouds(G) {
  const dens = { clear: 2, fair: 5, cloud: 10, overcast: 15, rain: 14, snow: 8, fog: 4, dust: 5 }[G.weather] || 5;
  const dark = G.weather === 'overcast' || G.weather === 'rain' ? 0.34 : G.weather === 'cloud' ? 0.24 : 0.16;
  for (let k = 0; k < dens; k++) {
    G.clouds.push({ x: rr(-400, WORLD + 400), y: rr(-400, WORLD + 400), rx: rr(180, 520), ry: rr(140, 380), a: rr(0.5, 1) * dark, ph: rr(0, TAU) });
  }
}
function updateClouds(dt) {
  G.windT += dt;
  const wob = 1 + 0.15 * Math.sin(G.windT * 0.2);
  for (const c of G.clouds) {
    c.x += G.wind.x * dt * wob; c.y += G.wind.y * dt * wob;
    if (c.x < -600) c.x += WORLD + 1200; else if (c.x > WORLD + 600) c.x -= WORLD + 1200;
    if (c.y < -600) c.y += WORLD + 1200; else if (c.y > WORLD + 600) c.y -= WORLD + 1200;
  }
}

// ------------------------------------------------------------ messages / POIs / objectives
function msg(text, color = '#cfe8c8', from) {
  if (!G || G.demo) return;
  G.msgs.push({ t: G.t, text: from ? from + ': ' + text : text, color });
  if (G.msgs.length > 8) G.msgs.shift();
  Snd.radio();
}
function cls(e) {
  if (e.kind === 'ped') return e.role === 'civ' ? 'CIVILIAN' : e.role === 'hvt' ? 'HOSTILE OFFICER' : 'HOSTILE INFANTRY';
  const nm = {
    car: 'CAR', van: 'VAN', bus: 'BUS', tractor: 'TRACTOR', truck: 'TRUCK', fuel: 'FUEL TANKER', tank: 'MBT', ifv: 'IFV',
    spg: 'SP HOWITZER', tel: 'SAM LAUNCHER', radar: 'SEARCH RADAR', staff: 'STAFF VEHICLE',
  }[e.type];
  return (e.hostile ? 'HOSTILE ' : 'CIVILIAN ') + (e.hvt ? 'HVT — ' : '') + nm;
}

// ============================================================ missions
function farmFor(G, sx, sy) {
  const cs = G.Wd.compounds;
  return cs.slice().sort((a, b) => (b.x * sx + b.y * sy) - (a.x * sx + a.y * sy))[0];
}
function clearArea(G, x, y, r) {
  const Wd = G.Wd;
  Wd.trees = Wd.trees.filter(t => hyp(t.x - x, t.y - y) > r);
  Wd.blds = Wd.blds.filter(b => hyp(b.x - x, b.y - y) > r + b.r);
  G.peds = G.peds.filter(p => hyp(p.x - x, p.y - y) > r);
}
function berm(G, x, y, r) {
  for (let k = 0; k < 6; k++) {
    if (k === 0) continue; // opening for the vehicle
    const a = k / 6 * TAU;
    addBld(G.Wd, { kind: 'wall', x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, w: r * 1.05, d: 2.2, a: a + Math.PI / 2, h: 1.2, wallDay: [110, 96, 70], roofDay: [120, 106, 78] });
  }
}
function infantry(G, n, x, y, rad, o = {}) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const p = mkPed(x + rr(-rad, rad) * 0.7, y + rr(-rad, rad) * 0.7, Object.assign({ role: 'inf', hostile: true, hx: x, hy: y, rad, day: pick(MIL), walk: rr(0.9, 1.3) }, o));
    G.peds.push(p); out.push(p);
  }
  return out;
}
function samSite(G, e, radar, range, rangeBlind) {
  e.sam = { radar, range, rangeBlind, cd: rr(18, 26), active: true };
}

const MISSIONS = [
  {
    id: 't0', name: 'FLIGHT TRAINING', sub: 'Learn the sensor, the track and the shot', tod: 'SUMMER · DAY', light: 1, seed: 1000, training: true, weather: 'fair',
    region: 'Training range west of Zelena Balka',
    timeLimit: 900, civLimit: 9, ammo: { LGM: 6, LGB: 2 },
    brief: [
      'Welcome to Steppe Hawk. This is a safe range with derelict target vehicles and no threats. Your instructor will walk you through the sensor, positive identification and a guided shot.',
      'Follow the prompts in the top-left radio log. Take your time — there is no clock pressure and nothing here will shoot back.',
    ],
    threats: 'None. A safe training range.',
    setup(G) {
      const cx = 1250, cy = 2760;
      clearArea(G, cx, cy, 130);
      const hulks = [
        mkVeh('tank', { hostile: true, parked: true, x: cx, y: cy, hd: 0.4, heat: 0.5 }),
        mkVeh('ifv', { hostile: true, parked: true, x: cx + 34, y: cy - 10, hd: 1.1, heat: 0.5 }),
        mkVeh('truck', { hostile: true, parked: true, x: cx - 30, y: cy + 14, hd: 0.2, heat: 0.45 }),
      ];
      G.vehs.push(...hulks);
      G.trainRange = { x: cx, y: cy };
      G.objectives = [{ text: 'Complete the training syllabus', done: () => G.trainStep >= TRAIN_STEPS.length, count: () => Math.min(G.trainStep, TRAIN_STEPS.length) + '/' + TRAIN_STEPS.length }];
      G.pois.push({ x: cx, y: cy, r: 160, label: 'RANGE' });
      G.aim.x = 1900; G.aim.y = 2300; G.fovI = 0;
      msg('Steppe Hawk, this is your instructor. Welcome aboard. Let\'s start with the camera.', '#9fd8ff', 'INSTRUCTOR');
    },
  },
  {
    id: 'm1', name: 'STEPPE SHIELD', sub: 'SEAD — destroy an air-defence battery', tod: 'SUMMER · DAY', light: 1, seed: 1941,
    region: 'Kharkiv sector, east of the village of Zelena Balka',
    timeLimit: 540, civLimit: 3, ammo: { LGM: 4, LGB: 2 },
    brief: [
      'An enemy surface-to-air missile battery has moved in near a collective farm north-east of Zelena Balka. While it is active, our aircraft cannot fly over this sector.',
      'Locate the battery, positively identify its search radar and both launchers, and destroy them. The radar extends the battery\'s engagement range. Once the radar is down, the launchers can only engage at short range.',
      'Expect missile launches against your aircraft. Watch for the launch warning and release flares (FLR / C) just before the missile reaches you, not at launch.',
    ],
    threats: 'SAM battery (radar-guided, about 4.5 km range). Infantry at the site.',
    setup(G) {
      const f = farmFor(G, 1, 1);
      const sx = f.x + (f.x < 3000 ? 40 : -40), sy = f.y - 210;
      clearArea(G, sx, sy, 75);
      const radar = mkVeh('radar', { hostile: true, parked: true, x: sx, y: sy + 18, hd: 0.3, heat: 0.62, eng: 0.8 });
      const t1 = mkVeh('tel', { hostile: true, parked: true, x: sx - 38, y: sy - 18, hd: 1.2, heat: 0.55 });
      const t2 = mkVeh('tel', { hostile: true, parked: true, x: sx + 40, y: sy - 22, hd: 1.9, heat: 0.55 });
      berm(G, t1.x, t1.y, 9); berm(G, t2.x, t2.y, 9); berm(G, radar.x, radar.y, 8);
      samSite(G, t1, radar, 4500, 2600); samSite(G, t2, radar, 4500, 2600);
      G.vehs.push(radar, t1, t2,
        mkVeh('truck', { hostile: true, parked: true, x: sx + 8, y: sy - 50, hd: 0, heat: 0.4 }),
        mkVeh('truck', { hostile: true, parked: true, x: sx - 14, y: sy - 52, hd: 0.1, heat: 0.4 }));
      infantry(G, 6, sx, sy, 40);
      infantry(G, 3, f.yard.x, f.yard.y, 25);
      G.objectives = [
        { text: 'Destroy the search radar', done: () => !radar.alive },
        { text: 'Destroy SAM launcher 1', done: () => !t1.alive },
        { text: 'Destroy SAM launcher 2', done: () => !t2.alive },
      ];
      G.pois.push({ x: sx + rr(-120, 120), y: sy + rr(-120, 120), r: 300, label: 'SUSPECTED SAM' });
      G.aim.x = lerp(2000, sx, 0.35); G.aim.y = lerp(2000, sy, 0.35);
      G.fovI = 1;
      msg('Steppe Hawk, this is Dnipro Control. A SAM battery is active near the farm to the north-east. You are cleared to engage positively identified hostiles.', '#9fd8ff', 'DNIPRO');
    },
  },
  {
    id: 'm2', name: 'IRON RIVER', sub: 'Interdict an armoured column before the bridge', tod: 'WINTER · DAY', light: 0.95, winter: true, seed: 2202,
    region: 'Siverskyi crossing, river line west of the bridge',
    timeLimit: 420, civLimit: 2, ammo: { LGM: 8, LGB: 1 },
    brief: [
      'An armoured column (tanks, IFVs and a fuel tanker) is advancing east along the main road toward the river bridge. Civilians evacuating the village are using the same road.',
      'Destroy every vehicle in the column before any of them crosses the bridge. Wherever possible, strike in open country rather than in the village.',
      'The tanker is the column\'s fuel. Use the heavy bomb on it while the column is bunched up.',
    ],
    threats: 'None to the aircraft. Heavy civilian traffic on the road.',
    setup(G) {
      const Wd = G.Wd, path = [];
      for (let i = 0; i <= 16; i++) path.push(Wd.node(i, 8));
      const order = ['tank', 'ifv', 'fuel', 'tank', 'ifv'];
      const col = order.map((type, k) => {
        const v = mkVeh(type, { hostile: true, maxSpd: 11, onEnd: 'exit', heat: 0.62, column: true });
        if (type === 'fuel') v.day = [92, 98, 70];
        setPath(v, path, -k * 22 - 10);
        G.vehs.push(v); return v;
      });
      // evacuation traffic heading east too
      for (let k = 0; k < 5; k++) { const v = mkVeh('car', { maxSpd: 13, onEnd: 'park' }); setPath(v, path.slice(ri(3, 6)), rr(0, 200)); G.vehs.push(v); }
      const bridgeX = Wd.riverX(2000);
      G.bridgeX = bridgeX;
      G.objectives = [{ text: 'Destroy the armoured column (5 vehicles)', done: () => col.every(v => !v.alive), count: () => col.filter(v => !v.alive).length + '/5' }];
      G.failCheck = () => col.some(v => v.alive && v.x > bridgeX + 30) ? 'A column vehicle crossed the bridge' : null;
      G.pois.push({ x: bridgeX, y: 2000, r: 0, label: 'BRIDGE' });
      G.pois.push({ ent: col[0], label: 'COLUMN', until: 70 });
      G.aim.x = 380; G.aim.y = 2000; G.fovI = 2;
      msg('Steppe Hawk, the column is entering your sector from the west. Do not let it reach the bridge. Civilians are evacuating on the same road.', '#9fd8ff', 'DNIPRO');
    },
  },
  {
    id: 'm3', name: 'NIGHT HARVEST', sub: 'Counter-battery at night', tod: 'SUMMER · NIGHT', light: 0.16, seed: 3307,
    region: 'Zaporizhzhia sector, sunflower fields south of Zelena Balka',
    timeLimit: 600, civLimit: 3, ammo: { LGM: 6, LGB: 2 },
    brief: [
      'An enemy self-propelled artillery battery is shelling the village from a tree line to the south. Its muzzle flashes stand out on thermal, so watch for them.',
      'Destroy all three howitzers. An ammunition truck and gun crews are with them.',
      'Intelligence reports a mobile SAM in the area that has not been located. It will probably start engaging once you strike.',
    ],
    threats: 'Mobile SAM (self-cued, about 3 km range), location unknown.',
    setup(G) {
      const Wd = G.Wd;
      // gun line along a windbreak south-west
      const j = 3, gy = j * SP + 30, gx0 = 1150;
      clearArea(G, gx0 + 120, gy, 140);
      for (let x = gx0 - 60; x < gx0 + 300; x += 9) addTree(Wd, x + rr(-2, 2), gy + 18 + rr(-2, 2), rr(3.5, 4.8), rr(9, 13));
      const guns = [0, 1, 2].map(k => {
        const v = mkVeh('spg', { hostile: true, parked: true, x: gx0 + 30 + k * 85 + rr(-8, 8), y: gy + rr(-3, 3), hd: Math.PI / 2 + rr(-0.2, 0.2), heat: 0.6, turret: rr(-0.2, 0.2) });
        v.gun = { cd: rr(4, 14) }; G.vehs.push(v); return v;
      });
      G.vehs.push(mkVeh('truck', { hostile: true, parked: true, x: gx0 + 140, y: gy - 45, hd: 0.2, heat: 0.45 }));
      for (const g of guns) infantry(G, 2, g.x, g.y - 12, 12);
      // hidden mobile SAM east of the village
      const f = farmFor(G, 1, -1);
      const tel = mkVeh('tel', { hostile: true, parked: true, x: f.yard.x, y: f.yard.y + 8, hd: 0, heat: 0.5 });
      samSite(G, tel, null, 0, 3100);
      tel.sam.active = false;
      G.vehs.push(tel);
      infantry(G, 3, f.yard.x, f.yard.y, 20);
      G.guns = guns;
      G.objectives = [
        { text: 'Destroy the howitzers', done: () => guns.every(v => !v.alive), count: () => guns.filter(v => !v.alive).length + '/3' },
        { text: '(Optional) Destroy the mobile SAM', done: () => !tel.alive, optional: true },
      ];
      G.pois.push({ x: gx0 + 140 + rr(-150, 150), y: gy + rr(-150, 150), r: 380, label: 'ARTY SECTOR' });
      G.aim.x = 1700; G.aim.y = 1500; G.fovI = 1;
      G.pal = 0;
      msg('Steppe Hawk, the village is under artillery fire from the south. Find those guns. Watch for muzzle flashes on thermal.', '#9fd8ff', 'DNIPRO');
    },
  },
  {
    id: 'm4', name: 'COMMAND POST', sub: 'Track and strike a high-value target', tod: 'SUMMER · DUSK', light: 0.55, seed: 4419,
    region: 'Occupied village of Zelena Balka',
    timeLimit: 480, civLimit: 1, ammo: { LGM: 4, LGB: 0 },
    brief: [
      'A senior enemy commander is leaving a forward command post at a collective farm. Two IFVs are escorting his staff vehicle.',
      'The convoy will drive through the occupied village. It is expected to stop at the market, which is crowded at this hour, and then head north out of the sector.',
      'Destroy the staff vehicle on open road. Do not strike in the village. You may engage the escort.',
    ],
    threats: 'Escorting IFVs. A crowded market and civilian traffic.',
    setup(G) {
      const Wd = G.Wd;
      const f = farmFor(G, -1, -1);
      const start = f.node, marketNode = Wd.node(7, 9), exitNode = Wd.node(8, 16);
      const p1 = bfs(Wd, start, marketNode), p2 = bfs(Wd, marketNode, exitNode);
      const path = p1.concat(p2.slice(1));
      const waits = {}; waits[p1.length - 1] = 40;
      const hvt = mkVeh('staff', { hostile: true, hvt: true, maxSpd: 12, onEnd: 'exit', waits, heat: 0.6, day: [40, 46, 36] });
      setPath(hvt, path, 0);
      const esc = [1, 2].map(k => setPath(mkVeh('ifv', { hostile: true, maxSpd: 12, onEnd: 'exit', heat: 0.6 }), path, -k * 20));
      G.vehs.push(hvt, ...esc);
      infantry(G, 4, f.yard.x, f.yard.y, 25);
      // extra crowd at the market
      const m = Wd.market;
      for (let k = 0; k < 25; k++) G.peds.push(mkPed(m.x + rr(-60, 60), m.y + rr(-60, 60), { hx: m.x, hy: m.y, rad: m.r }));
      G.objectives = [
        { text: 'Destroy the HVT staff vehicle', done: () => !hvt.alive },
        { text: '(Optional) Destroy the escort IFVs', done: () => esc.every(v => !v.alive), optional: true },
      ];
      G.failCheck = () => hvt.gone ? 'The HVT left the sector' : null;
      G.pois.push({ ent: hvt, label: 'HVT' });
      G.aim.x = hvt.x; G.aim.y = hvt.y; G.fovI = 3;
      G.lock = { type: 'ent', e: hvt };
      msg('Steppe Hawk, the HVT vehicle is under your crosshair now. Track it and wait for open ground. Keep it clean.', '#9fd8ff', 'DNIPRO');
    },
  },
  {
    id: 'm5', name: 'BRIDGE DENIAL', sub: 'Destroy a river-crossing team', tod: 'SUMMER · RAIN', light: 0.8, seed: 5521, weather: 'rain',
    region: 'West bank of the Siverskyi crossing',
    timeLimit: 480, civLimit: 2, ammo: { LGM: 6, LGB: 2 },
    brief: [
      'Enemy engineers are assembling a pontoon crossing beside the road bridge in the rain. Trucks, a fuel bowser and an escorting IFV are working at the water\'s edge.',
      'Destroy the bridging group before the crossing is ready. The fuel bowser will cook off — use it.',
      'A short-range SAM covers the site. Watch your warning and use flares.',
    ],
    threats: 'Short-range SAM at the crossing. Rain reduces contrast.',
    setup(G) {
      const Wd = G.Wd, bx = Wd.riverX(2000), cx = bx - 150, cy = 2000;
      clearArea(G, cx, cy, 70);
      const grp = [
        mkVeh('truck', { hostile: true, parked: true, x: cx, y: cy - 16, hd: 0, heat: 0.5 }),
        mkVeh('truck', { hostile: true, parked: true, x: cx - 20, y: cy + 10, hd: 0.3, heat: 0.5 }),
        mkVeh('fuel', { hostile: true, parked: true, x: cx - 40, y: cy - 4, hd: 0.1, heat: 0.45, day: [92, 98, 70] }),
        mkVeh('ifv', { hostile: true, parked: true, x: cx + 18, y: cy + 20, hd: 1.0, heat: 0.55 }),
      ];
      const tel = mkVeh('tel', { hostile: true, parked: true, x: cx - 54, y: cy - 46, hd: 0.2, heat: 0.5 });
      samSite(G, tel, null, 0, 2300); berm(G, tel.x, tel.y, 9);
      G.vehs.push(...grp, tel);
      infantry(G, 5, cx, cy, 45);
      G.objectives = [
        { text: 'Destroy the bridging group (4 vehicles)', done: () => grp.every(v => !v.alive), count: () => grp.filter(v => !v.alive).length + '/4' },
        { text: '(Optional) Destroy the SAM', done: () => !tel.alive, optional: true },
      ];
      G.pois.push({ x: cx, y: cy, r: 200, label: 'ENGINEERS' });
      G.aim.x = lerp(2000, cx, 0.5); G.aim.y = 2000; G.fovI = 2;
      msg('Steppe Hawk, enemy engineers are laying a pontoon by the bridge. Destroy their equipment before the crossing opens. Expect a SAM.', '#9fd8ff', 'DNIPRO');
    },
  },
  {
    id: 'm6', name: 'NIGHT CONVOY', sub: 'Interdict a resupply run after dark', tod: 'SUMMER · NIGHT', light: 0.16, seed: 6627, weather: 'clear',
    region: 'Main supply route east of Zelena Balka',
    timeLimit: 480, civLimit: 2, ammo: { LGM: 7, LGB: 1 },
    brief: [
      'A night resupply convoy — fuel, ammunition trucks and an IFV escort — is running east on the highway toward the front.',
      'Destroy the convoy before it clears your sector to the east. Engines and crews glow on thermal; use white-hot.',
      'A mobile SAM is hidden nearby and will wake once you strike. Keep your flares ready.',
    ],
    threats: 'Hidden mobile SAM (wakes on first strike).',
    setup(G) {
      const Wd = G.Wd, path = [];
      for (let i = 0; i <= 16; i++) path.push(Wd.node(i, 8));
      const order = ['ifv', 'fuel', 'truck', 'truck', 'ifv'];
      const col = order.map((type, k) => {
        const v = mkVeh(type, { hostile: true, maxSpd: 9, onEnd: 'exit', heat: 0.6, column: true });
        if (type === 'fuel') v.day = [92, 98, 70];
        setPath(v, path, -k * 24 - 10); G.vehs.push(v); return v;
      });
      const f = farmFor(G, 1, -1);
      const tel = mkVeh('tel', { hostile: true, parked: true, x: f.yard.x, y: f.yard.y + 8, hd: 0, heat: 0.5 });
      samSite(G, tel, null, 0, 2800); tel.sam.active = false; G.vehs.push(tel);
      infantry(G, 3, f.yard.x, f.yard.y, 20);
      G.objectives = [
        { text: 'Destroy the resupply convoy (5 vehicles)', done: () => col.every(v => !v.alive), count: () => col.filter(v => !v.alive).length + '/5' },
        { text: '(Optional) Destroy the mobile SAM', done: () => !tel.alive, optional: true },
      ];
      G.failCheck = () => col.some(v => v.escaped) ? 'A convoy vehicle left the sector' : null;
      G.pois.push({ ent: col[0], label: 'CONVOY', until: 80 });
      G.aim.x = 420; G.aim.y = 2000; G.fovI = 2; G.pal = 0;
      msg('Steppe Hawk, a resupply convoy is on the highway heading east. Catch it before it leaves the sector. A mobile SAM will wake once you strike.', '#9fd8ff', 'DNIPRO');
    },
  },
  {
    id: 'm7', name: 'BLIND EYE', sub: 'Hunt an EW jammer in the fog', tod: 'SUMMER · FOG', light: 0.72, seed: 7733, weather: 'fog',
    region: 'Fog-bound fields south-west of Zelena Balka',
    timeLimit: 540, civLimit: 2, ammo: { LGM: 6, LGB: 1 },
    brief: [
      'An enemy electronic-warfare station is jamming our drones from a hide in the fog. Its radar emitter turns slowly; find it by eye.',
      'Destroy the radar/jammer and the SAM launcher covering it. Visibility is poor — zoom carefully and confirm before you shoot.',
      'A staff vehicle and infantry are on site.',
    ],
    threats: 'SAM launcher (radar-cued). Thick fog cuts your sensor range.',
    setup(G) {
      const f = farmFor(G, -1, 1), cx = f.x + 40, cy = f.y - 30;
      clearArea(G, cx, cy, 75);
      const radar = mkVeh('radar', { hostile: true, parked: true, x: cx, y: cy, hd: 0.2, heat: 0.6, eng: 0.7 });
      const tel = mkVeh('tel', { hostile: true, parked: true, x: cx - 32, y: cy - 20, hd: 1.1, heat: 0.5 });
      samSite(G, tel, radar, 3800, 2200); berm(G, tel.x, tel.y, 9); berm(G, radar.x, radar.y, 8);
      G.vehs.push(radar, tel, mkVeh('staff', { hostile: true, parked: true, x: cx + 16, y: cy - 28, hd: 0, heat: 0.5 }));
      infantry(G, 5, cx, cy, 40);
      G.objectives = [
        { text: 'Destroy the EW radar/jammer', done: () => !radar.alive },
        { text: 'Destroy the SAM launcher', done: () => !tel.alive },
      ];
      G.pois.push({ x: cx + rr(-110, 110), y: cy + rr(-110, 110), r: 340, label: 'EMITTER' });
      G.aim.x = lerp(2000, cx, 0.4); G.aim.y = lerp(2000, cy, 0.4); G.fovI = 1;
      msg('Steppe Hawk, an enemy jammer is blinding our drones from the fog to the south-west. Find the emitter and its launcher and take them down.', '#9fd8ff', 'DNIPRO');
    },
  },
  {
    id: 'm8', name: 'STEEL RAIN', sub: 'Strike a massed staging area', tod: 'SUMMER · DAY', light: 1, seed: 8841, weather: 'cloud',
    region: 'Enemy staging area, open steppe south of Zelena Balka',
    timeLimit: 660, civLimit: 4, ammo: { LGM: 12, LGB: 4 },
    brief: [
      'The enemy has massed armour, artillery and air defence in the open ahead of an offensive. This is a target-rich area and a hard one — two SAM sites cover it.',
      'Destroy both search radars and all the launchers to open the airspace, then work the armour and guns. A fuel park sits in the middle of it all.',
      'A generous loadout, but watch your flares — two batteries can put two missiles up at once.',
    ],
    threats: 'Two radar-guided SAM sites (long range). Heavy armour and artillery.',
    setup(G) {
      const Wd = G.Wd;
      // SAM site A (north-west)
      const fa = farmFor(G, -1, 1), ax = fa.x + 40, ay = fa.y - 40; clearArea(G, ax, ay, 70);
      const radarA = mkVeh('radar', { hostile: true, parked: true, x: ax, y: ay + 14, hd: 0.3, heat: 0.62, eng: 0.8 });
      const telA1 = mkVeh('tel', { hostile: true, parked: true, x: ax - 34, y: ay - 16, hd: 1.1, heat: 0.55 });
      const telA2 = mkVeh('tel', { hostile: true, parked: true, x: ax + 36, y: ay - 18, hd: 1.8, heat: 0.55 });
      berm(G, telA1.x, telA1.y, 9); berm(G, telA2.x, telA2.y, 9); berm(G, radarA.x, radarA.y, 8);
      samSite(G, telA1, radarA, 4500, 2600); samSite(G, telA2, radarA, 4500, 2600);
      G.vehs.push(radarA, telA1, telA2);
      infantry(G, 5, ax, ay, 40);
      // SAM site B (south-east)
      const fb = farmFor(G, 1, -1), bx = fb.x - 40, by = fb.y + 36; clearArea(G, bx, by, 60);
      const radarB = mkVeh('radar', { hostile: true, parked: true, x: bx, y: by, hd: 1.0, heat: 0.6, eng: 0.8 });
      const telB1 = mkVeh('tel', { hostile: true, parked: true, x: bx + 32, y: by - 18, hd: 0.4, heat: 0.55 });
      berm(G, telB1.x, telB1.y, 9); berm(G, radarB.x, radarB.y, 8);
      samSite(G, telB1, radarB, 4200, 2400);
      G.vehs.push(radarB, telB1);
      infantry(G, 3, bx, by, 30);
      // armour + artillery + fuel park in the open centre-south
      const mx = 1600, my = 1150; clearArea(G, mx, my, 150);
      const armour = [];
      for (let k = 0; k < 8; k++) {
        const type = pick(['tank', 'tank', 'ifv', 'spg']);
        const v = mkVeh(type, { hostile: true, parked: true, x: mx + (k % 4) * 40 + rr(-6, 6), y: my + Math.floor(k / 4) * 44 + rr(-6, 6), hd: rr(0, TAU), heat: 0.55 });
        if (type === 'spg') { v.gun = { cd: rr(5, 16) }; }
        armour.push(v); G.vehs.push(v);
      }
      const fuelPark = [];
      for (let k = 0; k < 3; k++) { const v = mkVeh('fuel', { hostile: true, parked: true, x: mx + 60 + k * 16, y: my - 40, hd: 0.2, heat: 0.45, day: [92, 98, 70] }); fuelPark.push(v); G.vehs.push(v); }
      infantry(G, 8, mx + 60, my, 70);
      const radars = [radarA, radarB], tels = [telA1, telA2, telB1];
      G.objectives = [
        { text: 'Destroy both search radars', done: () => radars.every(v => !v.alive), count: () => radars.filter(v => !v.alive).length + '/2' },
        { text: 'Destroy the SAM launchers (3)', done: () => tels.every(v => !v.alive), count: () => tels.filter(v => !v.alive).length + '/3' },
        { text: 'Destroy the armour (8)', done: () => armour.every(v => !v.alive), count: () => armour.filter(v => !v.alive).length + '/8' },
        { text: '(Optional) Destroy the fuel park', done: () => fuelPark.every(v => !v.alive), optional: true },
      ];
      G.pois.push({ x: ax, y: ay, r: 260, label: 'SAM A' });
      G.pois.push({ x: bx, y: by, r: 220, label: 'SAM B' });
      G.pois.push({ x: mx + 60, y: my, r: 300, label: 'ARMOUR' });
      G.aim.x = mx; G.aim.y = my + 400; G.fovI = 1;
      msg('Steppe Hawk, large enemy concentration in the open to the south. Two SAM sites are active. Take down the radars first, then go to work. Good hunting.', '#9fd8ff', 'DNIPRO');
    },
  },
  {
    id: 'surv', name: 'SURVIVAL', sub: 'Endless waves — hold the line', tod: 'SUMMER · CLOUD', light: 1, seed: 9099, weather: 'cloud', survival: true,
    region: 'Zelena Balka, under sustained assault',
    timeLimit: 99999, civLimit: 99999, ammo: { LGM: 999, LGB: 999 }, flares: 20,
    brief: [
      'Endless survival. Wave after wave of enemy armour and air defence comes at the village. You have effectively unlimited weapons and a full load of flares, refilled every wave.',
      'Destroy everything inbound. Each wave is bigger and brings more SAMs. Dodge their missiles with flares — two hits will down you.',
      'There is no winning here, only how many waves you hold and how much you kill.',
    ],
    threats: 'Escalating SAM batteries, more every wave.',
    setup(G) {
      G.wave = 0; G.waveStart = G.t;
      spawnWave(G);
      G.objectives = [
        { text: 'WAVES HELD', done: () => false, count: () => '' + Math.max(0, G.wave - 1) },
        { text: 'ARMOUR DESTROYED', done: () => false, count: () => '' + G.stats.hostVeh },
      ];
      G.aim.x = 2000; G.aim.y = 2000; G.fovI = 1;
      msg('Steppe Hawk, hold the line over Zelena Balka. Waves are inbound. Weapons free, and good luck.', '#9fd8ff', 'DNIPRO');
    },
  },
];

// training syllabus: each step shows a prompt and advances when its condition is met
const TRAIN_STEPS = [
  { msg: 'First, the camera. Drag the view (or use WASD / arrow keys) to bring the crosshair onto the RANGE marker to the west.', done: () => hyp(G.aim.x - G.trainRange.x, G.aim.y - G.trainRange.y) < 220 },
  { msg: 'Good. Now zoom in — pinch, the + / − buttons or the zoom slider — until the FOV reads 150 m or tighter.', done: () => G.fov <= 170 },
  { msg: 'There are the derelicts. Tap a vehicle to lock a track on it (or centre it and press TRK / Space).', done: () => G.lock && G.lock.type === 'ent' },
  { msg: 'Hold the track and stay zoomed in to get a positive ID. A hostile gets a red diamond.', done: () => G.lock && G.lock.type === 'ent' && G.lock.e.identified },
  { msg: 'Now the shot. Keep the crosshair on the target and FIRE (F / Enter). The laser flies the weapon all the way in.', done: () => G.stats.hits > 0 },
  { msg: 'Last thing — release flares with FLR (C). Against a real SAM, do it just before the missile reaches you.', done: () => G.flares < 6 },
];
function updateTraining() {
  if (!G.training || G.over || G.trainStep >= TRAIN_STEPS.length) return;
  const step = TRAIN_STEPS[G.trainStep];
  if (!G.trainDone[G.trainStep]) { G.trainDone[G.trainStep] = true; msg(step.msg, '#9fd8ff', 'INSTRUCTOR'); }
  if (step.done()) {
    G.trainStep++; Snd.pid();
    if (G.trainStep >= TRAIN_STEPS.length) msg('That\'s the syllabus. You\'re cleared for operations. Good hunting, Steppe Hawk.', '#b6ff9e', 'INSTRUCTOR');
  }
}

// ------------------------------------------------------------ survival (endless waves)
function spawnWave(G) {
  const Wd = G.Wd;
  G.wave++;
  G.waveStart = G.t;
  const entries = [Wd.node(0, 8), Wd.node(16, 8), Wd.node(8, 0), Wd.node(8, 16)];
  const dest = Wd.node(8, 8);
  const nArmour = 3 + Math.floor(G.wave * 1.5);
  for (let i = 0; i < nArmour; i++) {
    const start = entries[(G.wave + i) % 4];
    const type = pick(['tank', 'tank', 'ifv', 'spg', 'truck']);
    const v = mkVeh(type, { hostile: true, maxSpd: rr(8, 13), onEnd: 'park', heat: 0.6 });
    const path = bfs(Wd, start, dest);
    if (path && path.length > 1) setPath(v, path, -i * 9 - 6);
    else { v.parked = true; v.x = start.x; v.y = start.y; }
    if (type === 'spg') v.gun = { cd: rr(6, 16) };
    G.vehs.push(v);
  }
  const nSam = Math.min(1 + Math.floor(G.wave / 2), 6);
  const comps = Wd.compounds.slice();
  for (let i = 0; i < nSam && comps.length; i++) {
    const f = comps.splice(ri(0, comps.length - 1), 1)[0];
    const tel = mkVeh('tel', { hostile: true, parked: true, x: f.yard.x + rr(-18, 18), y: f.yard.y + rr(-18, 18), hd: rr(0, TAU), heat: 0.5 });
    samSite(G, tel, null, 0, rr(2800, 3600));
    tel.sam.cd = rr(8, 16);
    G.vehs.push(tel);
  }
  G.flares = G.M.flares || 20; // refill flares each wave
  msg('WAVE ' + G.wave + ' inbound — ' + nArmour + ' armour, ' + nSam + ' SAM' + (nSam > 1 ? 's' : '') + '. Weapons free.', '#ffd38a', 'DNIPRO');
  Snd.warn();
}
function updateSurvival(dt) {
  if (!G.survival || G.over) return;
  const aliveHost = G.vehs.filter(v => v.alive && v.hostile).length;
  // next wave when the area is nearly cleared, or on a backstop timer; capped for performance
  if (aliveHost < 44 && (aliveHost <= 2 || (G.t - G.waveStart) > 55)) spawnWave(G);
}

// ============================================================ simulation
function updateDrone(dt) {
  const D = G.drone;
  D.Rt = G.orbitStandoff ? 4300 : 2400;
  D.R += clamp(D.Rt - D.R, -110 * dt, 110 * dt);
  // orbit centre follows the sensor point at aircraft speed
  const dx = G.aim.x - D.cx, dy = G.aim.y - D.cy, d = hyp(dx, dy), st = 75 * dt;
  if (d > st) { D.cx += dx / d * st; D.cy += dy / d * st; } else { D.cx = G.aim.x; D.cy = G.aim.y; }
  D.ang += 58 / D.R * dt;
  D.x = D.cx + Math.cos(D.ang) * D.R; D.y = D.cy + Math.sin(D.ang) * D.R;
  D.hdg = (450 - (D.ang + Math.PI / 2) * 180 / Math.PI) % 360;
}

function update(dt) {
  G.t += dt;
  updateClouds(dt);
  if (!G.demo && !G.over && !G.survival) G.timeLeft -= dt;
  // camera
  if (G.lock && G.lock.type === 'ent') {
    const e = G.lock.e;
    if (e.gone) { G.lock = null; }
    else { G.aimT.x = e.x; G.aimT.y = e.y; }
  }
  G.aimT.x = clamp(G.aimT.x, 0, WORLD); G.aimT.y = clamp(G.aimT.y, 0, WORLD);
  const ka = Math.min(1, dt * 11);
  G.aim.x += (G.aimT.x - G.aim.x) * ka; G.aim.y += (G.aimT.y - G.aim.y) * ka;
  const fT = ZOOMS[G.fovI] * (G.fovFine || 1);
  G.fov = Math.exp(lerp(Math.log(G.fov), Math.log(fT), Math.min(1, dt * 9)));
  updateDrone(dt);
  // PID
  if (G.lock && G.lock.type === 'ent' && G.lock.e.alive && !G.lock.e.identified) {
    if (G.fov <= 170) {
      G.pidT += dt;
      if (G.pidT > 1.4) {
        G.lock.e.identified = true; G.pidT = 0; Snd.pid();
        msg('PID: ' + cls(G.lock.e), G.lock.e.hostile ? '#ff8b7a' : '#8fd0ff');
      }
    } else G.pidT = 0;
  } else G.pidT = 0;

  for (const p of G.peds) updPed(p, dt);
  for (const v of G.vehs) updVeh(v, dt);
  if (G.vehs.some(v => v.gone)) G.vehs = G.vehs.filter(v => !v.gone);
  updWeapons(dt);
  updThreats(dt);
  updFx(dt);
  if (G.demo) return;

  // objectives & end conditions
  G.rail = Math.max(0, G.rail - dt);
  G.flareT = Math.max(0, G.flareT - dt);
  G.static = Math.max(0, G.static - dt);
  if (G.helpT < 30) G.helpT += dt;
  updateTraining();
  updateSurvival(dt);
  if (!G.over) {
    const req = G.objectives.filter(o => !o.optional);
    for (const o of G.objectives) if (!o.reported && o.done()) {
      o.reported = true; msg('Objective complete: ' + o.text.replace('(Optional) ', ''), '#b6ff9e', 'DNIPRO');
    }
    let fail = null;
    if (G.stats.civ > G.M.civLimit) fail = 'Civilian casualty limit exceeded';
    else if (G.drone.hp <= 0) fail = 'Aircraft lost. Datalink terminated';
    else if (G.timeLeft <= 0) fail = 'Out of time. The aircraft is bingo fuel';
    else if (G.failCheck) fail = G.failCheck();
    if (fail) { G.over = { win: false, reason: fail }; G.endT = G.drone.hp <= 0 ? 2.5 : 3.5; msg('MISSION FAILED: ' + fail, '#ff6a5a'); }
    else if (req.every(o => o.done())) {
      G.over = { win: true, reason: 'All primary objectives complete' }; G.endT = 4;
      msg('Good effect on target. Victory. Mission complete — Steppe Hawk, RTB.', '#b6ff9e', 'DNIPRO');
    }
  } else {
    G.endT -= dt;
    if (G.endT <= 0) endMission();
  }
}

function updPed(p, dt) {
  if (!p.alive) { p.heat = Math.max(0.3, p.heat - dt * 0.004); return; }
  let tx, ty, sp;
  if (p.flee > 0) {
    p.flee -= dt;
    const dx = p.x - p.fx, dy = p.y - p.fy, d = hyp(dx, dy) || 1;
    tx = p.x + dx / d * 10; ty = p.y + dy / d * 10; sp = p.hostile ? 3.6 : 4.4;
  } else {
    if (p.idle > 0) { p.idle -= dt; return; }
    tx = p.tx; ty = p.ty; sp = p.walk;
    if (hyp(tx - p.x, ty - p.y) < 0.6) { p.idle = rr(2, 12); newTarget(p); return; }
  }
  const dx = tx - p.x, dy = ty - p.y, d = hyp(dx, dy) || 1, st = Math.min(d, sp * dt);
  p.x = clamp(p.x + dx / d * st, 2, WORLD - 2); p.y = clamp(p.y + dy / d * st, 2, WORLD - 2); p.hd = Math.atan2(dy, dx);
}
function newTarget(p) {
  if (p.axis) {
    const a = p.axis; p.along = clamp(p.along + rr(-45, 45), -a.len / 2, a.len / 2);
    p.tx = a.x + a.ux * p.along + a.uy * p.side; p.ty = a.y + a.uy * p.along - a.ux * p.side;
  } else {
    const ang = rr(0, TAU), r = Math.sqrt(rnd()) * p.rad;
    p.tx = p.hx + Math.cos(ang) * r; p.ty = p.hy + Math.sin(ang) * r;
  }
}

function updVeh(v, dt) {
  if (!v.alive) { v.heat = Math.max(0.36, v.heat - dt * 0.005); return; }
  if (v.type === 'radar') v.dish = (v.dish || 0) + dt * 1.7;
  if (v.sam) updSam(v, dt);
  if (v.gun) updGun(v, dt);
  if (v.type === 'tractor' && v.field) { // plough back and forth
    const f = v.field; v.ph = (v.ph || rr(0, 100)) + dt * 3;
    const span = (f.dir ? f.y1 - f.y0 : f.x1 - f.x0) - 20, s = (v.ph % (2 * span)), pos = s < span ? s : 2 * span - s;
    if (f.dir) { v.y = f.y0 + 10 + pos; v.hd = s < span ? Math.PI / 2 : -Math.PI / 2; } else { v.x = f.x0 + 10 + pos; v.hd = s < span ? 0 : Math.PI; }
    v.vhd = v.hd; v.eng = 0.8; return;
  }
  if (v.parked || !v.from) return;
  if (v.wait > 0) { v.spd = 0; v.wait -= dt; if (v.wait <= 0) advance(v); vehPos(v); return; }
  let target = v.maxSpd * (v.fear > 0 ? 1.35 : 1);
  if (v.fear > 0) v.fear -= dt;
  let blockedNow = false;
  for (const o of G.vehs) {
    if (o === v || o.gone || o.from !== v.from || o.to !== v.to) continue;
    const gap = o.t - v.t;
    if (gap > 0 && gap < 40) {
      const need = (v.L + o.L) / 2 + 3.5;
      target = Math.min(target, Math.max(0, (gap - need) * 0.9));
      if (gap < need + 4 && (!o.alive || o.parked)) blockedNow = true;
    }
  }
  if (blockedNow) { v.blocked += dt; if (v.blocked > 4 && !v.path) { v.blocked = 0; uturn(v); } }
  else v.blocked = 0;
  const acc = target > v.spd ? 3.2 : 9;
  v.spd += clamp(target - v.spd, -acc * dt, acc * dt);
  v.t += v.spd * dt;
  v.eng = lerp(v.eng, v.spd > 1 ? 0.88 : 0.7, dt * 0.1);
  if (v.t >= v.len) arrive(v);
  if (!v.gone) vehPos(v);
}
function uturn(v) { const a = v.from; v.from = v.to; v.to = a; v.t = Math.max(0, v.len - v.t); }
function arrive(v) {
  if (v.path) {
    if (v.waits && v.waits[v.pi] && v.waited !== v.pi) { v.waited = v.pi; v.wait = v.waits[v.pi]; v.t = v.len; v.spd = 0; return; }
    advance(v);
  } else {
    const B = v.to, A = v.from;
    let opts = B.adj.filter(n => n !== A);
    if (!opts.length) opts = [A];
    v.t -= v.len; v.from = B; v.to = pick(opts);
  }
}
function advance(v) {
  const carry = Math.max(0, v.t - v.len);
  if (v.pi >= v.path.length - 1) {
    if (v.onEnd === 'exit') { v.gone = true; v.escaped = true; }
    else { v.parked = true; v.spd = 0; v.t = v.len; }
    return;
  }
  v.from = v.path[v.pi]; v.to = v.path[v.pi + 1]; v.pi++; v.t = carry;
}

function updSam(v, dt) {
  const s = v.sam;
  if (!s.active || G.demo) return;
  if (G.t < 25) return;
  s.cd -= dt;
  const radarUp = s.radar && s.radar.alive;
  const range = radarUp ? s.range : s.rangeBlind;
  const d = hyp(G.drone.x - v.x, G.drone.y - v.y);
  if (s.cd <= 0 && d < range && !G.threats.length) { // one missile in the air at a time keeps flares fair
    s.cd = rr(15, 24);
    G.threats.push({ x: v.x, y: v.y, z: 6, src: v, t: 0 });
    for (let k = 0; k < 14; k++) G.parts.push(smoke(v.x + rr(-6, 6), v.y + rr(-6, 6), rr(0, 6), rr(5, 9), rr(3, 6)));
    G.fx.push({ type: 'flash', x: v.x, y: v.y, t: 0, dur: 0.4, r: 18 });
    msg('MISSILE LAUNCH — release flares', '#ff6a5a', 'RWR');
  }
}
function updGun(v, dt) {
  const g = v.gun;
  g.cd -= dt;
  if (g.cd > 0) return;
  g.cd = rr(9, 16);
  const mx = v.x + Math.cos(v.hd + v.turret) * 6, my = v.y + Math.sin(v.hd + v.turret) * 6;
  G.fx.push({ type: 'flash', x: mx, y: my, t: 0, dur: 0.35, r: 22, z: 2.5 });
  for (let k = 0; k < 8; k++) G.parts.push(smoke(mx + rr(-3, 3), my + rr(-3, 3), 2, rr(4, 7), rr(1, 3)));
  v.heat = Math.min(0.9, v.heat + 0.08);
  if (!G.demo && hyp(G.aim.x - v.x, G.aim.y - v.y) > G.fov) Snd.thud();
  // shells land in the fields on the village outskirts
  const ang = rr(0, TAU), r = rr(560, 760);
  G.pending = G.pending || [];
  G.pending.push({ t: rr(9, 13), x: 2000 + Math.cos(ang) * r, y: 2000 + Math.sin(ang) * r });
  if (!G.artyReported && !G.demo) { G.artyReported = true; msg('Muzzle flashes observed from the southern tree line.', '#ffd38a', 'DNIPRO'); }
}

function fire() {
  if (G.over || G.demo) return;
  const wp = WEAPONS[G.sel];
  if (G.rail > 0) return;
  if (G.ammo[G.sel] <= 0) {
    const other = G.sel === 'LGM' ? 'LGB' : 'LGM';
    msg('WINCHESTER ' + wp.name + (G.ammo[other] > 0 ? ' — switch weapon' : ''), '#ffd38a');
    Snd.click(); return;
  }
  G.ammo[G.sel]--; G.rail = 1.3; G.stats.shots++;
  G.missiles.push({ wp, x: G.drone.x, y: G.drone.y, z: G.drone.alt, px: G.aim.x, py: G.aim.y, t: 0, tti: 0 });
  msg(wp.call + ' — ' + wp.name + ' away. Lasing.', '#ffe9a6');
  Snd.launch();
}
function updWeapons(dt) {
  for (const m of G.missiles) {
    m.t += dt;
    const dxp = G.aim.x - m.px, dyp = G.aim.y - m.py, dp = hyp(dxp, dyp);
    if (dp > 0) { const st = Math.min(dp, m.wp.track * dt); m.px += dxp / dp * st; m.py += dyp / dp * st; }
    const dx = m.px - m.x, dy = m.py - m.y, dz = -m.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz), st = m.wp.speed * dt;
    m.tti = d / m.wp.speed;
    if (d <= st) { m.done = true; explode(m.px, m.py, m.wp, true); }
    else { m.x += dx / d * st; m.y += dy / d * st; m.z += dz / d * st; }
  }
  G.missiles = G.missiles.filter(m => !m.done);
  if (G.pending) {
    for (const s of G.pending) { s.t -= dt; if (s.t <= 0) { s.done = true; explode(s.x, s.y, { kill: 6, wound: 0 }, false); } }
    G.pending = G.pending.filter(s => !s.done);
  }
}
function updThreats(dt) {
  const D = G.drone;
  for (const m of G.threats) {
    m.t += dt;
    const dx = D.x - m.x, dy = D.y - m.y, dz = D.alt - m.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz), sp = 640 * dt;
    m.tti = d / 640;
    m.x += dx / d * sp; m.y += dy / d * sp; m.z += dz / d * sp;
    if ((m.trail = (m.trail || 0) + dt) > 0.05) { m.trail = 0; G.parts.push(smoke(m.x, m.y, m.z, 4, 1, 3.5)); }
    if (d < 60 || m.t > 16) {
      m.done = true;
      if (m.t > 16) continue;
      const pMiss = G.flareT > 0 ? 0.85 : 0.12;
      if (rnd() < pMiss) msg(G.flareT > 0 ? 'Missile decoyed by flares.' : 'Missile missed.', '#b6ff9e', 'RWR');
      else {
        D.hp -= 50; G.static = 1.8; G.shake = 18; Snd.hit();
        msg(D.hp > 0 ? 'HIT! Airframe damaged. ' + D.hp + '% integrity.' : 'CRITICAL DAMAGE', '#ff6a5a', 'RWR');
      }
    }
  }
  G.threats = G.threats.filter(m => !m.done);
  if (G.threats.length && !G.demo) {
    G.warnBeep -= dt;
    if (G.warnBeep <= 0) { G.warnBeep = 0.35; Snd.warn(); }
  }
}
function deployFlares() {
  if (G.over || G.demo) return;
  if (G.flares <= 0) { msg('No flares remaining.', '#ffd38a'); return; }
  if (G.flareT > 0) return;
  G.flares--; G.flareT = 3; Snd.flare();
}

function smoke(x, y, z, size, vz, life = 6) {
  return { type: 'smoke', x, y, z, vx: rr(0.6, 2.2), vy: rr(-0.4, 0.6), vz, size, life, max: life };
}
function explode(x, y, wp, byPlayer) {
  const big = wp.kill > 15;
  G.fx.push({ type: 'flash', x, y, t: 0, dur: big ? 0.8 : 0.55, r: wp.kill * 3.2 });
  G.fx.push({ type: 'wave', x, y, t: 0, dur: big ? 0.95 : 0.6, r: wp.kill * (big ? 6.5 : 4) });
  for (let k = 0; k < (big ? 26 : 16); k++) {
    const a = rr(0, TAU), s = rr(8, big ? 45 : 28);
    G.parts.push({ type: 'debris', x, y, z: 1, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rr(10, big ? 40 : 26), life: rr(1, 2.4), max: 2.4 });
  }
  for (let k = 0; k < (big ? 22 : 12); k++) G.parts.push(smoke(x + rr(-wp.kill, wp.kill), y + rr(-wp.kill, wp.kill), rr(0, 8), rr(5, big ? 16 : 10), rr(1, 5), rr(8, 18)));
  G.fires.push({ x, y, r: wp.kill * 0.6, life: rr(8, 16), max: 16 });
  scorch(x, y, wp.kill * 1.25);
  const onScreen = hyp(x - G.aim.x, y - G.aim.y) < G.fov * 0.8;
  if (onScreen) { G.shake = Math.max(G.shake, big ? 10 : 6); G.whiteout = Math.max(G.whiteout, clamp(600 / G.fov, 0.15, 0.85) * (big ? 1 : 0.7)); }
  if (!G.demo) Snd.boom(byPlayer ? 1 : 0.35);
  if (!byPlayer) return;
  if (!G.firstImpact) {
    G.firstImpact = true;
    for (const v of G.vehs) if (v.sam && !v.sam.active) { v.sam.active = true; v.sam.cd = rr(25, 40); }
  }
  let host = 0, civ = 0, hostTargets = 0;
  const kill = (e, d) => {
    const ext = e.kind === 'veh' ? Math.max(e.L, e.Wd) / 2 : 0, dd = Math.max(0, d - ext);
    if (dd < wp.kill || (dd < wp.wound && rnd() < (1 - (dd - wp.kill) / (wp.wound - wp.kill)) * 0.75)) {
      e.alive = false;
      if (e.kind === 'veh') {
        e.heat = 0.95; e.spd = 0; e.burn = true;
        G.fires.push({ x: e.x, y: e.y, r: Math.max(e.L, e.Wd) * 0.45, life: rr(30, 60), max: 60, ent: e });
        if (e.type === 'fuel' || e.type === 'tel' || e.type === 'spg') { // secondary explosion
          G.fx.push({ type: 'flash', x: e.x, y: e.y, t: -0.4, dur: 0.9, r: 60 });
          for (let k = 0; k < 18; k++) G.parts.push(smoke(e.x + rr(-8, 8), e.y + rr(-8, 8), rr(2, 12), rr(8, 18), rr(3, 8), rr(12, 22)));
        }
      }
      if (e.hostile) { host += e.occ; hostTargets++; if (e.kind === 'veh') G.stats.hostVeh++; }
      else civ += e.occ;
      if (G.lock && G.lock.e === e) G.lock = { type: 'pt', x: e.x, y: e.y };
      return true;
    }
    if (e.kind === 'ped' && dd < wp.wound * 4) { e.flee = rr(8, 20); e.fx = x; e.fy = y; }
    if (e.kind === 'veh') e.fear = 15;
    return false;
  };
  for (const p of G.peds) if (p.alive) { const d = hyp(p.x - x, p.y - y); if (d < 260) kill(p, d); }
  for (const v of G.vehs) if (v.alive) { const d = hyp(v.x - x, v.y - y); if (d < wp.wound + 10) kill(v, d); }
  for (const b of G.Wd.blds) if (b.alive) {
    const d = hyp(b.x - x, b.y - y);
    if (d < wp.kill + b.r * (b.kind === 'wall' ? 0.5 : 0.35)) {
      b.alive = false; b.h = Math.min(b.h, b.kind === 'wall' ? 0.6 : 1.4); b.gable = false; b.dome = false; b.burnHeat = 0.85;
      b.roofDay = [62, 58, 54]; b.wallDay = [80, 74, 68];
      G.stats.structs++;
      if (b.kind !== 'wall') G.fires.push({ x: b.x, y: b.y, r: Math.min(b.w, b.d) * 0.4, life: rr(25, 50), max: 50 });
      if (b.kind === 'bld' && b.w * b.d > 50 && !b.military) civ += rnd() < 0.25 ? 1 : 0;
    }
  }
  for (const t of G.Wd.trees) if (t.alive && hyp(t.x - x, t.y - y) < wp.kill * 1.1) { t.alive = false; t.burn = 1; }
  G.stats.host += host; G.stats.civ += civ;
  if (hostTargets) G.stats.hits++;
  const bda = 'SPLASH. BDA: ' + (host ? host + ' hostile' : 'no hostile casualties') + (civ ? ', ' + civ + ' CIVILIAN CASUALT' + (civ > 1 ? 'IES' : 'Y') : '');
  msg(bda, civ ? '#ff8b7a' : host ? '#b6ff9e' : '#cfe8c8');
  if (civ) setTimeout(() => G && !G.over && msg('Steppe Hawk, we have reports of civilian casualties. Check your fire.', '#ff8b7a', 'DNIPRO'), 1800);
}
function scorch(x, y, r) {
  const Wd = G.Wd, k = GS / WORLD;
  const paint = (c, inner, outer) => {
    const g = c.getContext('2d'), gr = g.createRadialGradient(x * k, y * k, 0, x * k, y * k, r * k);
    gr.addColorStop(0, inner); gr.addColorStop(1, outer);
    g.fillStyle = gr; g.beginPath(); g.arc(x * k, y * k, r * k, 0, TAU); g.fill();
  };
  paint(Wd.gWhot, 'rgba(170,170,170,0.9)', 'rgba(120,120,120,0)');
  paint(Wd.gBhot, 'rgba(85,85,85,0.9)', 'rgba(135,135,135,0)');
  paint(Wd.gTv, 'rgba(22,18,16,0.92)', 'rgba(50,40,30,0)');
  paint(Wd.gDay, 'rgba(22,18,16,0.92)', 'rgba(50,40,30,0)');
}
function updFx(dt) {
  for (const f of G.fx) f.t += dt;
  G.fx = G.fx.filter(f => f.t < f.dur);
  for (const f of G.fires) {
    f.life -= dt;
    if ((f.sm = (f.sm || 0) + dt) > 0.35 && G.parts.length < 700) { f.sm = 0; G.parts.push(smoke(f.x + rr(-f.r, f.r), f.y + rr(-f.r, f.r), 2, rr(3, 6) + f.r * 0.5, rr(3, 6), rr(8, 14))); }
  }
  G.fires = G.fires.filter(f => f.life > 0);
  for (const p of G.parts) {
    p.life -= dt;
    if (p.type === 'smoke') { p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vz *= 0.995; p.size += dt * 1.2; }
    else { p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vz -= 30 * dt; if (p.z < 0) { p.z = 0; p.vx *= 0.5; p.vy *= 0.5; p.vz = 0; } }
  }
  G.parts = G.parts.filter(p => p.life > 0);
  if (G.parts.length > 900) G.parts.splice(0, G.parts.length - 900);
  G.shake = Math.max(0, G.shake - dt * 25);
  G.whiteout = Math.max(0, G.whiteout - dt * 2.2);
}

// ============================================================ rendering
const V = {};
function computeView() {
  const D = G.drone, ax = G.aim.x, ay = G.aim.y;
  let dx = ax - D.x, dy = ay - D.y, gd = hyp(dx, dy);
  if (gd < 300) { dx = dx / (gd || 1) * 300; dy = dy / (gd || 1) * 300; gd = 300; }
  V.ax = ax; V.ay = ay; V.fx = dx / gd; V.fy = dy / gd; V.rx = V.fy; V.ry = -V.fx;
  V.gd = gd; V.E = Math.atan2(D.alt, gd); V.sinE = Math.sin(V.E); V.cosE = Math.cos(V.E); V.cot = V.cosE / V.sinE;
  V.fov = G.fov; V.s = hyp(W, H) / (G.fov * 1.147); V.min = 1.3 / V.s;
  const sh = G.shake;
  V.cx = W / 2 + (sh ? rr(-sh, sh) : 0); V.cy = H / 2 + (sh ? rr(-sh, sh) : 0);
  V.cull = hyp(W / 2 / V.s, H / 2 / (V.s * V.sinE)) + 50;
  V.pal = G.pal; V.L = G.M.light;
  V.sunx = 0.55; V.suny = 0.83;
  V.bearing = ((Math.atan2(V.fx, V.fy) * 180 / Math.PI) + 360) % 360;
}
function setWorldTf() {
  const s = V.s * DPR, a = V.rx * s, c = V.ry * s, b = -V.fx * s * V.sinE, d = -V.fy * s * V.sinE;
  ctx.setTransform(a, b, c, d, (V.cx + VR.x) * DPR - (a * V.ax + c * V.ay), (V.cy + VR.y) * DPR - (b * V.ax + d * V.ay));
}
function w2s(x, y, h = 0) {
  const dx = x - V.ax, dy = y - V.ay;
  return [V.cx + (dx * V.rx + dy * V.ry) * V.s, V.cy - (dx * V.fx + dy * V.fy) * V.s * V.sinE - h * V.cosE * V.s];
}
function s2w(sx, sy) {
  const u = (sx - V.cx) / V.s, v = -(sy - V.cy) / (V.s * V.sinE);
  return [V.ax + V.rx * u + V.fx * v, V.ay + V.ry * u + V.fy * v];
}
function col(h, day, a = 1) {
  let r, g, b;
  if (V.pal === 2) {
    const L = V.L;
    if (h > 0.93) { r = 255; g = 200; b = 120; }
    else { r = day[0] * L; g = day[1] * L; b = day[2] * L * (L < 0.5 ? 1.35 : 1); }
  } else {
    let v = clamp(h, 0, 1); if (V.pal === 1) v = 1 - v;
    r = g = b = v * 255;
  }
  return 'rgba(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ',' + a + ')';
}
const visible = (x, y, extra = 0) => Math.abs(x - V.ax) < V.cull + extra && Math.abs(y - V.ay) < V.cull + extra && hyp(x - V.ax, y - V.ay) < V.cull + extra;

const baseTf = () => ctx.setTransform(DPR, 0, 0, DPR, VR.x * DPR, VR.y * DPR);
function render() {
  computeView();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (PANEL) { ctx.fillStyle = '#05080a'; ctx.fillRect(0, 0, SW, SH); }
  ctx.save();
  baseTf(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
  const night = V.L < 0.5;
  ctx.fillStyle = V.pal === 2 ? `rgb(${120 * V.L | 0},${130 * V.L | 0},${90 * V.L | 0})` : col(G.Wd.groundHeat, [0, 0, 0]);
  ctx.fillRect(0, 0, W, H);
  setWorldTf();
  ctx.imageSmoothingEnabled = true;
  const gimg = V.pal === 0 ? G.Wd.gWhot : V.pal === 1 ? G.Wd.gBhot : G.Wd.gTv;
  ctx.drawImage(gimg, 0, 0, WORLD, WORLD);
  drawClouds();
  drawRoads();
  // ground-level entities
  for (const v of G.vehs) if (visible(v.x, v.y)) drawVeh(v);
  for (const p of G.peds) if (visible(p.x, p.y)) drawPed(p);
  // tall things, painter-sorted far to near
  const tall = [];
  for (const b of G.Wd.blds) if (visible(b.x, b.y, b.r + b.h * V.cot)) { b.dep = b.x * V.fx + b.y * V.fy; tall.push(b); }
  const wide = V.s < 0.45;
  for (const t of G.Wd.trees) if (visible(t.x, t.y, 20)) { t.dep = t.x * V.fx + t.y * V.fy; tall.push(t); }
  tall.sort((a, b) => b.dep - a.dep);
  if (V.pal === 2 && V.L > 0.5) drawShadows(tall);
  for (const o of tall) o.kind === 'tree' ? drawTree(o, wide) : drawBld(o);
  drawPower();
  drawFires();
  drawParts();
  drawMissiles();
  // post
  baseTf();
  drawBloom();
  if (G.whiteout > 0 && V.pal !== 2) { ctx.fillStyle = V.pal === 1 ? `rgba(0,0,0,${G.whiteout * 0.7})` : `rgba(255,255,255,${G.whiteout * 0.7})`; ctx.fillRect(0, 0, W, H); }
  else if (G.whiteout > 0) { ctx.fillStyle = `rgba(255,230,190,${G.whiteout * 0.5})`; ctx.fillRect(0, 0, W, H); }
  postFx(night);
  if (!G.demo) drawHUD();
  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (!G.demo) {
    if (PANEL) { // control-panel edge along the fold / split line
      ctx.strokeStyle = 'rgba(160,255,170,0.25)'; ctx.lineWidth = 1; ctx.beginPath();
      if (LAYOUT === 'book') { ctx.moveTo(PANEL.x + 0.5, 0); ctx.lineTo(PANEL.x + 0.5, SH); } else { ctx.moveTo(0, PANEL.y + 0.5); ctx.lineTo(SW, PANEL.y + 0.5); }
      ctx.stroke();
    }
    drawMinimap();
  }
}

function drawRoads() {
  const types = [['dirt', 6, G.M.winter ? [190, 186, 178] : [158, 136, 100], 0.85], ['town', 9, [78, 78, 80], 1], ['hwy', 11, [70, 70, 72], 1]];
  const night = V.L < 0.5;
  ctx.lineCap = 'round';
  for (const [type, w, day, hm] of types) {
    ctx.beginPath();
    for (const e of G.Wd.edges) {
      if (e.type !== type) continue;
      const mx = (e.a.x + e.b.x) / 2, my = (e.a.y + e.b.y) / 2;
      if (!visible(mx, my, SP)) continue;
      ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y);
    }
    const h = (G.M.winter ? 0.2 : night ? 0.27 : 0.5) * hm;
    ctx.strokeStyle = col(h, day); ctx.lineWidth = Math.max(w, V.min); ctx.stroke();
  }
  // bridge deck over the river on the main road
  const bx = G.Wd.riverX(2000);
  if (visible(bx, 2000, 60)) {
    ctx.fillStyle = col(0.3, [150, 150, 146]); ctx.fillRect(bx - 34, 2000 - 8, 68, 16);
    ctx.fillStyle = col(0.36, [96, 96, 98]); ctx.fillRect(bx - 34, 2000 - 6, 68, 12);
  }
  if (V.fov <= 300 && V.pal === 2) {
    ctx.setLineDash([3, 6]); ctx.lineWidth = 0.25; ctx.strokeStyle = col(0.5, [230, 230, 220], 0.8); ctx.beginPath();
    for (const e of G.Wd.edges) if (e.type === 'hwy' && visible((e.a.x + e.b.x) / 2, (e.a.y + e.b.y) / 2, SP)) { ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y); }
    ctx.stroke(); ctx.setLineDash([]);
  }
}

function hull(pts) {
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  up.pop(); lo.pop(); return lo.concat(up);
}
function drawShadows(tall) {
  ctx.fillStyle = 'rgba(10,14,10,0.28)';
  ctx.beginPath();
  const sx = -V.sunx * 0.9, sy = -V.suny * 0.9;
  for (const o of tall) {
    if (o.kind === 'tree') { if (o.alive) { const k = o.h * 0.8; ctx.moveTo(o.x + sx * k + o.r, o.y + sy * k); ctx.ellipse(o.x + sx * k, o.y + sy * k, o.r, o.r, 0, 0, TAU); } continue; }
    const k = o.h, pts = o.c.map(p => [p[0], p[1]]).concat(o.c.map(p => [p[0] + sx * k, p[1] + sy * k]));
    const hl = hull(pts);
    ctx.moveTo(hl[0][0], hl[0][1]); for (let i = 1; i < hl.length; i++) ctx.lineTo(hl[i][0], hl[i][1]); ctx.closePath();
  }
  ctx.fill('nonzero');
}

function drawBld(b) {
  const night = V.L < 0.5, win = G.M.winter;
  const k = b.h * V.cot, vx = V.fx * k, vy = V.fy * k, c = b.c;
  const wallH = (b.burnHeat ? 0.7 : night ? 0.3 : 0.34) + b.heatBias;
  let roofH = b.burnHeat ? 0.8 : win ? 0.14 : night ? 0.2 : 0.44 + b.heatBias;
  if (b.kind === 'stall') roofH = night ? 0.2 : 0.36;
  let front01 = false;
  for (let i = 0; i < 4; i++) {
    const p = c[i], q = c[(i + 1) & 3], ex = q[0] - p[0], ey = q[1] - p[1];
    const facing = ey * V.fx - ex * V.fy;
    if (i === 0) front01 = facing < 0;
    if (facing >= 0) continue;
    const l = hyp(ex, ey), sun = Math.max(0, (ey * V.sunx - ex * V.suny) / l);
    const f = 0.62 + sun * 0.35;
    ctx.fillStyle = col(wallH + sun * 0.05, mul(b.wallDay, f));
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.lineTo(q[0] + vx, q[1] + vy); ctx.lineTo(p[0] + vx, p[1] + vy); ctx.fill();
  }
  if (b.gable) {
    const kr = (b.h + Math.min(b.w, b.d) * 0.35) * V.cot, rx = V.fx * kr, ry = V.fy * kr;
    // ridge runs along the long side
    const along = b.w >= b.d;
    const m = (a, bb) => [(c[a][0] + c[bb][0]) / 2, (c[a][1] + c[bb][1]) / 2];
    const r0 = along ? m(0, 3) : m(0, 1), r1 = along ? m(1, 2) : m(3, 2);
    const R0 = [r0[0] + rx, r0[1] + ry], R1 = [r1[0] + rx, r1[1] + ry];
    const C = c.map(p => [p[0] + vx, p[1] + vy]);
    const halfA = along ? [C[0], C[1], R1, R0] : [C[0], C[3], R1, R0];
    const halfB = along ? [R0, R1, C[2], C[3]] : [R0, R1, C[2], C[1]];
    // gable end triangles (walls)
    ctx.fillStyle = col(wallH, mul(b.wallDay, 0.75));
    const tri = along ? [[C[0], R0, C[3]], [C[1], R1, C[2]]] : [[C[0], R0, C[1]], [C[3], R1, C[2]]];
    for (const t of tri) { ctx.beginPath(); ctx.moveTo(t[0][0], t[0][1]); ctx.lineTo(t[1][0], t[1][1]); ctx.lineTo(t[2][0], t[2][1]); ctx.fill(); }
    const frontA = along ? front01 : ((c[3][1] - c[0][1]) * V.fx - (c[3][0] - c[0][0]) * V.fy) > 0;
    const faces = frontA ? [[halfB, 1.0], [halfA, 0.78]] : [[halfA, 0.78], [halfB, 1.0]];
    for (const [poly, f] of faces) {
      ctx.fillStyle = col(roofH * (f > 0.9 ? 1.06 : 0.94), mul(b.roofDay, f));
      ctx.beginPath(); ctx.moveTo(poly[0][0], poly[0][1]); for (let i = 1; i < 4; i++) ctx.lineTo(poly[i][0], poly[i][1]); ctx.fill();
    }
  } else {
    ctx.fillStyle = col(roofH, b.roofDay);
    ctx.beginPath(); ctx.moveTo(c[0][0] + vx, c[0][1] + vy);
    for (let i = 1; i < 4; i++) ctx.lineTo(c[i][0] + vx, c[i][1] + vy);
    ctx.fill();
    if (V.s > 1.6) { ctx.strokeStyle = col(roofH * 0.8, mul(b.roofDay, 0.7)); ctx.lineWidth = 0.3; ctx.stroke(); }
  }
  if (b.dome) {
    const kd = (b.h + 3) * V.cot;
    ctx.fillStyle = col(night ? 0.22 : 0.5, b.kind === 'bld' && b.w < 10 ? b.roofDay : [212, 172, 60]);
    ctx.beginPath(); ctx.arc(b.x + V.fx * kd, b.y + V.fy * kd, Math.min(b.w, b.d) * 0.42, 0, TAU); ctx.fill();
  }
  // lit windows at night in TV mode
  if (night && V.pal === 2 && b.kind === 'bld' && b.alive && V.s > 0.8 && (b.x * 7 + b.y) % 3 < 1.4) {
    ctx.fillStyle = 'rgba(255,214,140,0.8)';
    const p = c[0], q = c[1], kk = b.h * 0.5 * V.cot;
    ctx.fillRect((p[0] + q[0]) / 2 + V.fx * kk - 0.5, (p[1] + q[1]) / 2 + V.fy * kk - 0.5, 1, 1);
  }
}
function drawTree(t, wide) {
  const k = t.h * V.cot, x = t.x + V.fx * k, y = t.y + V.fy * k;
  const night = V.L < 0.5, win = G.M.winter;
  if (!t.alive) {
    ctx.fillStyle = col(t.burn > 0 ? 0.6 : 0.3, [40, 36, 30]);
    ctx.beginPath(); ctx.arc(t.x, t.y, t.r * 0.5, 0, TAU); ctx.fill(); return;
  }
  const h = (night ? 0.28 : win ? 0.2 : 0.22) * t.tint;
  const day = win ? mul([96, 86, 76], t.tint) : mul(t.garden ? [70, 110, 54] : [52, 86, 44], t.tint);
  if (!wide) {
    ctx.strokeStyle = col(h, mul(day, 0.6)); ctx.lineWidth = Math.max(0.4, t.r * 0.12);
    ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(x, y); ctx.stroke();
  }
  ctx.fillStyle = col(h, day, win ? 0.75 : 1);
  ctx.beginPath(); ctx.arc(x, y, Math.max(t.r, V.min), 0, TAU); ctx.fill();
  if (!wide) {
    ctx.fillStyle = col(h * 1.12, mul(day, 1.3), win ? 0.5 : 0.9);
    ctx.beginPath(); ctx.arc(x + V.sunx * t.r * 0.3, y + V.suny * t.r * 0.3, t.r * 0.55, 0, TAU); ctx.fill();
  }
}
function drawPed(p) {
  const m = V.min, night = V.L < 0.5;
  if (!p.alive) {
    ctx.strokeStyle = col(p.heat, mul(p.day, 0.7)); ctx.lineWidth = Math.max(0.5, m);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(p.hd) * 1.7, p.y + Math.sin(p.hd) * 1.7); ctx.stroke();
    return;
  }
  const k = 1.7 * V.cot, hx = p.x + V.fx * k, hy = p.y + V.fy * k;
  if (V.pal === 2 && !night && V.s > 2) {
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.45;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - V.sunx * 1.4, p.y - V.suny * 1.4); ctx.stroke();
  }
  ctx.strokeStyle = col(p.heat, p.day); ctx.lineWidth = Math.max(0.55, m);
  ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(hx, hy); ctx.stroke();
  ctx.fillStyle = col(p.heat + 0.04, [214, 180, 150]);
  ctx.beginPath(); ctx.arc(hx, hy, Math.max(0.24, m * 0.7), 0, TAU); ctx.fill();
  if (p.hostile && V.fov <= 300) {
    const kk = 1.1 * V.cot, bx = p.x + V.fx * kk, by = p.y + V.fy * kk;
    ctx.strokeStyle = col(0.5, [30, 30, 30]); ctx.lineWidth = 0.14;
    ctx.beginPath(); ctx.moveTo(bx - Math.cos(p.hd) * 0.3, by - Math.sin(p.hd) * 0.3); ctx.lineTo(bx + Math.cos(p.hd) * 0.9, by + Math.sin(p.hd) * 0.9); ctx.stroke();
  }
}
function drawVeh(v) {
  if (v.vhd == null) v.vhd = v.hd;
  let dh = v.hd - v.vhd; while (dh > Math.PI) dh -= TAU; while (dh < -Math.PI) dh += TAU;
  v.vhd += dh * 0.15;
  const a = v.vhd, ca = Math.cos(a), sa = Math.sin(a);
  const L = v.L, Wd = v.Wd, m = V.min;
  const offs = h => { const k = h * V.cot, wx = V.fx * k, wy = V.fy * k; return [wx * ca + wy * sa, -wx * sa + wy * ca]; };
  const dead = !v.alive;
  const body = dead ? [42, 38, 34] : v.day, bh = dead ? v.heat * 0.9 : (v.parked && !v.hostile && v.eng < 0.5 ? 0.33 : 0.45);
  ctx.save();
  ctx.translate(v.x, v.y); ctx.rotate(a);
  const Ls = Math.max(L, m * 1.4), Ws = Math.max(Wd, m);
  ctx.fillStyle = col(bh * 0.85, mul(body, 0.55));
  ctx.fillRect(-Ls / 2, -Ws / 2, Ls, Ws);
  const tracked = v.type === 'tank' || v.type === 'ifv' || v.type === 'spg';
  const eng = dead ? v.heat : v.eng;
  if (V.s < 0.5) { // wide view: just a hot blob
    ctx.fillStyle = col(Math.max(bh, eng * 0.9), body); ctx.fillRect(-Ls / 2, -Ws / 2, Ls, Ws);
    ctx.restore(); return;
  }
  const [ox, oy] = offs(v.Hh), [hx, hy] = offs(v.Hh * 0.55);
  switch (v.type) {
    case 'tank': case 'ifv': case 'spg': {
      // tracks warm, hull, engine deck at rear, turret
      ctx.fillStyle = col(dead ? v.heat : 0.55 + eng * 0.15, [40, 40, 36]);
      ctx.fillRect(-L / 2, -Wd / 2, L, 0.6); ctx.fillRect(-L / 2, Wd / 2 - 0.6, L, 0.6);
      ctx.fillStyle = col(bh, body); ctx.fillRect(-L / 2 + hx, -Wd / 2 + 0.5 + hy, L, Wd - 1);
      ctx.fillStyle = col(dead ? v.heat : eng, mul(body, 0.85)); ctx.fillRect(-L / 2 + hx, -Wd / 2 + 0.7 + hy, L * 0.3, Wd - 1.4);
      const tr = v.type === 'ifv' ? 0.9 : v.type === 'spg' ? 1.5 : 1.35, tx = v.type === 'spg' ? -0.6 : 0.4;
      ctx.save(); ctx.translate(tx + ox, oy); ctx.rotate(v.turret || 0);
      ctx.fillStyle = col(bh + 0.04, mul(body, 1.1));
      if (v.type === 'spg') ctx.fillRect(-2.2, -1.5, 4.2, 3);
      else { ctx.beginPath(); ctx.arc(0, 0, tr, 0, TAU); ctx.fill(); }
      ctx.strokeStyle = col(bh, mul(body, 0.7)); ctx.lineWidth = v.type === 'ifv' ? 0.15 : 0.22;
      ctx.beginPath(); ctx.moveTo(tr * 0.6, 0); ctx.lineTo(tr + (v.type === 'ifv' ? 1.8 : 4.6), 0); ctx.stroke();
      ctx.restore();
      break;
    }
    case 'tel': {
      ctx.fillStyle = col(bh, body); ctx.fillRect(-L / 2 + hx, -Wd / 2 + hy, L, Wd);
      ctx.fillStyle = col(dead ? v.heat : eng, mul(body, 0.8)); ctx.fillRect(L / 2 - 2.2 + hx, -Wd / 2 + hy, 2.2, Wd);
      if (!dead) {
        ctx.fillStyle = col(0.42, [150, 156, 130]);
        for (let i = 0; i < 4; i++) ctx.fillRect(-L / 2 + 0.4 + ox, -1.4 + i * 0.75 + oy, L * 0.72, 0.55);
      }
      break;
    }
    case 'radar': {
      ctx.fillStyle = col(bh, body); ctx.fillRect(-L / 2 + hx, -Wd / 2 + hy, L, Wd);
      ctx.fillStyle = col(dead ? v.heat : 0.7, body); ctx.fillRect(-L / 2 + hx, -Wd / 2 + hy, 1.8, Wd);
      if (!dead) {
        const [dx, dy] = offs(5.5);
        ctx.save(); ctx.translate(dx, dy); ctx.rotate(v.dish || 0);
        ctx.fillStyle = col(0.5, [190, 196, 180]); ctx.fillRect(-0.4, -3, 0.8, 6); ctx.restore();
      }
      break;
    }
    case 'truck': case 'fuel': {
      ctx.fillStyle = col(dead ? v.heat : eng * 0.9, mul(body, 0.9)); ctx.fillRect(L / 2 - 1.9 + hx, -Wd / 2 + hy, 1.9, Wd);
      if (v.type === 'fuel') { ctx.fillStyle = col(bh, dead ? body : [150, 152, 140]); ctx.beginPath(); ctx.ellipse(-0.9 + ox, oy, L * 0.36, Wd * 0.45, 0, 0, TAU); ctx.fill(); }
      else { ctx.fillStyle = col(bh, mul(body, 1.05)); ctx.fillRect(-L / 2 + ox, -Wd / 2 + oy, L - 2.3, Wd); }
      break;
    }
    case 'bus': {
      ctx.fillStyle = col(bh, body); ctx.fillRect(-L / 2 + ox, -Wd / 2 + oy, L, Wd);
      ctx.fillStyle = col(dead ? v.heat : eng, body); ctx.fillRect(-L / 2 + ox, -Wd / 2 + oy, 1.4, Wd);
      break;
    }
    case 'tractor': {
      ctx.fillStyle = col(dead ? v.heat : eng, body); ctx.fillRect(0.2 + hx, -0.7 + hy, 1.8, 1.4);
      ctx.fillStyle = col(bh, mul(body, 1.1)); ctx.fillRect(-1.6 + ox, -0.9 + oy, 1.8, 1.8);
      ctx.fillStyle = col(0.35, [30, 30, 30]); ctx.fillRect(-L / 2, -Wd / 2, 1.4, 0.5); ctx.fillRect(-L / 2, Wd / 2 - 0.5, 1.4, 0.5);
      break;
    }
    default: { // car, van, staff
      const cab = v.type === 'van' ? 0.75 : v.type === 'staff' ? 0.6 : 0.5;
      ctx.fillStyle = col(dead ? v.heat : eng, mul(body, 0.95)); ctx.fillRect(L / 2 - L * 0.24 + hx, -Wd / 2 + 0.1 + hy, L * 0.24, Wd - 0.2);
      ctx.fillStyle = col(bh + 0.03, mul(body, 1.08)); ctx.fillRect(-L * cab / 2 - 0.3 + ox, -Wd / 2 + 0.15 + oy, L * cab, Wd - 0.3);
      if (V.pal === 2 && !dead && V.s > 3) { ctx.fillStyle = 'rgba(40,60,80,0.6)'; ctx.fillRect(L * cab / 2 - 0.7 + ox, -Wd / 2 + 0.3 + oy, 0.5, Wd - 0.6); }
    }
  }
  if (V.pal === 2 && V.L < 0.6 && !dead && !v.parked && v.from) { // headlights
    ctx.fillStyle = 'rgba(255,240,200,0.18)';
    ctx.beginPath(); ctx.moveTo(L / 2, -Wd / 2); ctx.lineTo(L / 2 + 22, -5); ctx.lineTo(L / 2 + 22, 5); ctx.lineTo(L / 2, Wd / 2); ctx.fill();
  }
  ctx.restore();
}
function drawClouds() {
  if (!G.clouds.length) return;
  // soft moving shadows cast on the ground; cooler (darker) on thermal, shade on TV
  ctx.save();
  ctx.globalCompositeOperation = V.pal === 1 ? 'lighten' : 'multiply';
  for (const c of G.clouds) {
    if (!visible(c.x, c.y, Math.max(c.rx, c.ry) + 200)) continue;
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 1);
    const tone = V.pal === 1 ? [40, 40, 40] : [12, 16, 14];
    g.addColorStop(0, `rgba(${tone[0]},${tone[1]},${tone[2]},${c.a})`);
    g.addColorStop(1, `rgba(${tone[0]},${tone[1]},${tone[2]},0)`);
    ctx.save(); ctx.translate(c.x, c.y); ctx.scale(c.rx, c.ry); ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill(); ctx.restore();
  }
  ctx.restore();
}
function drawPower() {
  const Wd = G.Wd, night = V.L < 0.5, h = night ? 0.3 : 0.26;
  // wires: a two-segment catenary through the sagged mid-point
  ctx.strokeStyle = col(h, [40, 40, 44], 0.85); ctx.lineWidth = Math.max(0.12, V.min * 0.5);
  ctx.beginPath();
  for (const w of Wd.wires) {
    if (!visible(w.mx, w.my, SP)) continue;
    const a = w2s(w.ax, w.ay, w.h), m = w2s(w.mx, w.my, w.h - w.sag), b = w2s(w.bx, w.by, w.h);
    ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(m[0], m[1], b[0], b[1]);
  }
  ctx.stroke();
  // pylons: a vertical shaft with a crossarm
  for (const p of Wd.pylons) {
    if (!visible(p.x, p.y, 20)) continue;
    const base = w2s(p.x, p.y, 0), top = w2s(p.x, p.y, p.h);
    const tx = p.kind === 'tx';
    ctx.strokeStyle = col(h, tx ? [120, 120, 126] : [96, 78, 56], 0.95);
    ctx.lineWidth = Math.max(tx ? 0.5 : 0.3, V.min * (tx ? 1.1 : 0.7));
    ctx.beginPath(); ctx.moveTo(base[0], base[1]); ctx.lineTo(top[0], top[1]); ctx.stroke();
    if (tx) {
      const aw = 7, ax = Math.cos(p.dir) * aw, ay = Math.sin(p.dir) * aw;
      for (let L = 0; L < 2; L++) {
        const c = w2s(p.x, p.y, p.h - L * 4.2), l = w2s(p.x - ax, p.y - ay, p.h - L * 4.2), r = w2s(p.x + ax, p.y + ay, p.h - L * 4.2);
        ctx.beginPath(); ctx.moveTo(l[0], l[1]); ctx.lineTo(r[0], r[1]); ctx.stroke();
        ctx.moveTo(c[0], c[1]);
      }
    }
  }
}
function drawFires() {
  for (const f of G.fires) {
    if (!visible(f.x, f.y, 30)) continue;
    const a = clamp(f.life / 6, 0, 1), fl = 0.75 + Math.random() * 0.35, r = Math.max(f.r * fl * 1.6, V.min * 2.5);
    const k = 1 * V.cot, x = f.x + V.fx * k, y = f.y + V.fy * k;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    if (V.pal === 2) { g.addColorStop(0, `rgba(255,236,170,${0.95 * a})`); g.addColorStop(0.4, `rgba(255,140,40,${0.7 * a})`); g.addColorStop(1, 'rgba(255,80,20,0)'); }
    else if (V.pal === 0) { g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(0.5, `rgba(235,235,235,${0.6 * a})`); g.addColorStop(1, 'rgba(200,200,200,0)'); }
    else { g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(0.5, `rgba(20,20,20,${0.6 * a})`); g.addColorStop(1, 'rgba(60,60,60,0)'); }
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  for (const f of G.fx) {
    if (f.t < 0 || !visible(f.x, f.y, 160)) continue;
    if (f.type === 'wave') {
      const p = f.t / f.dur, rr2 = f.r * p, a = (1 - p) * 0.6;
      const c = V.pal === 1 ? '20,20,20' : '255,255,255';
      ctx.strokeStyle = `rgba(${c},${a})`; ctx.lineWidth = Math.max(V.min, f.r * 0.05 * (1 - p));
      ctx.beginPath(); ctx.arc(f.x, f.y, Math.max(V.min, rr2), 0, TAU); ctx.stroke();
      continue;
    }
    const p = f.t / f.dur, r = f.r * (0.4 + p * 0.8), a = 1 - p;
    const k = (f.z || 2) * V.cot, x = f.x + V.fx * k, y = f.y + V.fy * k;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const c = V.pal === 2 ? '255,230,170' : V.pal === 0 ? '255,255,255' : '0,0,0';
    g.addColorStop(0, `rgba(${c},${a})`); g.addColorStop(0.6, `rgba(${c},${a * 0.5})`); g.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
}
function drawParts() {
  for (const p of G.parts) {
    if (!visible(p.x, p.y, 120)) continue;
    const k = p.z * V.cot, x = p.x + V.fx * k, y = p.y + V.fy * k, a = clamp(p.life / p.max, 0, 1);
    if (p.type === 'smoke') {
      ctx.fillStyle = V.pal === 2 ? `rgba(${V.L < 0.5 ? 30 : 70},${V.L < 0.5 ? 30 : 68},${V.L < 0.5 ? 34 : 64},${a * 0.32})` : col(0.55, [0, 0, 0], a * 0.18);
      ctx.beginPath(); ctx.arc(x, y, p.size, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = col(0.95, [255, 190, 110], a);
      ctx.fillRect(x - 0.3, y - 0.3, Math.max(0.6, V.min), Math.max(0.6, V.min));
    }
  }
}
function drawMissiles() {
  for (const m of G.threats) {
    if (!visible(m.x, m.y, 300)) continue;
    const k = m.z * V.cot;
    ctx.fillStyle = col(1, [255, 240, 200]);
    ctx.beginPath(); ctx.arc(m.x + V.fx * k, m.y + V.fy * k, Math.max(1.5, V.min * 1.6), 0, TAU); ctx.fill();
  }
  for (const m of G.missiles) {
    if (m.z > 250 || !visible(m.x, m.y, 100)) continue;
    const k = m.z * V.cot;
    ctx.fillStyle = col(1, [255, 240, 200]);
    ctx.beginPath(); ctx.arc(m.x + V.fx * k, m.y + V.fy * k, Math.max(0.6, V.min), 0, TAU); ctx.fill();
  }
}

// sensor bloom: thermal cameras bloom and halo around hot spots (fires, blasts, hot engines)
function drawBloom() {
  const bhot = V.pal === 1;
  ctx.save();
  ctx.globalCompositeOperation = bhot ? 'multiply' : 'lighter';
  const halo = (sx2, sy2, rad, inten, warm) => {
    if (sx2 < -rad || sy2 < -rad || sx2 > W + rad || sy2 > H + rad) return;
    const g = ctx.createRadialGradient(sx2, sy2, 0, sx2, sy2, rad);
    if (bhot) { g.addColorStop(0, `rgba(20,20,20,${inten})`); g.addColorStop(1, 'rgba(40,40,40,0)'); }
    else if (V.pal === 2) { g.addColorStop(0, `rgba(255,${warm ? 210 : 245},${warm ? 150 : 220},${inten})`); g.addColorStop(1, 'rgba(255,200,140,0)'); }
    else { g.addColorStop(0, `rgba(255,255,255,${inten})`); g.addColorStop(1, 'rgba(230,230,230,0)'); }
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx2, sy2, rad, 0, TAU); ctx.fill();
  };
  for (const f of G.fires) {
    if (!visible(f.x, f.y, 40)) continue;
    const a = clamp(f.life / 6, 0, 1), [x, y] = w2s(f.x, f.y, 1);
    halo(x, y, Math.max(16, f.r * V.s * 2.2), 0.22 * a, true);
  }
  for (const f of G.fx) {
    if (f.type !== 'flash' || f.t < 0 || !visible(f.x, f.y, 100)) continue;
    const p = f.t / f.dur, [x, y] = w2s(f.x, f.y, f.z || 2);
    halo(x, y, Math.max(24, f.r * V.s * 2.6), 0.4 * (1 - p), true);
  }
  // hot engines of live vehicles in close view
  if (V.s > 1) for (const v of G.vehs) {
    if (!v.alive || v.eng < 0.55 || v.parked || !visible(v.x, v.y, 10)) continue;
    const [x, y] = w2s(v.x, v.y, 1); halo(x, y, 10 * V.s, 0.08, false);
  }
  ctx.restore();
}

// ------------------------------------------------------------ post-processing
const grain = [];
for (let i = 0; i < 4; i++) {
  const c = document.createElement('canvas'); c.width = c.height = 192;
  const g = c.getContext('2d'), id = g.createImageData(192, 192);
  for (let j = 0; j < id.data.length; j += 4) { const v = Math.random() * 255; id.data[j] = id.data[j + 1] = id.data[j + 2] = v; id.data[j + 3] = 255; }
  g.putImageData(id, 0, 0); grain.push(c);
}
let grainPat = null, vignette = null, vigW = 0, vigH = 0;
function postFx(night) {
  const gi = grain[(Math.random() * 4) | 0];
  grainPat = ctx.createPattern(gi, 'repeat');
  ctx.save();
  ctx.globalAlpha = V.pal === 2 ? (night ? 0.12 : 0.035) : 0.075;
  ctx.globalCompositeOperation = 'overlay';
  ctx.translate(Math.random() * 192, Math.random() * 192);
  ctx.fillStyle = grainPat; ctx.fillRect(-192, -192, W + 384, H + 384);
  ctx.restore();
  if (!vignette || vigW !== W || vigH !== H) {
    vigW = W; vigH = H;
    vignette = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vignette.addColorStop(0, 'rgba(0,0,0,0)'); vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
  }
  ctx.fillStyle = vignette; ctx.fillRect(0, 0, W, H);
  drawWeather(night);
  if (G.static > 0) {
    const a = clamp(G.static / 1.2, 0, 1);
    ctx.save(); ctx.globalAlpha = a * 0.75;
    ctx.drawImage(grain[(Math.random() * 4) | 0], 0, 0, W, H);
    ctx.globalAlpha = a;
    for (let i = 0; i < 6; i++) { const y = Math.random() * H, h = Math.random() * 20 + 2; ctx.drawImage(cv, VR.x * DPR, (VR.y + y) * DPR, W * DPR, h * DPR, (Math.random() - 0.5) * 60, y, W, h); }
    ctx.restore();
  }
  if (G.over && !G.over.win && G.drone.hp <= 0) {
    ctx.drawImage(grain[(Math.random() * 4) | 0], 0, 0, W, H);
    txt('LINK LOST', W / 2, H / 2, 28, '#e8e8e8', 'center');
  }
}
// screen-space weather: haze veils, rain streaks and drifting snow. The drift tracks the camera
// motion so precipitation reads as falling through the sensor field.
function drawWeather(night) {
  const wx = G.weather;
  if (wx === 'fog' || wx === 'overcast' || wx === 'dust') {
    const veil = wx === 'dust' ? [120, 104, 78] : wx === 'fog' ? [150, 158, 162] : [120, 128, 134];
    const a = wx === 'fog' ? 0.22 : wx === 'dust' ? 0.16 : 0.1;
    ctx.fillStyle = `rgba(${veil[0]},${veil[1]},${veil[2]},${night ? a * 0.6 : a})`; ctx.fillRect(0, 0, W, H);
  }
  if (wx === 'rain') {
    ctx.save(); ctx.strokeStyle = `rgba(180,200,220,${night ? 0.18 : 0.28})`; ctx.lineWidth = 1;
    const n = Math.round(W * H / 9000), sk = V.s * 0.4, t = G.t * 900;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = ((i * 127.1 + t * 0.7) % (W + 40)) - 20, y = ((i * 311.7 + t) % (H + 40)) - 20;
      ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 14);
    }
    ctx.stroke(); ctx.restore();
    ctx.fillStyle = 'rgba(90,110,130,0.08)'; ctx.fillRect(0, 0, W, H);
  } else if (wx === 'snow') {
    ctx.save(); ctx.fillStyle = `rgba(245,248,252,${night ? 0.5 : 0.75})`;
    const n = Math.round(W * H / 14000), t = G.t * 50;
    for (let i = 0; i < n; i++) {
      const sway = Math.sin((t + i * 23) * 0.03) * 8;
      const x = ((i * 97.3 + sway) % (W + 20)), y = ((i * 211.3 + t) % (H + 20));
      ctx.beginPath(); ctx.arc(x, y, i % 5 === 0 ? 1.8 : 1.1, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
}

// ------------------------------------------------------------ HUD
const HUD = '#c8f7c5', HUD_DIM = 'rgba(200,247,197,0.6)', RED = '#ff5a4a', AMBER = '#ffd36a';
function txt(s, x, y, size = 13, color = HUD, align = 'left', base = 'alphabetic') {
  ctx.font = `${Math.round(size * UI)}px "Share Tech Mono", ui-monospace, "Roboto Mono", "DejaVu Sans Mono", monospace`;
  ctx.textAlign = align; ctx.textBaseline = base;
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.strokeText(s, x, y);
  ctx.fillStyle = color; ctx.fillText(s, x, y);
}
function drawHUD() {
  const u = UI, cx = W / 2, cy = H / 2, D = G.drone;
  const overlay = isTouch && !PANEL; // touch buttons float over the view
  const padL = overlay ? 84 : 14, lh = 17 * u;
  ctx.lineCap = 'butt';
  // crosshair
  ctx.strokeStyle = HUD; ctx.lineWidth = 1.5;
  const g = 10 * u, l = 34 * u;
  ctx.beginPath();
  ctx.moveTo(cx - g - l, cy); ctx.lineTo(cx - g, cy); ctx.moveTo(cx + g, cy); ctx.lineTo(cx + g + l, cy);
  ctx.moveTo(cx, cy - g - l); ctx.lineTo(cx, cy - g); ctx.moveTo(cx, cy + g); ctx.lineTo(cx, cy + g + l);
  ctx.stroke();
  ctx.strokeStyle = HUD_DIM; ctx.lineWidth = 1;
  ctx.beginPath();
  for (const s of [-1, 1]) { ctx.moveTo(cx + s * W * 0.18, cy - 8); ctx.lineTo(cx + s * W * 0.18, cy + 8); ctx.moveTo(cx - 8, cy + s * H * 0.2); ctx.lineTo(cx + 8, cy + s * H * 0.2); }
  ctx.stroke();
  // track box
  if (G.lock) {
    let bx = cx, by = cy, bs = 22 * u;
    if (G.lock.type === 'ent') {
      const e = G.lock.e, [sx, sy] = w2s(e.x, e.y, e.kind === 'ped' ? 0.9 : 1);
      bx = sx; by = sy; bs = Math.max(16 * u, (e.kind === 'veh' ? e.L : 2.5) * V.s * 0.9);
    }
    ctx.strokeStyle = G.lock.type === 'ent' && G.lock.e.identified ? (G.lock.e.hostile ? RED : '#7fd0ff') : HUD; ctx.lineWidth = 2;
    const c = bs * 0.4;
    ctx.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ctx.moveTo(bx + sx * bs, by + sy * (bs - c)); ctx.lineTo(bx + sx * bs, by + sy * bs); ctx.lineTo(bx + sx * (bs - c), by + sy * bs);
    }
    ctx.stroke();
  }
  // identified markers & POIs
  for (const e of G.peds.concat(G.vehs)) {
    if (!e.identified || !e.alive || !visible(e.x, e.y)) continue;
    const [sx, sy] = w2s(e.x, e.y, 2);
    ctx.strokeStyle = e.hostile ? RED : '#7fd0ff'; ctx.lineWidth = 1.5;
    const r = 6 * u;
    ctx.beginPath();
    if (e.hostile) { ctx.moveTo(sx, sy - r - 6); ctx.lineTo(sx + r, sy - 6); ctx.lineTo(sx, sy + r - 6); ctx.lineTo(sx - r, sy - 6); ctx.closePath(); }
    else ctx.arc(sx, sy - 6, r * 0.8, 0, TAU);
    ctx.stroke();
  }
  for (const p of G.pois) {
    if (p.until && G.t > p.until) continue;
    let x = p.x, y = p.y;
    if (p.ent) { if (!p.ent.alive || p.ent.gone) continue; x = p.ent.x; y = p.ent.y; }
    let [sx, sy] = w2s(x, y, 3);
    const m = 40 * u, off = sx < m || sy < m * 1.6 || sx > W - m || sy > H - m;
    const dist = hyp(x - G.aim.x, y - G.aim.y);
    sx = clamp(sx, overlay ? 100 : m, W - (overlay ? 190 : m)); sy = clamp(sy, m * 1.6, H - m);
    ctx.strokeStyle = AMBER; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(sx, sy - 9); ctx.lineTo(sx + 9, sy); ctx.lineTo(sx, sy + 9); ctx.lineTo(sx - 9, sy); ctx.closePath(); ctx.stroke();
    txt(p.label + (off || dist > G.fov * 0.6 ? '  ' + (dist / 1000).toFixed(1) + 'km' : ''), sx, sy - 14 * u, 11, AMBER, 'center');
  }
  // heading tape
  const tw = Math.min(420 * u, W * 0.45), ty = 26 * u;
  ctx.save(); ctx.beginPath(); ctx.rect(cx - tw / 2, 0, tw, ty + 20 * u); ctx.clip();
  ctx.strokeStyle = HUD; ctx.lineWidth = 1;
  const pxd = tw / 90;
  for (let d = Math.floor(V.bearing / 5) * 5 - 50; d <= V.bearing + 50; d += 5) {
    const x = cx + (d - V.bearing) * pxd, big = d % 10 === 0;
    ctx.beginPath(); ctx.moveTo(x, ty); ctx.lineTo(x, ty - (big ? 9 : 5)); ctx.stroke();
    if (d % 30 === 0) { const dd = ((d % 360) + 360) % 360; txt({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[dd] || String(dd / 10).padStart(2, '0'), x, ty - 12 * u, 11, HUD_DIM, 'center'); }
  }
  ctx.restore();
  txt(String(Math.round(V.bearing) % 360).padStart(3, '0'), cx, ty + 16 * u, 14, HUD, 'center');
  // top-left: mission & objectives
  let y = 22 * u;
  txt(G.M.name + '   ' + (G.survival ? 'WAVE ' + G.wave : fmtT(G.timeLeft)), padL, y, 14, (!G.survival && G.timeLeft < 60) ? AMBER : HUD); y += lh;
  for (const o of G.objectives) {
    const d = o.done();
    txt((d ? '■ ' : '□ ') + o.text + (o.count && !d ? ' ' + o.count() : ''), padL, y, 12, d ? '#7fe08f' : o.optional ? HUD_DIM : HUD); y += lh * 0.95;
  }
  if (G.survival) txt('ARMOUR ' + G.stats.hostVeh + '   INFANTRY ' + G.stats.host, padL, y, 12, HUD_DIM);
  else txt('CIV CAS ' + G.stats.civ + '/' + G.M.civLimit + '   HOSTILE ' + G.stats.host, padL, y, 12, G.stats.civ ? AMBER : HUD_DIM);
  y += lh;
  const leftEnd = y;
  // left telemetry
  y = cy - lh * 2;
  const tel = [
    ['ALT', Math.round(D.alt * 3.281) + ' FT'], ['KTAS', '' + Math.round(58 * 1.944)], ['HDG', String(Math.round(D.hdg)).padStart(3, '0')],
    ['ORBIT', G.orbitStandoff ? 'STANDOFF' : 'TIGHT'], ['HULL', D.hp + '%'],
  ];
  if (!(isTouch && W < 760)) for (const [k, v] of tel) { txt(k.padEnd(6) + v, padL, y, 12, k === 'HULL' && D.hp < 100 ? RED : HUD_DIM); y += lh * 0.95; }
  // right: sensor & weapons
  const mmInView = isTouch && !MMP;
  const rx = mmInView ? minimapRect().x - VR.x - 12 : W - 14;
  y = W < 640 && !mmInView ? leftEnd + 4 : 22 * u; // narrow view: stack below the objectives
  txt(PAL_NAMES[G.pal] + '  FOV ' + Math.round(G.fov) + 'M', rx, y, 13, HUD, 'right'); y += lh;
  const slant = hyp(V.gd, D.alt);
  txt('SLANT ' + (slant / 1000).toFixed(1) + 'KM  EL ' + Math.round(V.E * 180 / Math.PI) + '°', rx, y, 12, HUD_DIM, 'right'); y += lh;
  txt('TRK ' + (G.lock ? (G.lock.type === 'ent' ? 'ENT' : 'PNT') : 'OFF') + '   LSR ' + (G.missiles.length ? 'LASING' : 'ARM'), rx, y, 12, G.missiles.length ? AMBER : HUD_DIM, 'right'); y += lh * 1.3;
  for (const k of ['LGM', 'LGB']) {
    if (G.M.ammo[k] === 0) continue;
    const sel = G.sel === k;
    txt((sel ? '> ' : '  ') + WEAPONS[k].name + ' ' + '▮'.repeat(G.ammo[k]) + '▯'.repeat(Math.max(0, G.M.ammo[k] - G.ammo[k])), rx, y, 13, sel ? (G.ammo[k] ? '#eaffea' : RED) : HUD_DIM, 'right'); y += lh;
  }
  txt('FLR ' + G.flares + (G.flareT > 0 ? '  ✶ DEPLOYED' : ''), rx, y, 12, G.flareT > 0 ? AMBER : HUD_DIM, 'right'); y += lh;
  // bottom centre: target data
  const by = H - (overlay ? 18 : 30) * u;
  const grid = '37U DQ ' + String(Math.round(G.aim.x)).padStart(4, '0') + ' ' + String(Math.round(G.aim.y)).padStart(4, '0');
  txt('TGT ' + grid, cx, by, 13, HUD, 'center');
  if (G.missiles.length) {
    const m = G.missiles.reduce((a, b) => a.tti < b.tti ? a : b);
    txt('TTI ' + m.tti.toFixed(1) + 's', cx, by - lh * 1.2, 18, AMBER, 'center');
  }
  // PID / collateral
  let py = cy + 58 * u;
  if (G.lock && G.lock.type === 'ent') {
    const e = G.lock.e;
    let s, c;
    if (!e.alive) { s = 'TARGET DESTROYED'; c = '#7fe08f'; }
    else if (e.identified) { s = 'PID: ' + cls(e); c = e.hostile ? RED : '#7fd0ff'; }
    else if (G.fov > 170) { s = 'PID: UNKNOWN — zoom in to identify'; c = HUD_DIM; }
    else { s = 'PID: IDENTIFYING ' + '▮'.repeat(Math.min(5, Math.ceil(G.pidT / 1.4 * 5))); c = AMBER; }
    txt(s, cx, py, 13, c, 'center'); py += lh;
  }
  const wp = WEAPONS[G.sel];
  let civN = 0;
  const cr = wp.wound * 1.1;
  for (const p of G.peds) if (p.alive && !p.hostile && hyp(p.x - G.aim.x, p.y - G.aim.y) < cr) civN++;
  for (const v of G.vehs) if (v.alive && !v.hostile && v.occ > 0 && hyp(v.x - G.aim.x, v.y - G.aim.y) < cr + 3) civN += v.occ;
  if (G.fov <= 600) txt('CDE ' + (civN ? 'HIGH — ' + civN + ' CIV IN ' + Math.round(cr) + 'M' : 'LOW'), cx, py, 12, civN ? RED : HUD_DIM, 'center');
  // missile warning
  if (G.threats.length) {
    const m = G.threats.reduce((a, b) => a.tti < b.tti ? a : b);
    if (Math.floor(G.t * 4) % 2 === 0) txt('▲ MISSILE ▲', cx, ty + 52 * u, 26, RED, 'center');
    txt('IMPACT ' + m.tti.toFixed(1) + 's — FLARES' + (isTouch ? ' [FLR]' : ' [C]'), cx, ty + 74 * u, 14, m.tti < 3.2 ? RED : AMBER, 'center');
  }
  // radio log
  const squareish = overlay && H > W * 0.8; // unfolded foldable: room above the target readout
  let ly = H - (overlay && !squareish ? 16 : squareish ? 42 : 54) * u;
  const recent = G.msgs.filter(m => G.t - m.t < 16).slice(-(W < 640 ? 3 : 5)).reverse();
  const maxW = squareish ? W - padL - 200 : overlay ? Math.max(160, cx - padL - 130 * u) : W < 700 ? W - 28 : Math.min(W * 0.5, 620);
  for (const m of recent) {
    const lines = wrap(m.text, maxW, 12);
    const a = clamp((16 - (G.t - m.t)) / 3, 0, 1);
    ctx.globalAlpha = a;
    for (let i = lines.length - 1; i >= 0; i--) { txt(lines[i], padL, ly, 12, m.color); ly -= lh * 0.92; }
    ctx.globalAlpha = 1;
    ly -= 4;
  }
  // help
  if (G.help) {
    const lines = isTouch ? [
      'DRAG to slew the camera · PINCH or +/− to zoom',
      'TAP a target to track it · zoom in and hold the track to get PID',
      'FIRE launches. Keep the crosshair on target until impact',
      'Tap the MAP to move the camera. [?] hides this help',
    ] : [
      'DRAG or WASD to slew · WHEEL or Q/E to zoom · CLICK or SPACE to track',
      'Zoom in on a tracked target to get PID · F fires · 1/2 switches weapon · C releases flares',
      'T changes the thermal mode · O changes orbit · click the map to move the camera · H hides help',
    ];
    let hy = cy - 120 * u;
    for (const s of lines) for (const ln of wrap(s, W - 40, 12)) { txt(ln, cx, hy, 12, 'rgba(230,255,226,0.85)', 'center'); hy += lh; }
    if (G.helpT > 25) G.help = false;
  }
}
function wrap(s, maxW, size) {
  ctx.font = `${Math.round(size * UI)}px ui-monospace, monospace`;
  const words = s.split(' '), out = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t; }
  if (cur) out.push(cur);
  return out;
}
const MM = { x: 0, y: 0, s: 0 };
function minimapRect() { // absolute screen coordinates
  if (MMP) { MM.x = MMP.x; MM.y = MMP.y; MM.s = MMP.s; return MM; }
  const s = isTouch ? Math.round(clamp(H * 0.3, 96, 150)) : Math.round(190 * UI);
  MM.s = s;
  if (isTouch) { MM.x = VR.x + W - s - 12; MM.y = VR.y + 14; }
  else { MM.x = VR.x + W - s - 14; MM.y = VR.y + H - s - 14; }
  return MM;
}
function drawMinimap() {
  const { x, y, s } = minimapRect(), k = s / WORLD;
  const mx = wx => x + wx * k, my = wy => y + s - wy * k;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, s, s); ctx.clip();
  ctx.globalAlpha = 0.88; ctx.drawImage(G.Wd.minimap, x, y, s, s); ctx.globalAlpha = 1;
  ctx.strokeStyle = HUD_DIM; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, s, s);
  // river
  ctx.strokeStyle = 'rgba(90,150,200,0.7)'; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let wy = 0; wy <= WORLD; wy += 100) { const X = mx(G.Wd.riverX(wy)), Y = my(wy); wy ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
  ctx.stroke();
  // POIs
  for (const p of G.pois) {
    if (p.until && G.t > p.until) continue;
    let px = p.x, py = p.y; if (p.ent) { if (!p.ent.alive || p.ent.gone) continue; px = p.ent.x; py = p.ent.y; }
    ctx.strokeStyle = AMBER; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(mx(px), my(py), Math.max(4, (p.r || 0) * k), 0, TAU); ctx.stroke();
  }
  // identified hostiles
  for (const e of G.vehs.concat(G.peds)) if (e.identified && e.alive && e.hostile) { ctx.fillStyle = RED; ctx.fillRect(mx(e.x) - 1.5, my(e.y) - 1.5, 3, 3); }
  // known SAM ranges
  for (const v of G.vehs) if (v.sam && v.alive && v.identified) {
    const r = (v.sam.radar && v.sam.radar.alive) ? v.sam.range : v.sam.rangeBlind;
    ctx.strokeStyle = 'rgba(255,90,74,0.6)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(mx(v.x), my(v.y), r * k, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
  }
  // sensor footprint
  const corners = [[0, 0], [W, 0], [W, H], [0, H]].map(([a, b]) => s2w(a, b));
  ctx.strokeStyle = HUD; ctx.fillStyle = 'rgba(200,247,197,0.12)'; ctx.beginPath();
  corners.forEach(([a, b], i) => i ? ctx.lineTo(mx(a), my(b)) : ctx.moveTo(mx(a), my(b)));
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // orbit and drone
  const D = G.drone;
  ctx.strokeStyle = 'rgba(200,247,197,0.35)'; ctx.beginPath(); ctx.arc(mx(D.cx), my(D.cy), D.R * k, 0, TAU); ctx.stroke();
  ctx.strokeStyle = 'rgba(200,247,197,0.5)'; ctx.beginPath(); ctx.moveTo(mx(D.x), my(D.y)); ctx.lineTo(mx(G.aim.x), my(G.aim.y)); ctx.stroke();
  ctx.save(); ctx.translate(mx(D.x), my(D.y)); ctx.rotate(-(D.ang + Math.PI / 2) + Math.PI / 2);
  ctx.fillStyle = '#eaffea'; ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(4, 4); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill(); ctx.restore();
  for (const m of G.threats) { ctx.fillStyle = RED; ctx.beginPath(); ctx.arc(mx(m.x), my(m.y), 2.5, 0, TAU); ctx.fill(); }
  ctx.restore();
  ctx.strokeStyle = HUD_DIM; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, s, s);
  txt('N', x + s / 2, y + 11, 10, HUD_DIM, 'center');
}

// ============================================================ input
const keys = {};
const ptrs = new Map();
let pinch = null, dragMoved = 0, downInfo = null;
function slewBy(dx, dy) { // screen-pixel drag (grab-the-ground)
  if (!G) return;
  breakLock();
  const sx = dx / V.s, sy = dy / (V.s * V.sinE);
  G.aimT.x -= V.rx * sx - V.fx * sy; G.aimT.y -= V.ry * sx - V.fy * sy;
  G.aim.x = G.aimT.x * 0.6 + G.aim.x * 0.4; G.aim.y = G.aimT.y * 0.6 + G.aim.y * 0.4;
}
function breakLock() { if (G.lock) { G.lock = null; } }
function zoom(d) {
  if (!G) return;
  G.fovFine = 1;
  G.fovI = clamp(G.fovI + d, 0, ZOOMS.length - 1); Snd.click();
  syncZoomSlider();
}
// continuous zoom helpers shared by the pinch gesture and the zoom slider
function applyFov(target) {
  target = clamp(target, ZOOMS[ZOOMS.length - 1], ZOOMS[0]);
  let bi = 0; for (let i = 0; i < ZOOMS.length; i++) if (Math.abs(Math.log(ZOOMS[i] / target)) < Math.abs(Math.log(ZOOMS[bi] / target))) bi = i;
  G.fovI = bi; G.fovFine = target / ZOOMS[bi];
}
function sliderToFov(v) { return Math.exp(lerp(Math.log(ZOOMS[0]), Math.log(ZOOMS[ZOOMS.length - 1]), v)); }
function fovToSlider(fov) { return clamp((Math.log(fov) - Math.log(ZOOMS[0])) / (Math.log(ZOOMS[ZOOMS.length - 1]) - Math.log(ZOOMS[0])), 0, 1); }
let zoomDragging = false;
function syncZoomSlider() { if (zoomDragging) return; const el = $zoom(); if (el && G) el.value = Math.round(fovToSlider(ZOOMS[G.fovI] * (G.fovFine || 1)) * 1000); }
function $zoom() { return document.getElementById('zoomSlider'); }
function showZoom(on) { const c = document.getElementById('zoomCtl'); if (c) c.classList.toggle('hidden', !on); if (on) syncZoomSlider(); }
function lockAt(sx, sy) {
  const [wx, wy] = s2w(sx, sy);
  let best = null, bd = 26 * UI * (isTouch ? 1.6 : 1);
  for (const e of G.vehs.concat(G.peds)) {
    if (!e.alive) continue;
    const [ex, ey] = w2s(e.x, e.y, e.kind === 'ped' ? 0.9 : 1), d = hyp(ex - sx, ey - sy);
    if (d < bd) { bd = d; best = e; }
  }
  G.pidT = 0;
  if (best) { G.lock = { type: 'ent', e: best }; G.aimT.x = best.x; G.aimT.y = best.y; }
  else { G.lock = { type: 'pt', x: wx, y: wy }; G.aimT.x = wx; G.aimT.y = wy; }
  Snd.lock();
}
function toggleLock() {
  if (G.lock) { G.lock = null; Snd.click(); return; }
  lockAt(V.cx, V.cy);
}
function inMinimap(x, y) { const m = minimapRect(); return x >= m.x && x <= m.x + m.s && y >= m.y && y <= m.y + m.s; }
function minimapJump(x, y) {
  const m = minimapRect();
  breakLock();
  G.aimT.x = clamp((x - m.x) / m.s * WORLD, 0, WORLD); G.aimT.y = clamp((1 - (y - m.y) / m.s) * WORLD, 0, WORLD);
  Snd.click();
}
const ACT = {
  fire: () => fire(), flare: () => deployFlares(), lock: () => toggleLock(),
  weapon: () => { const o = G.sel === 'LGM' ? 'LGB' : 'LGM'; if (G.M.ammo[o] > 0) { G.sel = o; Snd.click(); } },
  mode: () => { G.pal = (G.pal + 1) % 3; Snd.click(); },
  orbit: () => { G.orbitStandoff = !G.orbitStandoff; msg('Orbit: ' + (G.orbitStandoff ? 'STANDOFF 4.3 km' : 'TIGHT 2.4 km')); },
  zoomin: () => zoom(1), zoomout: () => zoom(-1), pause: () => pauseGame(), help: () => { G.help = !G.help; G.helpT = 0; },
};
cv.addEventListener('pointerdown', e => {
  Snd.init();
  if (state !== 'play') return;
  const mm = inMinimap(e.clientX, e.clientY);
  const vx = e.clientX - VR.x, vy = e.clientY - VR.y;
  if (!mm && (vx < 0 || vy < 0 || vx > W || vy > H)) return;
  cv.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    pinch = { d: hyp(a.x - b.x, a.y - b.y), fov: G.fov };
    downInfo = null;
  } else if (ptrs.size === 1) {
    downInfo = { x: e.clientX, y: e.clientY, t: performance.now(), mm };
    dragMoved = 0;
    if (downInfo.mm) minimapJump(e.clientX, e.clientY);
  }
});
cv.addEventListener('pointermove', e => {
  if (state !== 'play' || !ptrs.has(e.pointerId)) return;
  const p = ptrs.get(e.pointerId), dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (pinch && ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()], d = hyp(a.x - b.x, a.y - b.y);
    const target = clamp(pinch.fov * pinch.d / Math.max(20, d), ZOOMS[ZOOMS.length - 1], ZOOMS[0]);
    applyFov(target); syncZoomSlider();
    return;
  }
  if (!downInfo) return;
  if (downInfo.mm) { minimapJump(e.clientX, e.clientY); return; }
  dragMoved += Math.abs(dx) + Math.abs(dy);
  if (dragMoved > 6) slewBy(dx, dy);
});
const endPtr = e => {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2) pinch = null;
  if (state === 'play' && downInfo && !downInfo.mm && dragMoved <= 6 && performance.now() - downInfo.t < 450) lockAt(e.clientX - VR.x, e.clientY - VR.y);
  if (ptrs.size === 0) downInfo = null;
};
cv.addEventListener('pointerup', endPtr);
cv.addEventListener('pointercancel', endPtr);
cv.addEventListener('wheel', e => { e.preventDefault(); if (state === 'play') zoom(e.deltaY < 0 ? 1 : -1); }, { passive: false });
cv.addEventListener('contextmenu', e => e.preventDefault());

window.addEventListener('keydown', e => {
  Snd.init();
  if (state === 'play') {
    const k = e.key.toLowerCase();
    keys[k] = true;
    if (k === ' ') { toggleLock(); e.preventDefault(); }
    else if (k === 'f' || k === 'enter') fire();
    else if (k === '1') { G.sel = 'LGM'; Snd.click(); }
    else if (k === '2' && G.M.ammo.LGB > 0) { G.sel = 'LGB'; Snd.click(); }
    else if (k === 'c') deployFlares();
    else if (k === 't') ACT.mode();
    else if (k === 'o') ACT.orbit();
    else if (k === 'h') ACT.help();
    else if (k === 'q' || k === '-') zoom(-1);
    else if (k === 'e' || k === '=' || k === '+') zoom(1);
    else if (k === 'escape' || k === 'p') pauseGame();
    if (k.startsWith('arrow')) e.preventDefault();
  } else if (state === 'pause' && (e.key === 'Escape' || e.key.toLowerCase() === 'p')) resumeGame();
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
function keySlew(dt) {
  let dx = 0, dy = 0;
  if (keys['a'] || keys['arrowleft']) dx -= 1;
  if (keys['d'] || keys['arrowright']) dx += 1;
  if (keys['w'] || keys['arrowup']) dy += 1;
  if (keys['s'] || keys['arrowdown']) dy -= 1;
  if (!dx && !dy) return;
  breakLock();
  // slew speed scales with zoom but is capped so wide FOV isn't hair-trigger fast
  const sp = clamp(G.fov, 140, 900) * 0.6 * dt;
  G.aimT.x += (V.rx * dx + V.fx * dy) * sp; G.aimT.y += (V.ry * dx + V.fy * dy) * sp;
}
for (const b of document.querySelectorAll('#touch [data-act]')) {
  b.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation(); Snd.init();
    if (state === 'play' && ACT[b.dataset.act]) ACT[b.dataset.act]();
    if (navigator.vibrate && b.dataset.act === 'fire') navigator.vibrate(30);
  });
}
{
  const zs = document.getElementById('zoomSlider');
  if (zs) {
    const apply = () => { if (G && state === 'play') { applyFov(sliderToFov(zs.value / 1000)); } };
    zs.addEventListener('input', apply);
    zs.addEventListener('pointerdown', e => { zoomDragging = true; Snd.init(); e.stopPropagation(); });
    const up = () => { zoomDragging = false; };
    zs.addEventListener('pointerup', up); zs.addEventListener('pointercancel', up); zs.addEventListener('change', up);
  }
}

// ============================================================ menus / flow
const $ = id => document.getElementById(id);
const show = (id, on) => $(id).classList.toggle('hidden', !on);
let suspended = false;
// Tabbed menu: UAV Strike (this file) / FPV Stunts / FPV Strike (js/fpv.js).
function selectTab(name) {
  for (const t of document.querySelectorAll('#tabs .tab')) t.classList.toggle('on', t.dataset.tab === name);
  for (const p of document.querySelectorAll('.tabpane')) p.classList.toggle('hidden', p.dataset.pane !== name);
  store.set('steppehawk.tab', name);
}
function initTabs() {
  const tabs = document.getElementById('tabs');
  if (!tabs) return;
  for (const t of tabs.querySelectorAll('.tab')) t.onclick = () => { Snd.init(); selectTab(t.dataset.tab); };
  selectTab(store.get('steppehawk.tab', 'uav'));
}
// Hand the screen to an FPV mode: freeze the UAV loop and hide its canvas/controls.
function suspendUAV() {
  suspended = true; state = 'menu';
  for (const id of ['menu', 'brief', 'pause', 'end', 'touch']) show(id, false);
  showZoom(false);
  cv.style.display = 'none';
}
function resumeUAV() {
  suspended = false; cv.style.display = '';
  resize(); last = performance.now();
  toMenu();
}
function buildMenu() {
  const best = store.get('steppehawk.best', {});
  const list = $('missionList'); list.innerHTML = '';
  MISSIONS.forEach((M, i) => {
    const b = document.createElement('button');
    b.className = 'mcard';
    const bs = best[M.id];
    b.innerHTML = `<span class="mn">${i + 1}. ${M.name}</span><span class="ms">${M.sub}</span><span class="mt">${M.tod}</span>` +
      (bs ? `<span class="mg">BEST: ${bs.grade} · ${bs.score}</span>` : '');
    b.onclick = () => { Snd.init(); openBrief(i); };
    list.appendChild(b);
  });
}
function openBrief(i) {
  missionIndex = i;
  const M = MISSIONS[i];
  $('bTitle').textContent = `MISSION ${i + 1}: ${M.name}`;
  const ammo = Object.entries(M.ammo).filter(([, n]) => n > 0).map(([k, n]) => `${n} × ${WEAPONS[k].name} (${WEAPONS[k].long.toLowerCase()})`).join(', ');
  $('bBody').innerHTML = `
    <div class="kv"><span>AREA</span><span>${M.region}</span><span>CONDITIONS</span><span>${M.tod}</span>
    <span>TIME</span><span>${fmtT(M.timeLimit)}</span><span>LOADOUT</span><span>${ammo}, 6 flares</span>
    <span>THREATS</span><span>${M.threats}</span><span>ROE</span><span>Engage only PID'd hostiles. The mission fails above ${M.civLimit} civilian casualt${M.civLimit === 1 ? 'y' : 'ies'}.</span></div>
    <h4>SITUATION</h4>${M.brief.map(p => `<p>${p}</p>`).join('')}`;
  show('menu', false); show('brief', true);
}
function startMission(i) {
  missionIndex = i;
  newGame(i);
  state = 'play';
  for (const id of ['menu', 'brief', 'pause', 'end']) show(id, false);
  show('touch', isTouch);
  showZoom(true);
  if (isTouch && !isNative) {
    const el = document.documentElement;
    try {
      const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : null;
      if (p && p.then) p.then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
    } catch (e) { /* fullscreen not available */ }
  }
}
function pauseGame() { if (state !== 'play') return; state = 'pause'; show('pause', true); showZoom(false); }
function resumeGame() { state = 'play'; show('pause', false); showZoom(true); last = performance.now(); }
function toMenu() {
  state = 'menu';
  for (const id of ['brief', 'pause', 'end', 'touch']) show(id, false);
  showZoom(false);
  buildMenu(); show('menu', true);
  newGame(0, true); G.demoAng = 0; G.fovI = 1;
}
function endMission() {
  if (state !== 'play') return;
  state = 'end';
  show('touch', false);
  showZoom(false);
  const s = G.stats, win = G.over.win, M = G.M;
  const acc = s.shots ? s.hits / s.shots : 0;
  if (G.survival) {
    const wavesHeld = Math.max(0, G.wave - 1);
    const sc = s.hostVeh * 100 + s.host * 20 + wavesHeld * 250;
    const best = store.get('steppehawk.surv', {});
    const prevW = best.waves || 0, prevS = best.score || 0;
    if (wavesHeld > prevW || (wavesHeld === prevW && sc > prevS)) store.set('steppehawk.surv', { waves: wavesHeld, score: sc });
    $('eTitle').textContent = 'SURVIVAL OVER';
    $('eBody').innerHTML = `<div class="grade">${wavesHeld}</div>
      <p>${G.over.reason}. You held ${wavesHeld} wave${wavesHeld === 1 ? '' : 's'}.</p>
      <div class="kv">
        <span>WAVES HELD</span><span>${wavesHeld}</span>
        <span>ARMOUR DESTROYED</span><span>${s.hostVeh}</span>
        <span>INFANTRY</span><span>${s.host}</span>
        <span>WEAPONS</span><span>${s.shots} released · ${Math.round(acc * 100)}% effective</span>
        <span>SCORE</span><span>${sc}</span>
        <span>BEST</span><span>${Math.max(wavesHeld, prevW)} waves · ${Math.max(sc, prevS)}</span>
      </div>`;
    $('eNext').classList.add('hidden');
    show('end', true);
    return;
  }
  const objDone = G.objectives.filter(o => o.done()).length;
  let score = s.host * 100 + objDone * 300 - s.civ * 400 - s.structs * 15 + (win ? 600 + Math.round(G.timeLeft) * 2 + Math.round(acc * 300) : 0);
  score = Math.max(0, score);
  let grade = 'F';
  if (win) grade = s.civ === 0 && acc >= 0.7 ? 'S' : s.civ === 0 ? 'A' : s.civ <= 1 ? 'B' : 'C';
  if (win) {
    const best = store.get('steppehawk.best', {});
    const order = 'FCBAS';
    if (!best[M.id] || order.indexOf(grade) > order.indexOf(best[M.id].grade) || (grade === best[M.id].grade && score > best[M.id].score)) {
      best[M.id] = { grade, score }; store.set('steppehawk.best', best);
    }
  }
  $('eTitle').textContent = win ? 'VICTORY' : 'MISSION FAILED';
  $('eBody').innerHTML = `<div class="grade ${win ? '' : 'f'}">${grade}</div>
    <p>${G.over.reason}.</p>
    <div class="kv">
      <span>HOSTILES</span><span>${s.host} personnel · ${s.hostVeh} vehicles</span>
      <span>CIVILIAN CAS.</span><span>${s.civ}</span>
      <span>WEAPONS</span><span>${s.shots} released · ${s.hits} effective (${Math.round(acc * 100)}%)</span>
      <span>STRUCTURES</span><span>${s.structs} damaged</span>
      <span>OBJECTIVES</span><span>${objDone}/${G.objectives.length}</span>
      <span>TIME LEFT</span><span>${fmtT(G.timeLeft)}</span>
      <span>SCORE</span><span>${score}</span>
    </div>`;
  $('eNext').classList.toggle('hidden', !(win && missionIndex < MISSIONS.length - 1));
  show('end', true);
}
$('bStart').onclick = () => { Snd.init(); startMission(missionIndex); };
$('bBack').onclick = () => { show('brief', false); show('menu', true); };
$('pResume').onclick = resumeGame;
$('pRestart').onclick = () => startMission(missionIndex);
$('pQuit').onclick = toMenu;
$('eMenu').onclick = toMenu;
$('eRetry').onclick = () => startMission(missionIndex);
$('eNext').onclick = () => openBrief(missionIndex + 1);
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') pauseGame(); });

// ============================================================ main loop
let last = performance.now(), workMs = 8, perfT = 0;
function adaptResolution(dt, ms) {
  // keep big foldable screens smooth: drop render resolution when frames get heavy, restore when there is headroom
  workMs = workMs * 0.95 + ms * 0.05; perfT += dt;
  if (perfT < 3) return;
  perfT = 0;
  if (workMs > 15 && renderScale > 0.55) { renderScale = Math.round((renderScale - 0.15) * 100) / 100; resize(); }
  else if (workMs < 6 && renderScale < 1) { renderScale = Math.min(1, Math.round((renderScale + 0.15) * 100) / 100); resize(); }
}
window.__nativeBack = () => {
  if (window.SteppeHawkFPV && window.SteppeHawkFPV.active) return window.SteppeHawkFPV.onBack();
  if (state === 'play') { pauseGame(); return true; }
  if (state === 'pause') { resumeGame(); return true; }
  if (state === 'end') { toMenu(); return true; }
  if (!$('brief').classList.contains('hidden')) { show('brief', false); show('menu', true); return true; }
  return false;
};
function frame(now) {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
  if (suspended) { last = performance.now(); requestAnimationFrame(frame); return; }
  const t0 = performance.now();
  if (G) {
    if (state === 'play') { keySlew(dt); update(dt); }
    else if (state === 'menu') {
      G.demoAng += dt * 0.03;
      G.aimT.x = 2000 + Math.cos(G.demoAng) * 900; G.aimT.y = 2000 + Math.sin(G.demoAng * 1.3) * 700;
      update(dt);
    }
    render();
    if (state === 'play') adaptResolution(dt, performance.now() - t0);
  }
  requestAnimationFrame(frame);
}
initTabs();
toMenu();
requestAnimationFrame(frame);

// Shared API for the 3D FPV modes (js/fpv.js). They reuse the world generator, the audio context
// and the fold/layout plumbing, and hand the screen back and forth through suspend/resume.
window.SteppeHawk = {
  THREE_SRC: 'js/vendor/three.min.js',
  WORLD, SP, ZOOMS, WEAPONS, VT, MISSIONS,
  Snd, genWorld,
  get isTouch() { return isTouch; }, get isNative() { return isNative; },
  get fold() { return foldInfo; },
  get segments() { return segments(); },
  util: { clamp, lerp, rr, ri, pick, chance, hyp, TAU, mulberry32, fbm, makeNoise, setSeed(s) { rnd = mulberry32(s); }, distSeg },
  suspend: suspendUAV,
  resume: resumeUAV,
  selectTab,
  onResize(cb) { window.addEventListener('resize', cb); if (window.viewport && window.viewport.addEventListener) window.viewport.addEventListener('segmentschange', cb); },
};
window.__steppehawk = { get G() { return G; }, get state() { return state; }, get layout() { return { LAYOUT, VR: { ...VR, w: W, h: H }, PANEL, MMP, renderScale }; }, startMission, fire, lockAt, MISSIONS };
})();
