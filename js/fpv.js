/* Steppe Hawk — 3D first-person FPV drone modes (three.js).
 * A companion to the 2D UAV game in game.js. Reuses that file's world generator and audio context
 * (window.SteppeHawk) and renders the same village / fields / river world in three.js, flown from a
 * goggle-style first-person view. three.js is vendored locally and loaded on demand, so the APK and
 * the installed PWA run these modes fully offline.
 *
 * Game modes, all sharing one flight model and scene:
 *   stunt  — free flight with trick scoring (flips, rolls, power loops, dives, gaps) and combos
 *   race   — fly a course of gates against the clock
 *   strike — one-way FPV attack runs on armour (cool explosions, tumbling wreckage)
 *   bomb   — a reusable bomber quad that releases ballistic munitions onto targets
 *
 * A work of fiction. Units, places and events are invented.
 */
(() => {
'use strict';
const API = window.SteppeHawk;
if (!API) return; // game.js defines the shared API synchronously before this file runs
const { WORLD, SP, util } = API;
const { clamp, lerp, rr, ri, pick, chance, hyp, TAU } = util;
const O = WORLD / 2;                 // world centre; the three.js scene is centred on it
const DEG = Math.PI / 180;
let THREE = null;                    // filled in once the library loads

// scene(centre-metre) <-> world(game-metre) helpers. Scene: X east, Y up, Z north(+game y).
const sx = wx => wx - O, sz = wy => wy - O, wx = x => x + O, wy = z => z + O;

// ============================================================ sortie catalogue
const SORTIES = [
  { id: 'freefly', tab: 'stunt', mode: 'stunt', name: 'FREE FLY', sub: 'Open practice over Zelena Balka', tod: 'SUMMER · DAY',
    seed: 7001, light: 1, weather: 'clear', time: 0,
    brief: 'No clock, no targets. Learn the quad, find the gaps and rack up a trick score. Flip, roll, loop and dive; thread the bridge and the power lines. MODE switches self-levelling / acro.' },
  { id: 'trickpark', tab: 'stunt', mode: 'stunt', name: 'TRICK PARK', sub: 'Score attack — hit the gaps', tod: 'SUMMER · DAY',
    seed: 7002, light: 1, weather: 'fair', time: 150, target: 4000,
    brief: 'Beat the target score before the clock runs out. The bridge, the power lines and the alley between the apartment blocks are worth big points — chain them into combos for a multiplier.' },
  { id: 'dusk', tab: 'stunt', mode: 'stunt', name: 'GOLDEN HOUR', sub: 'Free freestyle at dusk', tod: 'SUMMER · DUSK',
    seed: 7003, light: 0.6, weather: 'cloud', time: 0,
    brief: 'Low sun and long shadows over the fields. Pure cinematic freestyle, no clock.' },
  { id: 'race_river', tab: 'stunt', mode: 'race', name: 'GATE RACE — RIVER RUN', sub: 'Chase the gates along the river', tod: 'SUMMER · DAY',
    seed: 7101, light: 1, weather: 'fair',
    brief: 'A fast, flowing course that follows the river and ducks under the bridge. Hit every gate in order — smooth is fast.' },
  { id: 'race_village', tab: 'stunt', mode: 'race', name: 'GATE RACE — VILLAGE SPRINT', sub: 'Technical course through the streets', tod: 'SUMMER · DAY',
    seed: 7102, light: 1, weather: 'cloud',
    brief: 'Tight, technical gates threading the market square, the apartment blocks and the church. Precision over raw speed.' },
  { id: 'strike_column', tab: 'strike', mode: 'strike', name: 'COLUMN HUNT', sub: 'One-way FPV runs on a moving column', tod: 'SUMMER · DAY',
    seed: 7201, light: 1, weather: 'fair', drones: 6, flak: 1,
    brief: 'An armoured column is moving on the open road. Fly each one-way drone into a vehicle. Civilian traffic shares the road — hit it and the sortie is over. SPACE / STRIKE commits the dive.' },
  { id: 'strike_sam', tab: 'strike', mode: 'strike', name: 'DEFENCE SUPPRESSION', sub: 'Knock out an air-defence site', tod: 'SUMMER · DUSK',
    seed: 7202, light: 0.72, weather: 'cloud', drones: 5, flak: 2,
    brief: 'A SAM battery and its guns are dug in by the farm. Expect flak — jink on the run-in. Put your drones onto the launchers and the radar.' },
  { id: 'strike_depot', tab: 'strike', mode: 'strike', name: 'DEPOT RAID', sub: 'Massed armour in the open', tod: 'SUMMER · DAY',
    seed: 7203, light: 1, weather: 'fair', drones: 8, flak: 1,
    brief: 'Armour and fuel are laagered in a field. The fuel bowsers cook off spectacularly and take their neighbours with them — pick your first hit well.' },
  { id: 'bomb_trench', tab: 'strike', mode: 'bomb', name: 'FPV BOMBER — TRENCH LINE', sub: 'Drop munitions from a reusable quad', tod: 'SUMMER · DAY',
    seed: 7301, light: 1, weather: 'fair', bombs: 10, flak: 1,
    brief: 'A bomber quad that comes home. Fly over the dug-in armour and release munitions — they fall with your speed, so lead the target. SPACE / DROP releases. The drone survives; your bombs do not.' },
  { id: 'bomb_night', tab: 'strike', mode: 'bomb', name: 'FPV BOMBER — NIGHT DROPS', sub: 'Bombing run after dark', tod: 'SUMMER · NIGHT',
    seed: 7302, light: 0.3, weather: 'clear', bombs: 12, flak: 2,
    brief: 'Same bomber, at night, against a laager lit only by its own heat. Vehicles glow; civilians do not — be sure before you pickle.' },
];

// ============================================================ lazy library load
let loading = null;
function loadThree() {
  if (THREE) return Promise.resolve(THREE);
  if (loading) return loading;
  loading = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = API.THREE_SRC; s.async = true;
    s.onload = () => { THREE = window.THREE; THREE ? res(THREE) : rej(new Error('THREE missing')); };
    s.onerror = () => rej(new Error('failed to load ' + API.THREE_SRC));
    document.head.appendChild(s);
  });
  return loading;
}

// ============================================================ motor audio
function makeMotors() {
  const Snd = API.Snd, ac = Snd.ctx;
  if (!ac) return { update() {}, stop() {}, crash() {} };
  const bus = ac.createGain(); bus.gain.value = 0; bus.connect(Snd.master);
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800; lp.connect(bus);
  const motors = [];
  for (let i = 0; i < 4; i++) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sawtooth'; o.frequency.value = 95 + i * 6; g.gain.value = 0.25;
    o.connect(g); g.connect(lp); o.start();
    motors.push({ o, g, base: 95 + i * 6 });
  }
  // air/prop wash
  const air = ac.createBufferSource(); air.buffer = Snd.nbuf; air.loop = true;
  const af = ac.createBiquadFilter(); af.type = 'bandpass'; af.frequency.value = 2200; af.Q.value = 0.7;
  const ag = ac.createGain(); ag.gain.value = 0; air.connect(af); af.connect(ag); ag.connect(bus); air.start();
  let dead = false;
  return {
    update(thr, diff, spd, dt) {
      if (dead || Snd.muted) { bus.gain.setTargetAtTime(0, ac.currentTime, 0.1); return; }
      bus.gain.setTargetAtTime(0.5, ac.currentTime, 0.2);
      const f = 1 + thr * 2.4 + spd * 0.012;
      for (let i = 0; i < 4; i++) {
        const m = motors[i], d = (i === 0 || i === 3 ? diff.p : -diff.p) + (i < 2 ? diff.r : -diff.r);
        m.o.frequency.setTargetAtTime(m.base * f * (1 + d * 0.12), ac.currentTime, 0.03);
      }
      ag.gain.setTargetAtTime(0.03 + thr * 0.06 + spd * 0.0016, ac.currentTime, 0.05);
      lp.frequency.setTargetAtTime(1200 + thr * 2600, ac.currentTime, 0.05);
    },
    crash() {
      if (dead) return;
      for (const m of motors) m.o.frequency.setTargetAtTime(28, ac.currentTime, 0.25);
      bus.gain.setTargetAtTime(0, ac.currentTime, 0.4);
    },
    stop() {
      dead = true;
      try { for (const m of motors) m.o.stop(ac.currentTime + 0.05); air.stop(ac.currentTime + 0.05); } catch (e) {}
      setTimeout(() => { try { bus.disconnect(); } catch (e) {} }, 200);
    },
  };
}

// ============================================================ the engine
let S = null;                        // the live sortie session, or null when idle
const clock = { last: 0 };

function makePrismGeometry() {
  // unit triangular prism: ridge along X at y=1, base rectangle in XZ from -0.5..0.5
  const p = [
    [-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5], // base 0-3
    [-0.5, 1, 0], [0.5, 1, 0],                                        // ridge 4,5
  ];
  const tri = [
    [0, 1, 5], [0, 5, 4],   // back slope (−z)
    [3, 4, 5], [3, 5, 2],   // front slope (+z)
    [0, 4, 3],              // −x gable
    [1, 2, 5],              // +x gable
    [0, 3, 2], [0, 2, 1],   // base
  ];
  const pos = [];
  for (const t of tri) for (const v of t) pos.push(p[v][0], p[v][1], p[v][2]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// Procedural textures (generated per sortie, freed on exit). Neutral/light so per-instance
// InstancedMesh colours still tint them. Give the world concrete, tiles, ground relief and ripples.
function makeTextures() {
  const cv2 = (s) => { const c = document.createElement('canvas'); c.width = c.height = s; return c; };
  // building facade: light panels with window rows
  const wc = cv2(128), wg = wc.getContext('2d');
  wg.fillStyle = '#d9d9d4'; wg.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1200; i++) { const v = 200 + Math.random() * 50; wg.fillStyle = `rgba(${v},${v},${v - 6},0.07)`; wg.fillRect(Math.random() * 128, Math.random() * 128, 2, 2); }
  for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) {
    const x = 12 + c * 28, y = 10 + r * 23, ww = 18, wh = 14;
    wg.fillStyle = '#394450'; wg.fillRect(x, y, ww, wh);
    wg.fillStyle = 'rgba(130,160,180,0.45)'; wg.fillRect(x, y, ww, wh * 0.42);
    wg.strokeStyle = 'rgba(70,70,70,0.4)'; wg.lineWidth = 1; wg.strokeRect(x + 0.5, y + 0.5, ww, wh);
  }
  // roof: corrugated stripes
  const rc = cv2(64), rg = rc.getContext('2d');
  rg.fillStyle = '#d7d3cd'; rg.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 64; y += 5) { rg.fillStyle = 'rgba(80,72,64,0.22)'; rg.fillRect(0, y, 64, 2); }
  // ground micro-relief + water ripples (bump maps)
  const gb = cv2(256), gbg = gb.getContext('2d'), gid = gbg.createImageData(256, 256);
  for (let i = 0; i < gid.data.length; i += 4) { const v = 110 + Math.random() * 145; gid.data[i] = gid.data[i + 1] = gid.data[i + 2] = v; gid.data[i + 3] = 255; }
  gbg.putImageData(gid, 0, 0);
  const wb = cv2(128), wbg = wb.getContext('2d'), wid = wbg.createImageData(128, 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const v = 128 + 55 * Math.sin(x * 0.3 + y * 0.16) + 40 * Math.sin(x * 0.12 - y * 0.24), o = (y * 128 + x) * 4;
    wid.data[o] = wid.data[o + 1] = wid.data[o + 2] = v; wid.data[o + 3] = 255;
  }
  wbg.putImageData(wid, 0, 0);
  const T = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  return { wall: T(wc, true), roof: T(rc, true), gbump: T(gb), wbump: T(wb) };
}
function addSkyDome(scene, topHex, botHex) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    // raw-shader output is written straight to the framebuffer, so feed sRGB-encoded colours
    uniforms: { top: { value: new THREE.Color(topHex).convertLinearToSRGB() }, bot: { value: new THREE.Color(botHex).convertLinearToSRGB() }, off: { value: 260 }, exp: { value: 0.65 } },
    vertexShader: 'varying vec3 vW; void main(){ vW=(modelMatrix*vec4(position,1.0)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
    fragmentShader: 'varying vec3 vW; uniform vec3 top; uniform vec3 bot; uniform float off; uniform float exp; void main(){ float h=normalize(vW+vec3(0.0,off,0.0)).y; gl_FragColor=vec4(mix(bot,top,pow(max(h,0.0),exp)),1.0);} ',
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(3200, 24, 12), mat);
  dome.frustumCulled = false; dome.renderOrder = -1; scene.add(dome); return dome;
}

function buildScene(cfg) {
  const setT = API.util.setSeed; setT(cfg.seed);
  const Wd = API.genWorld({ seed: cfg.seed, winter: !!cfg.winter, light: cfg.light });
  const night = cfg.light < 0.5, dusk = cfg.light >= 0.5 && cfg.light < 0.8;

  const scene = new THREE.Scene();
  // sky + fog tuned by time of day / weather
  const skyDay = new THREE.Color(0x9fc4e8), skyDusk = new THREE.Color(0xdca26a), skyNight = new THREE.Color(0x0a1420);
  const over = cfg.weather === 'cloud' || cfg.weather === 'overcast';
  let sky = night ? skyNight : dusk ? skyDusk : skyDay.clone();
  if (over && !night) sky = sky.clone().lerp(new THREE.Color(0x9aa2ab), 0.5);
  scene.background = sky;
  const fogFar = over ? 1700 : night ? 1400 : 2600;
  scene.fog = new THREE.Fog(sky.clone().lerp(new THREE.Color(0xffffff), night ? 0 : 0.15), 120, fogFar);
  const tex = makeTextures();
  // gradient sky dome for a realistic horizon
  const horizon = sky.clone().lerp(new THREE.Color(0xffffff), night ? 0.08 : 0.4);
  const skyDome = addSkyDome(scene, sky.clone().multiplyScalar(night ? 1 : 1.1).getHex(), horizon.getHex());

  // quality tier: shadows on desktop and capable phones only (and droppable at runtime if slow)
  const strong = !API.isTouch || ((navigator.hardwareConcurrency || 4) >= 6 && (navigator.deviceMemory || 4) >= 4);

  // lighting
  const sun = new THREE.DirectionalLight(night ? 0x6a86b8 : dusk ? 0xffb066 : 0xfff2d8, night ? 0.25 : dusk ? 0.8 : 1.1);
  const sunDir = new THREE.Vector3(0.55, dusk ? 0.42 : 0.92, 0.32).normalize();
  sun.position.copy(sunDir).multiplyScalar(700);
  scene.add(sun); scene.add(sun.target);
  scene.add(new THREE.HemisphereLight(sky.getHex(), cfg.winter ? 0xdfe6ea : 0x33402c, night ? 0.35 : over ? 0.85 : 0.65));
  scene.add(new THREE.AmbientLight(0xffffff, night ? 0.12 : 0.18));
  if (strong) {
    sun.castShadow = true;
    const ms = API.isTouch ? 1024 : 2048; sun.shadow.mapSize.set(ms, ms);
    const sc = sun.shadow.camera; sc.left = -280; sc.right = 280; sc.top = 280; sc.bottom = -280; sc.near = 150; sc.far = 1500;
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.6;
  }

  // ground (daytime colour canvas + micro-relief bump)
  const gtex = new THREE.CanvasTexture(Wd.gDay);
  gtex.colorSpace = THREE.SRGBColorSpace; gtex.anisotropy = 8;
  tex.gbump.repeat.set(90, 90);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD, WORLD),
    new THREE.MeshStandardMaterial({ map: gtex, bumpMap: tex.gbump, bumpScale: 0.35, roughness: 0.96, metalness: 0 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = strong; scene.add(ground);

  // roads: flat ribbons merged into one geometry
  addRoads(scene, Wd, night);
  // river ribbon
  const water = addRiver(scene, Wd, night, cfg, tex);

  // buildings: box bodies (instanced) + gable roof prisms (instanced)
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const bodyMat = new THREE.MeshStandardMaterial({ map: tex.wall, roughness: 0.88, metalness: 0.02 });
  const bodies = new THREE.InstancedMesh(boxGeo, bodyMat, Wd.blds.length);
  bodies.frustumCulled = false; bodies.castShadow = strong; bodies.receiveShadow = strong;
  const gabled = Wd.blds.filter(b => b.gable);
  const roofMat = new THREE.MeshStandardMaterial({ map: tex.roof, roughness: 0.82, metalness: 0.03 });
  const roofs = new THREE.InstancedMesh(makePrismGeometry(), roofMat, Math.max(1, gabled.length));
  roofs.frustumCulled = false; roofs.castShadow = strong;
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  const collBlds = [];
  Wd.blds.forEach((b, i) => {
    const h = Math.max(1.2, b.h);
    m4.makeRotationY(-b.a); m4.setPosition(sx(b.x), h / 2, sz(b.y));
    const sc = new THREE.Matrix4().makeScale(b.w, h, b.d);
    bodies.setMatrixAt(i, m4.multiply(sc));
    bodies.setColorAt(i, col.setRGB(b.wallDay[0] / 255, b.wallDay[1] / 255, b.wallDay[2] / 255).convertSRGBToLinear());
    let top = h;
    if (b.dome) { top += Math.min(b.w, b.d) * 0.4; }
    collBlds.push({ x: sx(b.x), z: sz(b.y), hw: b.w / 2, hd: b.d / 2, a: b.a, h: top });
  });
  bodies.instanceMatrix.needsUpdate = true; if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
  scene.add(bodies);
  gabled.forEach((b, i) => {
    const along = b.w >= b.d, rise = Math.min(b.w, b.d) * 0.35;
    m4.makeRotationY(-b.a + (along ? 0 : Math.PI / 2));
    m4.setPosition(sx(b.x), Math.max(1.2, b.h), sz(b.y));
    const sc = new THREE.Matrix4().makeScale(along ? b.w : b.d, rise, along ? b.d : b.w);
    roofs.setMatrixAt(i, m4.multiply(sc));
    roofs.setColorAt(i, col.setRGB(b.roofDay[0] / 255, b.roofDay[1] / 255, b.roofDay[2] / 255).convertSRGBToLinear());
    collBlds[Wd.blds.indexOf(b)].h += rise;
  });
  roofs.instanceMatrix.needsUpdate = true; if (roofs.instanceColor) roofs.instanceColor.needsUpdate = true;
  if (gabled.length) scene.add(roofs);
  // domes (church / silos)
  const domed = Wd.blds.filter(b => b.dome);
  if (domed.length) {
    const dome = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 6, 0, TAU, 0, Math.PI / 2), roofMat.clone(), domed.length);
    dome.frustumCulled = false;
    domed.forEach((b, i) => {
      m4.makeRotationY(0); m4.setPosition(sx(b.x), Math.max(1.2, b.h), sz(b.y));
      const r = Math.min(b.w, b.d) * 0.45;
      dome.setMatrixAt(i, m4.multiply(new THREE.Matrix4().makeScale(r, r * 1.2, r)));
      dome.setColorAt(i, col.setRGB(0.83, 0.68, 0.24).convertSRGBToLinear());
    });
    dome.instanceMatrix.needsUpdate = true; if (dome.instanceColor) dome.instanceColor.needsUpdate = true;
    scene.add(dome);
  }

  // trees: foliage cones + trunks (instanced)
  const live = Wd.trees.filter(t => t.alive);
  if (live.length) {
    const fol = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 6), new THREE.MeshLambertMaterial(), live.length);
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.28, 1, 4), new THREE.MeshLambertMaterial({ color: 0x5b4428 }), live.length);
    fol.frustumCulled = trunk.frustumCulled = false;
    live.forEach((t, i) => {
      const h = t.h, r = t.r;
      m4.makeTranslation(sx(t.x), h * 0.62, sz(t.y));
      fol.setMatrixAt(i, m4.clone().multiply(new THREE.Matrix4().makeScale(r * 1.3, h * 0.8, r * 1.3)));
      const g = cfg.winter ? [0.42, 0.44, 0.4] : (t.garden ? [0.28, 0.46, 0.22] : [0.2, 0.36, 0.17]);
      fol.setColorAt(i, col.setRGB(g[0] * t.tint, g[1] * t.tint, g[2] * t.tint).convertSRGBToLinear());
      trunk.setMatrixAt(i, new THREE.Matrix4().makeTranslation(sx(t.x), h * 0.2, sz(t.y)).multiply(new THREE.Matrix4().makeScale(1, h * 0.45, 1)));
    });
    fol.instanceMatrix.needsUpdate = true; if (fol.instanceColor) fol.instanceColor.needsUpdate = true;
    trunk.instanceMatrix.needsUpdate = true;
    fol.castShadow = strong;
    scene.add(fol); scene.add(trunk);
  }

  // bridge deck over the river on the main road (a solid obstacle; the gap is underneath it)
  const bxw = Wd.riverX(2000), deckH = 6.2;
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(80, 1.4, 15),
    new THREE.MeshStandardMaterial({ color: 0x8a8a86, roughness: 0.9 }));
  bridge.position.set(sx(bxw), deckH, sz(2000)); bridge.castShadow = strong; bridge.receiveShadow = strong; scene.add(bridge);
  for (const s of [-1, 1]) {
    const pier = new THREE.Mesh(new THREE.BoxGeometry(3, deckH, 13), new THREE.MeshLambertMaterial({ color: 0x70706e }));
    pier.position.set(sx(bxw) + s * 24, deckH / 2, sz(2000)); scene.add(pier);
  }
  collBlds.push({ x: sx(bxw), z: sz(2000), hw: 40, hd: 7.5, a: 0, h: deckH + 1.4, deckMin: deckH - 0.7 });

  // power lines: pylons + sagging wires
  const { pylons, wires } = addPower(scene, Wd, night);

  // weather particles
  const weather = addWeather(scene, cfg);

  return { scene, Wd, cfg, night, dusk, over, collBlds, pylons, wires, sun, sunDir, deckH, bxw, gtex, water, skyDome, shadows: strong, tex };
}

function addRoads(scene, Wd, night) {
  const pos = [], colArr = [];
  const widths = { dirt: 6, town: 9, hwy: 11 };
  const shade = { dirt: Wd.winter ? [0.72, 0.7, 0.66] : [0.5, 0.42, 0.3], town: [0.28, 0.28, 0.29], hwy: [0.26, 0.26, 0.27] };
  const push = (ax, az, bx, bz, w, c) => {
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1, nx = -dz / l * w / 2, nz = dx / l * w / 2;
    const q = [[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]];
    const idx = [0, 1, 2, 0, 2, 3];
    for (const k of idx) { pos.push(q[k][0], 0.06, q[k][1]); colArr.push(c[0], c[1], c[2]); }
  };
  for (const e of Wd.edges) {
    const c = (shade[e.type] || shade.town).map(v => night ? v * 0.5 : v);
    push(sx(e.a.x), sz(e.a.y), sx(e.b.x), sz(e.b.y), widths[e.type] || 6, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colArr, 3));
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true }));
  mesh.frustumCulled = false; scene.add(mesh);
}

function addRiver(scene, Wd, night, cfg, tex) {
  const pos = [], uv = [], step = 40;
  for (let y = 0; y <= WORLD; y += step) {
    const rx = Wd.riverX(y), x0 = sx(rx - 24), x1 = sx(rx + 24), z = sz(y), z2 = sz(Math.min(WORLD, y + step)), rx2 = Wd.riverX(Math.min(WORLD, y + step));
    const x0b = sx(rx2 - 24), x1b = sx(rx2 + 24), v = y / 60, v2 = (y + step) / 60;
    pos.push(x0, -0.8, z, x1, -0.8, z, x1b, -0.8, z2, x0, -0.8, z, x1b, -0.8, z2, x0b, -0.8, z2);
    uv.push(0, v, 1, v, 1, v2, 0, v, 1, v2, 0, v2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const c = cfg.winter ? 0xcad6de : night ? 0x18303e : 0x35617a;
  if (tex) tex.wbump.repeat.set(3, 40);
  const mat = new THREE.MeshStandardMaterial({ color: c, roughness: cfg.winter ? 0.8 : 0.28, metalness: cfg.winter ? 0.0 : 0.35,
    bumpMap: tex ? tex.wbump : null, bumpScale: 0.25, emissive: new THREE.Color(c).multiplyScalar(0.12) });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false; scene.add(mesh);
  return mesh;
}

function addPower(scene, Wd, night) {
  const pyl = [], wireList = [];
  const poleMat = new THREE.MeshLambertMaterial({ color: night ? 0x3a3a40 : 0x767680 });
  const distMat = new THREE.MeshLambertMaterial({ color: night ? 0x3a3024 : 0x6a5438 });
  for (const p of Wd.pylons) {
    const tx = p.kind === 'tx', h = p.h;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(tx ? 0.5 : 0.25, tx ? 1.0 : 0.3, h, tx ? 4 : 5), tx ? poleMat : distMat);
    shaft.position.set(sx(p.x), h / 2, sz(p.y)); scene.add(shaft);
    pyl.push({ x: sx(p.x), z: sz(p.y), h, r: tx ? 1.3 : 0.5 });
    if (tx) {
      for (let L = 0; L < 2; L++) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(15, 0.4, 0.4), poleMat);
        arm.position.set(sx(p.x), h - L * 4.2, sz(p.y)); arm.rotation.y = -p.dir + Math.PI / 2; scene.add(arm);
      }
    }
  }
  // wires: quadratic-sagged polylines as line segments
  const linePos = [];
  for (const w of Wd.wires) {
    const ax = sx(w.ax), az = sz(w.ay), bx = sx(w.bx), bz = sz(w.by), seg = 8;
    let px = ax, py = w.h, pz = az;
    for (let i = 1; i <= seg; i++) {
      const t = i / seg, mx = lerp(ax, bx, t), mz = lerp(az, bz, t);
      const my = w.h - w.sag * 4 * t * (1 - t);
      linePos.push(px, py, pz, mx, my, mz); px = mx; py = my; pz = mz;
    }
    wireList.push({ ax, az, bx, bz, h: w.h, sag: w.sag });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
  const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: night ? 0x202024 : 0x2a2a2e }));
  lines.frustumCulled = false; scene.add(lines);
  return { pylons: pyl, wires: wireList };
}

function addWeather(scene, cfg) {
  if (cfg.weather === 'clear') return null;
  const snow = cfg.winter, n = snow ? 1400 : cfg.weather === 'cloud' ? 700 : 1100;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pos[i * 3] = rr(-300, 300); pos[i * 3 + 1] = rr(0, 220); pos[i * 3 + 2] = rr(-300, 300); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: snow ? 0xffffff : 0x9fb0c0, size: snow ? 1.6 : 0.6, transparent: true, opacity: snow ? 0.9 : 0.5, depthWrite: false });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; scene.add(pts);
  return { pts, n, snow, fall: snow ? 6 : 42 };
}

// ============================================================ dynamic content: targets & flak
const VEHCOL = { tank: 0x3c4030, ifv: 0x40442f, spg: 0x3a3e2d, tel: 0x44483a, radar: 0x4a4d40, fuel: 0x5a6042, truck: 0x6a5a38, car: 0x9a3030, van: 0x4a5a8a, bus: 0xd0b840, staff: 0x30362a };
function addTargets(G) {
  const cfg = G.cfg, Wd = G.Wd, targets = [], flak = [];
  const mkMesh = (type, hostile) => {
    const T = API.VT[type] || API.VT.car;
    const grp = new THREE.Group();
    const bodyC = hostile ? (VEHCOL[type] || 0x3c4030) : (VEHCOL[type] || 0x8a8a8a);
    const body = new THREE.Mesh(new THREE.BoxGeometry(T.L, T.H * 0.7, T.W), new THREE.MeshStandardMaterial({ color: bodyC, roughness: 0.9, metalness: 0.1 }));
    body.position.y = T.H * 0.35; grp.add(body);
    if (type === 'tank' || type === 'ifv' || type === 'spg') {
      const tur = new THREE.Mesh(new THREE.BoxGeometry(T.L * 0.5, T.H * 0.4, T.W * 0.7), body.material.clone());
      tur.position.set(type === 'spg' ? -0.5 : 0.4, T.H * 0.75, 0); grp.add(tur);
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, T.L * 0.8), body.material.clone());
      bar.rotation.z = Math.PI / 2; bar.position.set(T.L * 0.5, T.H * 0.8, 0); grp.add(bar);
    } else if (type === 'fuel') {
      const tnk = new THREE.Mesh(new THREE.CylinderGeometry(T.H * 0.4, T.H * 0.4, T.L * 0.7), new THREE.MeshStandardMaterial({ color: 0x9a9a8a, roughness: 0.6, metalness: 0.3 }));
      tnk.rotation.z = Math.PI / 2; tnk.position.y = T.H * 0.5; grp.add(tnk);
    } else if (type === 'tel') {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(T.L * 0.8, 0.5, T.W * 0.8), body.material.clone());
      rail.position.y = T.H * 0.7; rail.rotation.z = 0.15; grp.add(rail);
    } else if (type === 'radar') {
      const dish = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5, 3), new THREE.MeshStandardMaterial({ color: 0xb0b4a0 }));
      dish.position.y = T.H; grp.add(dish);
    } else {
      const cab = new THREE.Mesh(new THREE.BoxGeometry(T.L * 0.5, T.H * 0.5, T.W * 0.9), new THREE.MeshStandardMaterial({ color: bodyC }));
      cab.position.y = T.H * 0.75; grp.add(cab);
    }
    return grp;
  };
  const addVeh = (type, worldX, worldY, hd, hostile, opt = {}) => {
    const mesh = mkMesh(type, hostile); mesh.position.set(sx(worldX), 0, sz(worldY)); mesh.rotation.y = -hd;
    if (G.shadows) mesh.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    G.scene.add(mesh);
    const T = API.VT[type] || API.VT.car;
    const t = Object.assign({ mesh, type, x: sx(worldX), z: sz(worldY), hd, hostile, alive: true, r: Math.max(T.L, T.W) / 2, occ: T.occ, fuel: type === 'fuel', hvt: false }, opt);
    targets.push(t); return t;
  };
  const addFlak = (worldX, worldY) => { flak.push({ x: sx(worldX), z: sz(worldY), cd: rr(2, 5) }); };

  if (cfg.mode === 'strike' && cfg.id === 'strike_column') {
    const y = 2000, order = ['tank', 'ifv', 'fuel', 'tank', 'ifv', 'spg'];
    order.forEach((type, k) => { const t = addVeh(type, 500 + k * 26, y, 0, true, { col: true, spd: 6 }); });
    for (let k = 0; k < 5; k++) addVeh(chance(0.3) ? 'van' : 'car', 700 + k * 40, y, 0, false, { col: true, spd: 9 });
    addFlak(640, 2070);
  } else if (cfg.id === 'strike_sam') {
    const cx = 2600, cy = 1150;
    addVeh('radar', cx, cy + 16, 0.3, true);
    addVeh('tel', cx - 36, cy - 16, 1.2, true); addVeh('tel', cx + 38, cy - 20, 1.9, true);
    addVeh('truck', cx + 6, cy - 48, 0, true);
    addFlak(cx - 20, cy); addFlak(cx + 30, cy - 8);
  } else if (cfg.id === 'strike_depot') {
    const cx = 1400, cy = 1150;
    for (let k = 0; k < 10; k++) {
      const type = k % 5 === 0 ? 'fuel' : pick(['tank', 'ifv', 'spg', 'truck']);
      addVeh(type, cx + (k % 5) * 22 + rr(-4, 4), cy + Math.floor(k / 5) * 26, rr(0, TAU), true);
    }
    addFlak(cx + 50, cy + 60);
  } else if (cfg.mode === 'bomb') {
    const cx = cfg.id === 'bomb_night' ? 1500 : 1300, cy = 1150;
    for (let k = 0; k < 9; k++) {
      const type = k % 4 === 0 ? 'fuel' : pick(['tank', 'ifv', 'spg', 'truck', 'tel']);
      addVeh(type, cx + (k % 3) * 34 + rr(-6, 6), cy + Math.floor(k / 3) * 30, rr(0, TAU), true);
    }
    for (let k = 0; k < 3; k++) addVeh('car', cx + 160 + k * 30, cy + 120, 0, false); // civilian traffic nearby
    for (let f = 0; f < (cfg.flak || 1); f++) addFlak(cx + rr(-40, 80), cy + rr(-40, 80));
  }
  G.targets = targets; G.flak = flak;
  G.targetsTotal = targets.filter(t => t.hostile).length;
}

// ============================================================ effects: explosions, shockwaves, ragdoll
function initFx(G) { G.debris = []; G.rings = []; G.flashes = []; G.puffs = []; G.tracers = []; G.bombs = []; }
function explode(G, pos, power, fuel) {
  const S2 = power;
  // flash
  const fl = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: fuel ? 0xffd27a : 0xffe8b0, transparent: true }));
  fl.position.copy(pos); G.scene.add(fl); G.flashes.push({ mesh: fl, t: 0, dur: fuel ? 1.0 : 0.6, r: S2 * (fuel ? 4 : 2.6) });
  // shockwave ring on the ground
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(pos.x, 0.4, pos.z); G.scene.add(ring);
  G.rings.push({ mesh: ring, t: 0, dur: 0.8, r: S2 * (fuel ? 7 : 4) });
  // ragdoll debris chunks
  const nchunk = fuel ? 22 : 14;
  for (let k = 0; k < nchunk; k++) {
    const sz2 = rr(0.3, fuel ? 1.4 : 1.0);
    const chunk = new THREE.Mesh(new THREE.BoxGeometry(sz2, sz2 * rr(0.5, 1), sz2 * rr(0.5, 1)),
      new THREE.MeshStandardMaterial({ color: k % 3 === 0 ? 0x1a1a18 : (fuel ? 0x3a3630 : 0x4a4a3e), roughness: 1, emissive: k % 4 === 0 ? 0x661a00 : 0x000000 }));
    chunk.position.copy(pos); chunk.position.y += rr(0, 2);
    const a = rr(0, TAU), up = rr(6, fuel ? 26 : 18), out = rr(4, fuel ? 20 : 14);
    G.scene.add(chunk);
    G.debris.push({ mesh: chunk, v: new THREE.Vector3(Math.cos(a) * out, up, Math.sin(a) * out), w: new THREE.Vector3(rr(-8, 8), rr(-8, 8), rr(-8, 8)), life: rr(2.5, 5), max: 5 });
  }
  // smoke puffs
  for (let k = 0; k < (fuel ? 14 : 8); k++) {
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(rr(1.5, 3.2), 0), new THREE.MeshLambertMaterial({ color: 0x2a2a2a, transparent: true, opacity: 0.8 }));
    puff.position.set(pos.x + rr(-S2, S2), pos.y + rr(0, 3), pos.z + rr(-S2, S2)); G.scene.add(puff);
    G.puffs.push({ mesh: puff, v: new THREE.Vector3(rr(-1, 1), rr(2, 5), rr(-1, 1)), life: rr(3, 6), max: 6, grow: rr(1.5, 3) });
  }
  if (!API.Snd.muted) API.Snd.boom(fuel ? 1.3 : 0.9);
  G.shake = Math.max(G.shake, fuel ? 1.3 : 0.8);
  G.staticBurst = Math.max(G.staticBurst, 0.35);
}
function updateFx(G, dt) {
  const g = 9.8;
  for (const d of G.debris) {
    d.life -= dt; d.v.y -= g * dt; d.mesh.position.addScaledVector(d.v, dt);
    if (d.mesh.position.y < 0.2) { d.mesh.position.y = 0.2; d.v.y = -d.v.y * 0.35; d.v.x *= 0.6; d.v.z *= 0.6; d.w.multiplyScalar(0.7); }
    d.mesh.rotation.x += d.w.x * dt; d.mesh.rotation.y += d.w.y * dt; d.mesh.rotation.z += d.w.z * dt;
    if (d.life < 1) { d.mesh.scale.setScalar(Math.max(0.05, d.life)); }
  }
  G.debris = sweep(G, G.debris);
  for (const r of G.rings) { r.t += dt; const p = r.t / r.dur, s = 1 + p * r.r; r.mesh.scale.set(s, s, s); r.mesh.material.opacity = (1 - p) * 0.8; }
  G.rings = sweep(G, G.rings, r => r.t >= r.dur);
  for (const f of G.flashes) { f.t += dt; const p = f.t / f.dur, s = 0.5 + p * f.r; f.mesh.scale.setScalar(s); f.mesh.material.opacity = (1 - p); }
  G.flashes = sweep(G, G.flashes, f => f.t >= f.dur);
  for (const p of G.puffs) { p.life -= dt; p.mesh.position.addScaledVector(p.v, dt); p.v.multiplyScalar(0.96); p.mesh.scale.addScalar(p.grow * dt); p.mesh.material.opacity = Math.max(0, 0.8 * p.life / p.max); }
  G.puffs = sweep(G, G.puffs);
  // tracers (flak)
  for (const t of G.tracers) { t.life -= dt; t.mesh.position.addScaledVector(t.v, dt); }
  G.tracers = sweep(G, G.tracers);
  // falling bombs
  for (const b of G.bombs) {
    b.v.y -= g * dt; b.mesh.position.addScaledVector(b.v, dt); b.life -= dt;
    b.mesh.rotation.x += 2 * dt;
    const gh = groundY(G, b.mesh.position.x, b.mesh.position.z);
    let hit = b.mesh.position.y <= gh + 0.3;
    if (!hit) { for (const tg of G.targets) if (tg.alive && Math.hypot(b.mesh.position.x - tg.x, b.mesh.position.z - tg.z) < tg.r + 1.2 && b.mesh.position.y < tg.r + 2) { hit = true; break; } }
    if (hit) { b.done = true; detonate(G, b.mesh.position.clone(), 7); }
  }
  G.bombs = G.bombs.filter(b => { if (b.done || b.life < 0) { G.scene.remove(b.mesh); return false; } return true; });
}
function sweep(G, arr, extra) {
  return arr.filter(o => { const dead = o.life < 0 || (extra && extra(o)); if (dead) { G.scene.remove(o.mesh); } return !dead; });
}

// a ground detonation that damages whatever is near (bombs, dives)
function detonate(G, pos, radius) {
  let killed = 0, civ = false, fuelHit = false;
  for (const t of G.targets) {
    if (!t.alive) continue;
    const d = Math.hypot(pos.x - t.x, pos.z - t.z);
    if (d < radius + t.r) {
      if (!t.hostile) { civ = true; }
      t.alive = false; t.mesh.visible = false; killed++;
      explode(G, new THREE.Vector3(t.x, 1, t.z), t.fuel ? 5 : 3.4, t.fuel);
      if (t.fuel) { fuelHit = true; // chain to neighbours
        for (const o of G.targets) if (o.alive && o.hostile && Math.hypot(o.x - t.x, o.z - t.z) < 16) { o.alive = false; o.mesh.visible = false; killed++; setTimeout(() => S && explode(G, new THREE.Vector3(o.x, 1, o.z), o.fuel ? 5 : 3, o.fuel), rr(120, 400)); }
      }
    }
  }
  explode(G, pos, 3.2, fuelHit);
  if (civ) { G.civHit = true; }
  if (killed) { G.score += killed * 500; G.killed += killed; flash(G, (civ ? 'CIVILIAN HIT' : '+' + killed * 500), civ ? '#ff6a5a' : '#b6ff9e'); }
  return killed;
}

// ============================================================ flight model
function makeQuad(G) {
  const cfg = G.cfg;
  const start = startPoint(G);
  return {
    p: new THREE.Vector3(start.x, start.y, start.z),
    v: new THREE.Vector3(),
    q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, start.yaw, 0)),
    prevQ: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, start.yaw, 0)),
    throttle: 0.35, mode: cfg.mode === 'race' || cfg.mode === 'strike' ? 'level' : 'level',
    alive: true, respawnT: 0, armed: false,
    pitchSpin: 0, rollSpin: 0, diveFrom: null, spanLo: 1e9, spanHi: -1e9,
  };
}
function startPoint(G) {
  const cfg = G.cfg;
  if (cfg.mode === 'race' && G.gates && G.gates.length) {
    const g0 = G.gates[0]; return { x: g0.pos.x - g0.nx * 60, y: g0.pos.y, z: g0.pos.z - g0.nz * 60, yaw: Math.atan2(g0.nx, g0.nz) };
  }
  if (cfg.mode === 'strike' || cfg.mode === 'bomb') {
    const t = G.targets && G.targets.find(t => t.hostile && t.alive);
    const tx = t ? t.x : 0, tz = t ? t.z : 0;
    return { x: tx + 300, y: 55, z: tz + 300, yaw: Math.atan2(-(tx - (tx + 300)), -(tz - (tz + 300))) };
  }
  return { x: sx(2000), y: 20, z: sz(2000) + 200, yaw: Math.PI };
}

let QX, QY, QZ, UP;
function initConsts() { QX = new THREE.Vector3(1, 0, 0); QY = new THREE.Vector3(0, 1, 0); QZ = new THREE.Vector3(0, 0, 1); UP = new THREE.Vector3(0, 1, 0); }
function flyQuad(G, dt) {
  const Q = G.quad, cfg = G.cfg, inp = G.input;
  if (!Q.alive) { Q.respawnT -= dt; if (Q.respawnT <= 0) respawn(G); return; }
  const boost = inp.boost ? 1.6 : 1;
  const up = UP.clone().applyQuaternion(Q.q);
  if (Q.mode === 'level') {
    // forgiving camera-drone feel: gentle self-levelling, altitude hold and auto-brake
    const maxTilt = 30 * DEG;
    G.yaw = (G.yaw || 0) + inp.yaw * 100 * DEG * dt;
    const qYaw = new THREE.Quaternion().setFromAxisAngle(QY, G.yaw);
    const qTilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(inp.pitch * maxTilt, 0, -inp.roll * maxTilt, 'XYZ'));
    Q.q.slerp(qYaw.multiply(qTilt), 1 - Math.exp(-10 * dt));
    // vertical: left stick commands a climb rate; centred = hold altitude (auto-throttle)
    const vyTarget = inp.climb * 9 * boost;
    let tMag = (9.8 + (vyTarget - Q.v.y) * 3.2) / Math.max(0.4, up.y);
    tMag = clamp(tMag, 0, 26 * boost);
    Q.throttle = clamp(tMag / 26, 0, 1);
    const accel = up.clone().multiplyScalar(tMag); accel.y -= 9.8;
    Q.v.addScaledVector(accel, dt);
    // auto-brake horizontal drift when the right stick is centred (position-hold feel)
    const brake = (Math.abs(inp.pitch) + Math.abs(inp.roll)) < 0.08 ? 2.4 : 0.4;
    Q.v.x -= Q.v.x * brake * dt; Q.v.z -= Q.v.z * brake * dt;
    const spd = Q.v.length();
    Q.v.addScaledVector(Q.v, -(0.32 + 0.012 * spd) * dt);
  } else {
    // acro: full rate control for flips and loops; direct throttle
    const dq = new THREE.Quaternion().setFromEuler(new THREE.Euler(inp.pitch * 420 * DEG * dt, inp.yaw * 240 * DEG * dt, -inp.roll * 420 * DEG * dt, 'XYZ'));
    Q.q.multiply(dq); Q.q.normalize();
    Q.throttle = lerp(Q.throttle, clamp((inp.climb + 1) / 2, 0, 1), 1 - Math.exp(-8 * dt));
    const accel = up.clone().multiplyScalar(Q.throttle * 28 * boost); accel.y -= 9.8;
    Q.v.addScaledVector(accel, dt);
    const spd = Q.v.length();
    Q.v.addScaledVector(Q.v, -(0.5 + 0.018 * spd) * dt);
  }
  Q.p.addScaledVector(Q.v, dt);
  const spd = Q.v.length();
  // trick accounting via quaternion delta -> body rates
  const dQ = Q.q.clone().multiply(Q.prevQ.clone().invert());
  const omega = new THREE.Euler().setFromQuaternion(dQ, 'XYZ');
  const bpitch = omega.x / DEG, broll = omega.z / DEG;
  Q.prevQ.copy(Q.q);
  trackTricks(G, bpitch, broll, dt);
  // collisions
  collide(G, dt);
  G.cam.spd = spd;
}
function respawn(G) {
  const sp = startPoint(G);
  const Q = G.quad;
  Q.p.set(sp.x, Math.max(sp.y, 12), sp.z); Q.v.set(0, 0, 0);
  Q.q.setFromEuler(new THREE.Euler(0, sp.yaw, 0)); Q.prevQ.copy(Q.q); G.yaw = sp.yaw;
  Q.throttle = 0.4; Q.alive = true; Q.armed = false; Q.pitchSpin = Q.rollSpin = 0; Q.diveFrom = null;
  G.staticBurst = Math.max(G.staticBurst, 0.5);
  G.motors && G.motors.update && (G.motorsAlive = true);
}
function crash(G, reason) {
  const Q = G.quad; if (!Q.alive) return;
  Q.alive = false; Q.respawnT = 1.6;
  explode(G, Q.p.clone(), 1.6, false);
  G.staticBurst = 1; G.shake = Math.max(G.shake, 1);
  G.motors && G.motors.crash();
  endCombo(G);
  flash(G, 'CRASH', '#ff6a5a');
  if (G.cfg.mode === 'strike') { G.dronesLeft--; if (G.dronesLeft < 0) G.dronesLeft = 0; }
  if ((G.cfg.mode === 'strike') && G.dronesLeft <= 0 && !G.over) finish(G, G.killed >= G.targetsTotal);
}
function groundY(G, x, z) {
  const rxs = sx(G.Wd.riverX(wy(z)));
  return Math.abs(x - rxs) < 24 ? -0.9 : 0;
}
function collide(G, dt) {
  const Q = G.quad, p = Q.p;
  // world bounds
  if (p.x < -O + 6 || p.x > O - 6 || p.z < -O + 6 || p.z > O - 6) {
    p.x = clamp(p.x, -O + 6, O - 6); p.z = clamp(p.z, -O + 6, O - 6); Q.v.multiplyScalar(0.3);
  }
  // ground
  const gh = groundY(G, p.x, p.z);
  if (p.y < gh + 0.5) {
    const tilt = Math.acos(clamp(UP.clone().applyQuaternion(Q.q).y, -1, 1));
    // forgiving: only a genuinely hard, steep or fast impact crashes; otherwise skim the ground
    if (Q.v.y < -11 || tilt > 62 * DEG || Q.v.length() > 19) { crash(G, 'ground'); return; }
    p.y = gh + 0.5; Q.v.y = Math.max(Q.v.y, 0) * 0.3; Q.v.x *= 0.92; Q.v.z *= 0.92;
  }
  // buildings / bridge
  for (const b of G.collBlds) {
    if (Math.abs(p.x - b.x) > b.hw + 3 || Math.abs(p.z - b.z) > b.hd + 3) continue;
    if (p.y > b.h + 0.4) continue;
    if (b.deckMin != null && p.y < b.deckMin) continue; // flying under the bridge deck
    const dx = p.x - b.x, dz = p.z - b.z, ca = Math.cos(b.a), sa = Math.sin(b.a);
    const u = dx * ca + dz * sa, w2 = -dx * sa + dz * ca;
    if (Math.abs(u) < b.hw + 0.5 && Math.abs(w2) < b.hd + 0.5) { crash(G, 'building'); return; }
  }
  // pylons
  for (const py of G.pylons) { if (Math.hypot(p.x - py.x, p.z - py.z) < py.r + 0.6 && p.y < py.h) { crash(G, 'pylon'); return; } }
  // wires
  for (const w of G.wires) {
    const dx = w.bx - w.ax, dz = w.bz - w.az, l2 = dx * dx + dz * dz; if (!l2) continue;
    const t = clamp(((p.x - w.ax) * dx + (p.z - w.az) * dz) / l2, 0, 1);
    const cx = w.ax + dx * t, cz = w.az + dz * t, cy = w.h - w.sag * 4 * t * (1 - t);
    if (Math.hypot(p.x - cx, p.z - cz) < 0.7 && Math.abs(p.y - cy) < 0.6) { crash(G, 'wires'); return; }
  }
  // strike contact
  if ((G.cfg.mode === 'strike') && Q.alive) {
    for (const tg of G.targets) {
      if (!tg.alive) continue;
      if (Math.hypot(p.x - tg.x, p.z - tg.z) < tg.r + 1.0 && p.y < tg.r + 2.2) {
        const killed = detonate(G, new THREE.Vector3(tg.x, 1, tg.z), 5);
        G.quad.alive = false; G.quad.respawnT = 1.5; G.dronesLeft--;
        G.motors && G.motors.crash();
        if (G.civHit) { finish(G, false); return; }
        if (G.killed >= G.targetsTotal) { finish(G, true); return; }
        if (G.dronesLeft <= 0) { finish(G, G.killed >= G.targetsTotal); return; }
        return;
      }
    }
  }
}

// ============================================================ tricks, gaps, combos
function trackTricks(G, bpitch, broll, dt) {
  const Q = G.quad;
  Q.pitchSpin += bpitch; Q.rollSpin += broll;
  Q.spanLo = Math.min(Q.spanLo, Q.p.y); Q.spanHi = Math.max(Q.spanHi, Q.p.y);
  if (Math.abs(Q.rollSpin) >= 350) { award(G, 'ROLL', 100); Q.rollSpin -= Math.sign(Q.rollSpin) * 360; }
  if (Math.abs(Q.pitchSpin) >= 350) {
    const span = Q.spanHi - Q.spanLo;
    if (span > 16 && G.cam.spd > 8) award(G, 'POWER LOOP', 280); else award(G, 'FLIP', 130);
    Q.pitchSpin -= Math.sign(Q.pitchSpin) * 360; Q.spanLo = Q.p.y; Q.spanHi = Q.p.y;
  }
  // dive
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(Q.q);
  const pitchAng = Math.asin(clamp(-fwd.y, -1, 1)) / DEG;
  if (Q.diveFrom == null && pitchAng > 48 && Q.v.y < -6) Q.diveFrom = Q.p.y;
  else if (Q.diveFrom != null && pitchAng < 18) {
    const drop = Q.diveFrom - Q.p.y; if (drop > 22 && Q.alive) award(G, 'DIVE', 150); Q.diveFrom = null;
  }
  // gaps
  if (G.gaps) for (const gp of G.gaps) {
    gp.cd = Math.max(0, gp.cd - dt);
    if (gp.cd === 0 && Q.p.x > gp.x0 && Q.p.x < gp.x1 && Q.p.z > gp.z0 && Q.p.z < gp.z1 && Q.p.y > gp.y0 && Q.p.y < gp.y1 && G.cam.spd > 4) {
      award(G, gp.label, gp.score); gp.cd = 2.6;
    }
  }
}
function award(G, label, base) {
  if (G.cfg.mode !== 'stunt') return;
  G.combo++; G.comboT = 3;
  const mult = Math.min(5, 1 + (G.combo - 1) * 0.5);
  const pts = Math.round(base * mult);
  G.score += pts; G.tricks++;
  flash(G, label + (G.combo > 1 ? '  x' + G.combo : '') + '  +' + pts, '#eaffea');
  if (!API.Snd.muted) API.Snd.pid();
}
function endCombo(G) { if (G.combo > 0) { G.combo = 0; G.comboT = 0; } }
function buildGaps(G) {
  const gaps = [], Wd = G.Wd;
  // under the bridge
  const bx = sx(G.bxw);
  gaps.push({ label: 'BRIDGE GAP', score: 220, cd: 0, x0: bx - 28, x1: bx + 28, z0: sz(1984), z1: sz(2016), y0: 1.0, y1: G.deckH - 0.9 });
  // under the low distribution line (west field, poles ~9m)
  const dist = Wd.powerlines.find(p => p.kind === 'dist');
  if (dist) for (let i = 0; i < dist.poles.length - 1; i++) {
    const a = dist.poles[i], b = dist.poles[i + 1];
    gaps.push({ label: 'WIRE GAP', score: 180, cd: 0, x0: sx(Math.min(a.x, b.x)) - 2, x1: sx(Math.max(a.x, b.x)) + 2, z0: sz(a.y) - 6, z1: sz(a.y) + 6, y0: 1.2, y1: dist.h - 1.4 });
  }
  // the alley between two tall apartment blocks near the centre
  const tall = Wd.blds.filter(b => b.h >= 11 && b.kind === 'bld');
  for (let i = 0; i < tall.length && gaps.length < 8; i++) for (let j = i + 1; j < tall.length; j++) {
    const a = tall[i], b = tall[j], d = hyp(a.x - b.x, a.y - b.y);
    if (d > 10 && d < 26) {
      const mxw = (a.x + b.x) / 2, myw = (a.y + b.y) / 2;
      gaps.push({ label: 'ALLEY GAP', score: 160, cd: 0, x0: sx(mxw) - 5, x1: sx(mxw) + 5, z0: sz(myw) - 5, z1: sz(myw) + 5, y0: 1.5, y1: Math.min(a.h, b.h) - 1 });
      i = tall.length; break;
    }
  }
  G.gaps = gaps;
  // marker posts so the player can see the gaps
  const postMat = new THREE.MeshBasicMaterial({ color: 0x66ffcc });
  for (const gp of gaps) {
    const cxm = (gp.x0 + gp.x1) / 2, czm = (gp.z0 + gp.z1) / 2;
    const ring = new THREE.Mesh(new THREE.TorusGeometry((gp.x1 - gp.x0) / 2 + 1.5, 0.22, 6, 20), new THREE.MeshBasicMaterial({ color: 0x55e0b0, transparent: true, opacity: 0.5 }));
    ring.position.set(cxm, (gp.y0 + gp.y1) / 2, czm); ring.rotation.x = Math.PI / 2; G.scene.add(ring); gp.marker = ring;
  }
}
function buildGates(G) {
  const cfg = G.cfg, Wd = G.Wd, gates = [], pts = [];
  if (cfg.id === 'race_river') {
    for (let y = 700; y <= 3400; y += 340) { const rx = Wd.riverX(y); pts.push({ x: rx + (chance(0.5) ? 40 : -40), y, h: y > 1800 && y < 2200 ? 3.2 : rr(10, 24) }); }
  } else {
    const path = [[700, 2000], [1200, 2000], [1750, 2000], [2000, 2250], [2000, 1750], [1750, 1500], [2250, 1500], [2600, 2000], [2600, 2600], [2000, 2600]];
    for (const [x, y] of path) pts.push({ x, y, h: rr(8, 16) });
  }
  pts.forEach((pt, i) => {
    const nx = i < pts.length - 1 ? pts[i + 1].x - pt.x : pt.x - pts[i - 1].x;
    const ny = i < pts.length - 1 ? pts[i + 1].y - pt.y : pt.y - pts[i - 1].y;
    const l = Math.hypot(nx, ny) || 1;
    const r = 9;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.5, 8, 24), new THREE.MeshStandardMaterial({ color: i === 0 ? 0x55ff88 : 0xff8a3a, emissive: i === 0 ? 0x113311 : 0x331500 }));
    ring.position.set(sx(pt.x), pt.h, sz(pt.y)); ring.rotation.y = Math.atan2(nx, ny) + Math.PI / 2; G.scene.add(ring);
    gates.push({ mesh: ring, pos: ring.position.clone(), nx: nx / l, nz: ny / l, r, passed: false });
  });
  G.gates = gates; G.gateIdx = 0;
}
function checkGates(G, dt) {
  if (!G.gates || G.gateIdx >= G.gates.length) return;
  const g = G.gates[G.gateIdx], p = G.quad.p;
  g.mesh.material.emissive && g.mesh.material.emissive.setHex(0x115533);
  if (Math.hypot(p.x - g.pos.x, p.y - g.pos.y, p.z - g.pos.z) < g.r * 0.95) {
    g.passed = true; g.mesh.material.color.setHex(0x335544); g.mesh.material.emissive.setHex(0x000000);
    G.gateIdx++; if (!API.Snd.muted) API.Snd.lock();
    if (G.gateIdx < G.gates.length) G.gates[G.gateIdx].mesh.material.color.setHex(0x55ff88);
    else finish(G, true);
  }
}

// ============================================================ flak
function updateFlak(G, dt) {
  if (!G.flak || !G.quad.alive) return;
  const p = G.quad.p;
  for (const f of G.flak) {
    f.cd -= dt;
    const d = Math.hypot(p.x - f.x, p.z - f.z);
    if (f.cd <= 0 && d < 420) {
      f.cd = rr(0.9, 2.2);
      // tracer toward the drone's lead position
      const dir = new THREE.Vector3(p.x - f.x, p.y - 2, p.z - f.z).normalize();
      for (let k = 0; k < 5; k++) {
        const tr = new THREE.Mesh(new THREE.SphereGeometry(0.5, 5, 4), new THREE.MeshBasicMaterial({ color: 0xff7a3a }));
        tr.position.set(f.x, 2, f.z); G.scene.add(tr);
        const spread = dir.clone().add(new THREE.Vector3(rr(-0.06, 0.06), rr(-0.04, 0.06), rr(-0.06, 0.06)));
        G.tracers.push({ mesh: tr, v: spread.multiplyScalar(160), life: 2.2 });
      }
      if (d < 70 && chance(0.5)) { G.staticBurst = Math.max(G.staticBurst, 0.6); G.shake = Math.max(G.shake, 0.5); if (chance(0.3)) crash(G, 'flak'); }
    }
  }
}

// ============================================================ dynamic targets (column motion)
function moveTargets(G, dt) {
  for (const t of G.targets) {
    if (!t.alive || !t.col) continue;
    t.x += (t.spd || 0) * dt; // columns roll east along the highway (scene +x)
    t.mesh.position.x = t.x;
    if (t.x > O - 60) { t.x = -O + 60; }
  }
}

// ============================================================ bomb release
function dropBomb(G) {
  const Q = G.quad; if (!Q.alive || G.bombsLeft <= 0) return;
  G.bombsLeft--;
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.1, 6), new THREE.MeshStandardMaterial({ color: 0x2a2a28, metalness: 0.4, roughness: 0.6 }));
  m.position.copy(Q.p); G.scene.add(m);
  G.bombs.push({ mesh: m, v: Q.v.clone().multiplyScalar(0.95).add(new THREE.Vector3(0, -1, 0)), life: 12 });
  if (!API.Snd.muted) API.Snd.click();
  if (G.bombsLeft <= 0) flash(G, 'WINCHESTER — RTB', '#ffd36a');
}

// ============================================================ HUD overlay (goggles) + analog static
let hudCv, hudCtx, noiseTiles = [];
function initHud() {
  hudCv = document.getElementById('fpvHud'); hudCtx = hudCv.getContext('2d');
  if (!noiseTiles.length) for (let i = 0; i < 4; i++) {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), id = g.createImageData(128, 128);
    for (let j = 0; j < id.data.length; j += 4) { const v = Math.random() * 255; id.data[j] = id.data[j + 1] = id.data[j + 2] = v; id.data[j + 3] = 255; }
    g.putImageData(id, 0, 0); noiseTiles.push(c);
  }
}
const flashes = [];
function flash(G, text, color) { G.hudFlashes.push({ text, color, t: 0 }); if (G.hudFlashes.length > 6) G.hudFlashes.shift(); }
function drawHud(G) {
  const dpr = G.dpr, w = G.cssW, h = G.cssH;
  hudCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  hudCtx.clearRect(0, 0, w, h);
  const green = '#9effa8', dim = 'rgba(150,220,160,0.7)', amber = '#ffd36a', red = '#ff6a5a';
  const font = s => `${Math.round(s)}px "Share Tech Mono", ui-monospace, monospace`;
  const T = (s, x, y, size, c, al = 'left') => { hudCtx.font = font(size); hudCtx.textAlign = al; hudCtx.textBaseline = 'alphabetic'; hudCtx.lineWidth = 3; hudCtx.strokeStyle = 'rgba(0,0,0,0.6)'; hudCtx.strokeText(s, x, y); hudCtx.fillStyle = c; hudCtx.fillText(s, x, y); };
  const u = clamp(Math.min(w, h) / 620, 0.72, 1.3);

  // analog static — a low baseline flicker, spiking on hits, flak, range and a dying battery
  const Q = G.quad;
  let st = 0.03 + G.staticBurst + 0.015 * Math.random();
  st += clamp((hyp(wx(Q.p.x) - O, wy(Q.p.z) - O)) / 5200, 0, 0.14); // range noise
  st += Math.max(0, (0.25 - G.battery)) * 0.8;                       // only a weak battery
  st = clamp(st, 0, 1);
  if (st > 0.05) {
    hudCtx.save(); hudCtx.globalAlpha = Math.min(0.85, st);
    hudCtx.drawImage(noiseTiles[(Math.random() * 4) | 0], Math.random() * 40, Math.random() * 40, w + 40, h + 40);
    hudCtx.globalAlpha = st;
    const bands = Math.round(st * 6);
    for (let i = 0; i < bands; i++) { const y = Math.random() * h, bh = Math.random() * 16 + 2; hudCtx.fillStyle = 'rgba(200,220,210,0.1)'; hudCtx.fillRect(0, y, w, bh); }
    if (st > 0.5) { const y = (G.t * 180 % (h + 60)) - 30; hudCtx.fillStyle = 'rgba(255,255,255,0.08)'; hudCtx.fillRect(0, y, w, 24); }
    hudCtx.restore();
  }
  // scanlines
  hudCtx.globalAlpha = 0.05; hudCtx.fillStyle = '#000';
  for (let y = 0; y < h; y += 3) hudCtx.fillRect(0, y, w, 1);
  hudCtx.globalAlpha = 1;
  // vignette
  const vg = hudCtx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.6)'); hudCtx.fillStyle = vg; hudCtx.fillRect(0, 0, w, h);
  // goggle frame circles
  hudCtx.strokeStyle = 'rgba(120,200,140,0.18)'; hudCtx.lineWidth = 2; hudCtx.beginPath(); hudCtx.arc(w / 2, h / 2, Math.min(w, h) * 0.52, 0, TAU); hudCtx.stroke();

  // crosshair
  const cx = w / 2, cy = h / 2;
  hudCtx.strokeStyle = green; hudCtx.lineWidth = 1.5;
  if (G.cfg.mode === 'strike' || G.cfg.mode === 'bomb') {
    hudCtx.beginPath(); hudCtx.arc(cx, cy, 10 * u, 0, TAU); hudCtx.moveTo(cx - 18 * u, cy); hudCtx.lineTo(cx - 6 * u, cy); hudCtx.moveTo(cx + 6 * u, cy); hudCtx.lineTo(cx + 18 * u, cy); hudCtx.moveTo(cx, cy - 18 * u); hudCtx.lineTo(cx, cy - 6 * u); hudCtx.stroke();
  } else {
    hudCtx.beginPath(); hudCtx.arc(cx, cy, 2.5, 0, TAU); hudCtx.stroke();
  }

  // OSD: top-left
  const pad = 16 * u, lh = 18 * u;
  T(G.cfg.name, pad, 24 * u, 14 * u, green);
  T((Q.mode === 'level' ? 'SELF-LEVEL' : 'ACRO') + (G.input.boost ? '  BOOST' : ''), pad, 24 * u + lh, 12 * u, Q.mode === 'level' ? dim : amber);
  // battery
  const bw = 90 * u, bx = pad, by = h - 26 * u;
  hudCtx.strokeStyle = dim; hudCtx.strokeRect(bx, by, bw, 10 * u);
  hudCtx.fillStyle = G.battery < 0.2 ? red : green; hudCtx.fillRect(bx + 1, by + 1, (bw - 2) * G.battery, 10 * u - 2);
  T('BATT', bx, by - 4 * u, 10 * u, dim);
  // throttle bar (right)
  const tx = w - pad - 10 * u, ty0 = h - 26 * u - 80 * u, th = 90 * u;
  hudCtx.strokeStyle = dim; hudCtx.strokeRect(tx, ty0, 10 * u, th);
  hudCtx.fillStyle = green; hudCtx.fillRect(tx + 1, ty0 + th - th * Q.throttle + 1, 10 * u - 2, th * Q.throttle - 2);
  T('THR', tx - 2 * u, ty0 - 4 * u, 10 * u, dim, 'left');

  // top-right mode status
  const spdKmh = Math.round(G.cam.spd * 3.6);
  T(spdKmh + ' KM/H', w - pad, 24 * u, 13 * u, green, 'right');
  T('ALT ' + Math.round(Q.p.y) + 'M', w - pad, 24 * u + lh, 12 * u, dim, 'right');
  if (G.cfg.mode === 'stunt') {
    T('SCORE ' + G.score, w - pad, 24 * u + lh * 2, 13 * u, green, 'right');
    if (G.combo > 1) T('COMBO x' + G.combo + '  ' + G.comboT.toFixed(1) + 's', w - pad, 24 * u + lh * 3, 12 * u, amber, 'right');
    if (G.cfg.target) T('TARGET ' + G.cfg.target, w - pad, 24 * u + lh * 4, 11 * u, dim, 'right');
  } else if (G.cfg.mode === 'race') {
    T('GATE ' + Math.min(G.gateIdx + 1, G.gates.length) + '/' + G.gates.length, w - pad, 24 * u + lh * 2, 13 * u, green, 'right');
  } else {
    if (G.cfg.mode === 'strike') T('DRONES ' + G.dronesLeft, w - pad, 24 * u + lh * 2, 13 * u, G.dronesLeft <= 1 ? amber : green, 'right');
    else T('BOMBS ' + G.bombsLeft, w - pad, 24 * u + lh * 2, 13 * u, G.bombsLeft <= 2 ? amber : green, 'right');
    T('TARGETS ' + (G.targetsTotal - G.killed) + '/' + G.targetsTotal, w - pad, 24 * u + lh * 3, 12 * u, dim, 'right');
  }
  // timer
  if (G.timeLeft != null) T('T ' + Math.max(0, G.timeLeft).toFixed(0) + 's', cx, 24 * u, 14 * u, G.timeLeft < 15 ? red : green, 'center');
  if (!G.quad.alive && !G.over) T(G.cfg.mode === 'strike' ? 'DRONE EXPENDED' : 'RECOVERING…', cx, cy + 60 * u, 16 * u, amber, 'center');

  // flash log (tricks, hits)
  let fy = cy - 110 * u;
  for (let i = G.hudFlashes.length - 1; i >= 0; i--) {
    const f = G.hudFlashes[i]; f.t += G.dt;
    if (f.t > 2.2) continue;
    hudCtx.globalAlpha = clamp((2.2 - f.t) / 0.6, 0, 1);
    T(f.text, cx, fy, 18 * u, f.color, 'center'); fy -= 22 * u; hudCtx.globalAlpha = 1;
  }
  G.hudFlashes = G.hudFlashes.filter(f => f.t <= 2.2);
}

// ============================================================ input
const keys = {};
function makeInput() {
  return { thr: 0, throttle: 0.4, yaw: 0, pitch: 0, roll: 0, boost: false, lx: 0, ly: 0, rx: 0, ry: 0 };
}
function readInput(G, dt) {
  const inp = G.input;
  // keyboard targets
  let ky = 0, kyaw = 0, kp = 0, kr = 0;
  if (keys['w']) ky += 1; if (keys['s']) ky -= 1;
  if (keys['a']) kyaw -= 1; if (keys['d']) kyaw += 1;
  if (keys['arrowup'] || keys['i']) kp += 1; if (keys['arrowdown'] || keys['k']) kp -= 1;
  if (keys['arrowleft'] || keys['j']) kr -= 1; if (keys['arrowright'] || keys['l']) kr += 1;
  inp.boost = !!keys['shift'] || G.padBoost;
  // gamepad
  let gLx = 0, gLy = 0, gRx = 0, gRy = 0;
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const pad = pads && [...pads].find(p => p);
  if (pad) {
    gLx = dead(pad.axes[0]); gLy = -dead(pad.axes[1]); gRx = dead(pad.axes[2]); gRy = -dead(pad.axes[3]);
    G.padBoost = pad.buttons[6] && pad.buttons[6].pressed || pad.buttons[4] && pad.buttons[4].pressed;
    const strike = (pad.buttons[7] && pad.buttons[7].pressed) || (pad.buttons[0] && pad.buttons[0].pressed);
    if (strike && !G.padStrikePrev) actionPrimary(G); G.padStrikePrev = strike;
    const modeb = pad.buttons[3] && pad.buttons[3].pressed; if (modeb && !G.padModePrev) toggleMode(G); G.padModePrev = modeb;
    const rec = pad.buttons[1] && pad.buttons[1].pressed; if (rec && !G.padRecPrev) respawn(G); G.padRecPrev = rec;
  }
  // combine: touch sticks + keyboard + gamepad (whichever is active)
  const lx = G.stickL.active ? G.stickL.x : (gLx || kyaw);
  const ly = G.stickL.active ? G.stickL.y : (gLy || ky);
  const rx = G.stickR.active ? G.stickR.x : (gRx || kr);
  const ry = G.stickR.active ? G.stickR.y : (gRy || kp);
  // a little expo for fine control around centre
  const expo = v => clamp(v, -1, 1) * (0.4 + 0.6 * v * v);
  inp.yaw = expo(lx); inp.roll = expo(rx); inp.pitch = expo(-ry); // stick up = nose down => pitch forward
  // left-stick Y / W-S is a climb command: push to ascend, centre to hold altitude (self-level)
  inp.climb = clamp(ly, -1, 1);
}
function dead(v) { return Math.abs(v) < 0.12 ? 0 : v; }
function actionPrimary(G) {
  if (G.cfg.mode === 'bomb') dropBomb(G);
  else if (G.cfg.mode === 'strike') { G.quad.armed = true; G.input.boost = true; flash(G, 'ARMED', '#ffd36a'); }
}
function toggleMode(G) { G.quad.mode = G.quad.mode === 'level' ? 'acro' : 'level'; flash(G, G.quad.mode === 'acro' ? 'ACRO' : 'SELF-LEVEL', '#9effa8'); if (G.quad.mode === 'level') G.yaw = new THREE.Euler().setFromQuaternion(G.quad.q, 'YXZ').y; }

// ============================================================ touch sticks
function bindStick(el, stick) {
  const knob = el.querySelector('.knob');
  let id = null;
  const rad = 66;
  const set = (cx, cy, e) => {
    const r = el.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy), cl = Math.min(d, rad), nx = d ? dx / d * cl : 0, ny = d ? dy / d * cl : 0;
    knob.style.transform = `translate(${nx}px,${ny}px)`;
    stick.x = clamp(nx / rad, -1, 1); stick.y = clamp(-ny / rad, -1, 1);
  };
  el.addEventListener('pointerdown', e => { e.preventDefault(); id = e.pointerId; el.setPointerCapture(id); stick.active = true; set(0, 0, e); });
  el.addEventListener('pointermove', e => { if (e.pointerId === id) set(0, 0, e); });
  const up = e => { if (e.pointerId !== id) return; id = null; stick.active = false; knob.style.transform = ''; if (!stick.hold) { stick.x = 0; stick.y = 0; } };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}

// ============================================================ lifecycle
function ensureDom() {
  if (document.getElementById('fpvWrap')) return;
  const wrap = document.createElement('div'); wrap.id = 'fpvWrap';
  wrap.innerHTML = '<canvas id="fpv"></canvas><canvas id="fpvHud"></canvas>';
  document.body.appendChild(wrap);
  const touch = document.createElement('div'); touch.id = 'fpvTouch';
  touch.innerHTML =
    '<div class="stick l" id="stickL"><div class="knob"></div><div class="lbl">THR / YAW</div></div>' +
    '<div class="stick r" id="stickR"><div class="knob"></div><div class="lbl">PITCH / ROLL</div></div>' +
    '<div class="fpvbtns left"><button class="fpvbtn" data-fa="mode">MODE</button><button class="fpvbtn" data-fa="recover">R</button><button class="fpvbtn" data-fa="exit">EXIT</button></div>' +
    '<div class="fpvbtns"><button class="fpvbtn go" data-fa="primary">GO</button><button class="fpvbtn" data-fa="boost">BOOST</button></div>';
  document.body.appendChild(touch);
  // its own brief overlay (kept separate from the UAV brief so the shared COMMENCE button can't fire both)
  const brief = document.createElement('div'); brief.id = 'fpvBrief'; brief.className = 'overlay hidden';
  brief.innerHTML = '<div class="panel"><div class="ptitle" id="fpvBTitle"></div><div id="fpvBBody"></div><div class="btns"><button id="fpvBBack" class="btn ghost">BACK</button><button id="fpvBStart" class="btn">LAUNCH</button></div></div>';
  document.body.appendChild(brief);
  // end overlay
  const end = document.createElement('div'); end.id = 'fpvEnd'; end.className = 'overlay hidden';
  end.innerHTML = '<div class="panel"><div class="ptitle" id="fpvETitle"></div><div id="fpvEBody"></div><div class="btns"><button id="fpvEMenu" class="btn ghost">MENU</button><button id="fpvERetry" class="btn ghost">RETRY</button><button id="fpvENext" class="btn">NEXT</button></div></div>';
  document.body.appendChild(end);
}

function layout(G) {
  const w = window.innerWidth, h = window.innerHeight;
  G.cssW = w; G.cssH = h;
  // the 3D view can drop resolution under load; the HUD stays crisp
  const pr = Math.min(window.devicePixelRatio || 1, 2) * (G.renderScale || 1);
  G.renderer.setPixelRatio(pr);
  G.renderer.setSize(w, h, true);
  G.camera.aspect = w / h; G.camera.updateProjectionMatrix();
  G.dpr = Math.min(window.devicePixelRatio || 1, 2);
  const hud = document.getElementById('fpvHud');
  hud.width = Math.round(w * G.dpr); hud.height = Math.round(h * G.dpr);
}

async function start(cfg) {
  API.Snd.init();
  ensureDom();
  const splash = document.getElementById('fpvLoad'); splash.classList.remove('hidden');
  document.getElementById('fpvLoadMsg').textContent = THREE ? 'Building the world' : 'Loading flight systems';
  API.suspend();
  try { await loadThree(); } catch (e) { splash.classList.add('hidden'); API.resume(); alert('Could not load the 3D engine.'); return; }
  initConsts();

  const G = buildScene(cfg);
  G.t = 0; G.dt = 0; G.score = 0; G.combo = 0; G.comboT = 0; G.tricks = 0; G.killed = 0;
  G.shake = 0; G.staticBurst = 0; G.battery = 1; G.over = null; G.hudFlashes = []; G.renderScale = 1;
  G.timeLeft = cfg.time ? cfg.time : (cfg.mode === 'race' ? 0 : null);
  if (cfg.mode === 'race') G.timeLeft = 0; // counts up
  G.raceClock = 0;
  G.dronesLeft = cfg.drones || 0; G.bombsLeft = cfg.bombs || 0;
  G.civHit = false; G.targetsTotal = 0;
  G.renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('fpv'), antialias: true, powerPreference: 'high-performance' });
  G.renderer.setClearColor(G.scene.background);
  G.renderer.shadowMap.enabled = G.shadows;
  G.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  G.camera = new THREE.PerspectiveCamera(92, 1, 0.3, 4000);
  G.cam = { spd: 0 };
  initFx(G);
  if (cfg.mode === 'strike' || cfg.mode === 'bomb') addTargets(G);
  if (cfg.mode === 'race') buildGates(G);
  if (cfg.mode === 'stunt') buildGaps(G);
  G.quad = makeQuad(G);
  G.yaw = new THREE.Euler().setFromQuaternion(G.quad.q, 'YXZ').y;
  G.input = makeInput();
  G.stickL = { x: 0, y: 0, active: false }; G.stickR = { x: 0, y: 0, active: false };
  G.motors = makeMotors();
  layout(G);
  // show
  splash.classList.add('hidden');
  document.getElementById('fpvWrap').classList.add('on');
  document.getElementById('fpvTouch').classList.toggle('on', API.isTouch);
  initHud();
  bindStick(document.getElementById('stickL'), G.stickL);
  bindStick(document.getElementById('stickR'), G.stickR);
  for (const b of document.querySelectorAll('#fpvTouch .fpvbtn')) {
    const act = b.dataset.fa;
    if (act === 'boost') { b.addEventListener('pointerdown', e => { e.preventDefault(); G.touchBoost = true; b.classList.add('on'); }); const off = e => { G.touchBoost = false; b.classList.remove('on'); }; b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); }
    else b.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (act === 'primary') actionPrimary(G);
      else if (act === 'mode') toggleMode(G);
      else if (act === 'recover') respawn(G);
      else if (act === 'exit') exit();
    });
  }
  // relabel GO button per mode
  const go = document.querySelector('#fpvTouch .fpvbtn.go');
  go.textContent = cfg.mode === 'bomb' ? 'DROP' : cfg.mode === 'strike' ? 'STRIKE' : 'MODE2';
  if (cfg.mode === 'stunt' || cfg.mode === 'race') go.style.display = 'none'; else go.style.display = '';

  S = G;
  window.SteppeHawkFPV.active = true;
  G.onResize = () => layout(G);
  window.addEventListener('resize', G.onResize);
  clock.last = performance.now();
  G.raf = requestAnimationFrame(loop);
  // intro flash
  flash(G, cfg.name, '#9effa8');
}

function loop(now) {
  const G = S; if (!G) return;
  let dt = Math.max(0, Math.min(0.05, (now - clock.last) / 1000)); clock.last = now; G.dt = dt;
  G.t += dt;
  if (!G.over) {
    readInput(G, dt);
    if (G.touchBoost) G.input.boost = true;
    flyQuad(G, dt);
    if (G.cfg.mode === 'race') { if (G.quad.alive && G.gateIdx > 0) G.raceClock += dt; G.timeLeft = -G.raceClock; checkGates(G, dt); }
    if (G.cfg.mode === 'stunt') { G.comboT -= dt; if (G.comboT <= 0) endCombo(G); }
    if (G.cfg.mode === 'strike' || G.cfg.mode === 'bomb') { moveTargets(G, dt); updateFlak(G, dt); }
    if (G.timeLeft != null && G.cfg.mode !== 'race') { G.timeLeft -= dt; if (G.timeLeft <= 0) finish(G, G.cfg.target ? G.score >= G.cfg.target : true); }
    if (G.civHit && !G.over) finish(G, false);
    G.battery = Math.max(0, G.battery - dt * (G.cfg.mode === 'race' ? 0.004 : 0.006));
  }
  updateFx(G, dt);
  // weather drift
  if (G.weather) {
    const a = G.weather.pts.geometry.attributes.position, cam = G.quad.p;
    for (let i = 0; i < G.weather.n; i++) {
      a.array[i * 3 + 1] -= G.weather.fall * dt;
      if (a.array[i * 3 + 1] < -2) a.array[i * 3 + 1] = 200;
      a.array[i * 3] = ((a.array[i * 3] - cam.x + 300) % 600 + 600) % 600 - 300 + cam.x;
      a.array[i * 3 + 2] = ((a.array[i * 3 + 2] - cam.z + 300) % 600 + 600) % 600 - 300 + cam.z;
    }
    a.needsUpdate = true;
  }
  // gap markers spin
  if (G.gaps) for (const gp of G.gaps) if (gp.marker) gp.marker.rotation.z += dt;
  // shadow sun follows the quad so the shadow map stays tight; water ripples drift
  if (G.shadows) { G.sun.position.copy(G.quad.p).addScaledVector(G.sunDir, 600); G.sun.target.position.copy(G.quad.p); G.sun.target.updateMatrixWorld(); }
  if (G.water && G.water.material.bumpMap) { G.water.material.bumpMap.offset.y += dt * 0.05; G.water.material.bumpMap.offset.x += dt * 0.012; }
  // camera follow (FPV, from the quad with a slight up-tilt)
  const Q = G.quad;
  G.camera.position.copy(Q.p);
  const camQ = Q.q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(QX, 18 * DEG));
  G.camera.quaternion.copy(camQ);
  if (G.shake > 0) { G.camera.position.x += rr(-G.shake, G.shake); G.camera.position.y += rr(-G.shake, G.shake); G.shake = Math.max(0, G.shake - dt * 4); }
  // motor sound
  const diff = { p: G.input.pitch, r: G.input.roll };
  if (Q.alive) G.motors.update(Q.throttle, diff, G.cam.spd, dt);
  G.staticBurst = Math.max(0, G.staticBurst - dt * 1.4);

  // adaptive resolution
  const t0 = performance.now();
  G.renderer.render(G.scene, G.camera);
  const ms = performance.now() - t0;
  G.frameMs = (G.frameMs || ms) * 0.9 + ms * 0.1;
  if (G.t - (G.lastAdapt || 0) > 2) {
    G.lastAdapt = G.t;
    // first drop resolution; if still heavy and shadows are on, turn them off as a last resort
    if (G.frameMs > 22 && G.renderScale > 0.6) { G.renderScale -= 0.15; layout(G); }
    else if (G.frameMs > 26 && G.shadows) { G.shadows = false; G.renderer.shadowMap.enabled = false; G.sun.castShadow = false; }
    else if (G.frameMs < 9 && G.renderScale < 1) { G.renderScale = Math.min(1, G.renderScale + 0.15); layout(G); }
  }
  drawHud(G);
  G.raf = requestAnimationFrame(loop);
}

function finish(G, win) {
  if (G.over) return;
  G.over = { win };
  G.motors && G.motors.crash();
  const end = document.getElementById('fpvEnd');
  const title = document.getElementById('fpvETitle'), body = document.getElementById('fpvEBody');
  let lines = '';
  const best = storeBest(G, win);
  if (G.cfg.mode === 'stunt') {
    lines = `<div class="kv"><span>SCORE</span><span>${G.score}</span><span>TRICKS</span><span>${G.tricks}</span>` +
      (G.cfg.target ? `<span>TARGET</span><span>${G.cfg.target}</span>` : '') + `<span>BEST</span><span>${best}</span></div>`;
  } else if (G.cfg.mode === 'race') {
    lines = `<div class="kv"><span>TIME</span><span>${G.raceClock.toFixed(2)}s</span><span>GATES</span><span>${G.gateIdx}/${G.gates.length}</span><span>BEST</span><span>${best}</span></div>`;
  } else {
    lines = `<div class="kv"><span>TARGETS</span><span>${G.killed}/${G.targetsTotal}</span><span>SCORE</span><span>${G.score}</span>` +
      (G.cfg.mode === 'strike' ? `<span>DRONES LEFT</span><span>${G.dronesLeft}</span>` : `<span>BOMBS LEFT</span><span>${G.bombsLeft}</span>`) + `</div>`;
  }
  if (win) {
    title.textContent = 'VICTORY';
    body.innerHTML = `<p>Victory. Good effect on target — recover and rearm.</p>${lines}`;
  } else {
    title.textContent = G.civHit ? 'SORTIE ABORTED' : 'SORTIE OVER';
    body.innerHTML = `<p>${G.civHit ? 'Civilian casualties. The sortie is aborted.' : 'Out of drones.'}</p>${lines}`;
  }
  const next = nextSortie(G.cfg);
  const nb = document.getElementById('fpvENext'); nb.classList.toggle('hidden', !next);
  nb.onclick = () => { end.classList.add('hidden'); dispose(); start(next); };
  document.getElementById('fpvERetry').onclick = () => { end.classList.add('hidden'); const c = G.cfg; dispose(); start(c); };
  document.getElementById('fpvEMenu').onclick = () => { end.classList.add('hidden'); exit(); };
  document.getElementById('fpvTouch').classList.remove('on');
  end.classList.remove('hidden');
}
function storeBest(G, win) {
  const key = 'steppehawk.fpv.' + G.cfg.id;
  const prev = store(key);
  if (G.cfg.mode === 'race') {
    const t = G.raceClock; if (win && (!prev || t < prev)) { setStore(key, t); return t.toFixed(2) + 's'; }
    return prev ? prev.toFixed(2) + 's' : '—';
  }
  const s = G.score; if (!prev || s > prev) { setStore(key, s); return s; }
  return prev;
}
function store(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function setStore(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function nextSortie(cfg) { const same = SORTIES.filter(s => s.tab === cfg.tab); const i = same.indexOf(cfg); return i >= 0 && i < same.length - 1 ? same[i + 1] : null; }

function dispose() {
  const G = S; if (!G) return;
  cancelAnimationFrame(G.raf);
  window.removeEventListener('resize', G.onResize);
  G.motors && G.motors.stop();
  // free GPU resources
  G.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { const m = o.material; (Array.isArray(m) ? m : [m]).forEach(x => { if (x.map) x.map.dispose(); x.dispose(); }); } });
  G.renderer.dispose();
  S = null;
  window.SteppeHawkFPV.active = false;
}
function exit() {
  dispose();
  document.getElementById('fpvWrap').classList.remove('on');
  document.getElementById('fpvTouch').classList.remove('on');
  document.getElementById('fpvEnd').classList.add('hidden');
  API.resume();
}

// ============================================================ menu cards
function buildMenus() {
  ensureDom();
  for (const tab of ['stunt', 'strike']) {
    const list = document.getElementById(tab === 'stunt' ? 'stuntList' : 'strikeList');
    if (!list) continue;
    list.innerHTML = '';
    for (const s of SORTIES.filter(s => s.tab === tab)) {
      const b = document.createElement('button'); b.className = 'mcard';
      const best = store('steppehawk.fpv.' + s.id);
      const bestTxt = best != null ? (s.mode === 'race' ? 'BEST ' + Number(best).toFixed(2) + 's' : 'BEST ' + best) : '';
      b.innerHTML = `<span class="mn">${s.name}</span><span class="ms">${s.sub}</span><span class="mt">${s.tod} · ${modeLabel(s.mode)}</span>` + (bestTxt ? `<span class="mg">${bestTxt}</span>` : '');
      b.onclick = () => { API.Snd.init(); openBrief(s); };
      list.appendChild(b);
    }
  }
}
function modeLabel(m) { return { stunt: 'FREESTYLE', race: 'RACE', strike: 'FPV STRIKE', bomb: 'FPV BOMBER' }[m] || m; }
function openBrief(s) {
  ensureDom();
  const bt = document.getElementById('fpvBTitle'), bb = document.getElementById('fpvBBody'),
    brief = document.getElementById('fpvBrief'), menu = document.getElementById('menu');
  bt.textContent = s.name;
  bb.innerHTML = `<div class="kv"><span>MODE</span><span>${modeLabel(s.mode)}</span><span>CONDITIONS</span><span>${s.tod}</span>` +
    (s.drones ? `<span>DRONES</span><span>${s.drones}</span>` : '') + (s.bombs ? `<span>BOMBS</span><span>${s.bombs}</span>` : '') +
    (s.target ? `<span>TARGET SCORE</span><span>${s.target}</span>` : '') + `</div><h4>BRIEFING</h4><p>${s.brief}</p>`;
  menu.classList.add('hidden'); brief.classList.remove('hidden');
  document.getElementById('fpvBStart').onclick = () => { API.Snd.init(); brief.classList.add('hidden'); start(s); };
  document.getElementById('fpvBBack').onclick = () => { brief.classList.add('hidden'); menu.classList.remove('hidden'); };
}

window.SteppeHawkFPV = {
  active: false,
  start,
  sorties: SORTIES,
  get session() { return S; },
  onBack() {
    if (S && S.over) { exit(); return true; }
    if (S) { exit(); return true; }
    return false;
  },
};

// keyboard
window.addEventListener('keydown', e => {
  if (!window.SteppeHawkFPV.active) return;
  const k = e.key.toLowerCase(); keys[k] = true;
  if (k === ' ') { if (S) actionPrimary(S); e.preventDefault(); }
  else if (k === 'm') { if (S) toggleMode(S); }
  else if (k === 'r') { if (S && S.quad) respawn(S); }
  else if (k === 'escape') { exit(); }
  if (k.startsWith('arrow')) e.preventDefault();
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

// build the FPV menu cards once the DOM is ready
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildMenus); else buildMenus();
})();
