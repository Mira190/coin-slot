// Menus (title, race setup with mode/track/kart/paint, pause, controls, results) and the 3D garage/podium scene.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { KARTS, PAINTS, MODES, statBars } from './data.js';
import { TRACKS } from './tracks.js';
import { buildKartModel, disposeModel } from './kart.js';
import { fmt, bestRace, bestLap } from './store.js';
import { CAMS } from './camera.js';
import { textTex, FONT_EN, FONT_ZH, softTex } from './gfx.js';
import { GLOW, BLOOM_T } from './themes.js';

// showroom look: studio key/fill/rim lighting against the same light budget as the tracks
export const GARAGE_LOOK = { exposure: 1.0, bloom: [0.3, 0.3, BLOOM_T] };

const $ = (id) => document.getElementById(id);

// ---- garage / podium scene -------------------------------------------------------------------------
export class Garage {
  constructor(R3) {
    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(0x070b24);
    s.environment = R3.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    s.environmentIntensity = 0.32;
    s.fog = new THREE.Fog(0x070b24, 30, 80);
    this.cam = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.1, 200);
    // floor: glossy disc with neon rings
    const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshPhysicalMaterial({ color: 0x0b1030, roughness: 0.38, metalness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.32 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; s.add(floor);
    const ringMat = (c) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(GLOW.neon * 0.85) });
    const r1 = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.05, 8, 96), ringMat(0x19d3ff)); r1.rotation.x = Math.PI / 2; r1.position.y = 0.03; s.add(r1);
    const r2 = new THREE.Mesh(new THREE.TorusGeometry(4.6, 0.025, 8, 96), ringMat(0xff3d8b)); r2.rotation.x = Math.PI / 2; r2.position.y = 0.03; s.add(r2);
    this.turn = new THREE.Group(); s.add(this.turn);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(3.9, 4, 0.18, 64), new THREE.MeshStandardMaterial({ color: 0x1a2250, metalness: 0.7, roughness: 0.3 }));
    plate.position.y = 0.09; plate.receiveShadow = true; this.turn.add(plate);
    // backdrop panels with light strips
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * (0.15 + i * 0.09) + Math.PI;
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.25, 7 + (i % 3), 0.25), ringMat(i % 2 ? 0x19d3ff : 0x9b5cff));
      p.position.set(Math.cos(a) * 16, 3.6, Math.sin(a) * 16); s.add(p);
    }
    // key: a soft warm spot from front-right; fill: cool sky bounce; rims: the neon colours from behind
    const key = new THREE.SpotLight(0xfff1e0, 24, 40, 0.55, 0.9, 1.4);
    key.position.set(6, 11, 8); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.radius = 4; key.shadow.bias = -0.0005; s.add(key);
    const fill = new THREE.DirectionalLight(0xbcd0ff, 0.35); fill.position.set(-8, 5, 6); s.add(fill);
    const rim1 = new THREE.PointLight(0x19d3ff, 4, 18); rim1.position.set(-6, 5.5, -6); s.add(rim1);
    const rim2 = new THREE.PointLight(0xff3d8b, 4, 18); rim2.position.set(6, 5, -7); s.add(rim2);
    s.add(new THREE.HemisphereLight(0x8fb0ff, 0x101030, 0.22));
    this.model = null; this.podium = null; this.t = 0; this.drag = 0; this.spin = 0; this.mode = 'show';
    // drag to spin
    const cv = $('c');
    let down = false, lx = 0;
    cv.addEventListener('pointerdown', (e) => { down = true; lx = e.clientX; });
    addEventListener('pointerup', () => { down = false; });
    addEventListener('pointermove', (e) => { if (down && this.mode === 'show') { this.spin += (e.clientX - lx) * 0.01; lx = e.clientX; this.drag = 2; } });
  }
  showKart(kartIdx, paint) {
    if (this.model) { this.turn.remove(this.model.root); disposeModel(this.model.root); }
    this.clearPodium();
    this.model = buildKartModel(kartIdx, paint, { night: true });
    this.model.root.scale.setScalar(1.35);
    this.model.root.position.y = 0.18;
    this.turn.add(this.model.root);
    this.mode = 'show';
  }
  clearPodium() { if (this.podium) { this.scene.remove(this.podium); disposeModel(this.podium); this.podium = null; } }
  showPodium(entries) {
    if (this.model) { this.turn.remove(this.model.root); disposeModel(this.model.root); this.model = null; }
    this.clearPodium();
    const g = this.podium = new THREE.Group();
    const cols = [0xffd21f, 0xc8d4e8, 0xd88a4a];
    const pos = [[0, 2.4], [-3.6, 1.6], [3.6, 1.1]];
    entries.slice(0, 3).forEach((e, i) => {
      const [x, h] = pos[i];
      const block = new THREE.Mesh(new THREE.BoxGeometry(3.3, h, 3), new THREE.MeshStandardMaterial({ color: 0x1a2250, metalness: 0.5, roughness: 0.35 }));
      block.position.set(x, h / 2, 0); block.castShadow = block.receiveShadow = true; g.add(block);
      const top = new THREE.Mesh(new THREE.BoxGeometry(3.34, 0.12, 3.04), new THREE.MeshBasicMaterial({ color: new THREE.Color(cols[i]).multiplyScalar(GLOW.sign) }));
      top.position.set(x, h, 0); g.add(top);
      const num = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2), new THREE.MeshBasicMaterial({ map: textTex([{ text: String(i + 1), font: `italic 110px ${FONT_EN}`, color: '#' + new THREE.Color(cols[i]).getHexString(), y: 70 }], { w: 160, h: 128 }), transparent: true }));
      num.position.set(x, h / 2, 1.52); g.add(num);
      const m = buildKartModel(e.k.kartIdx, e.k.paint, { night: true });
      m.root.position.set(x, h, 0); m.root.rotation.y = -0.4 + i * 0.3; g.add(m.root);
    });
    this.scene.add(g);
    this.mode = 'podium';
  }
  update(dt, wide) {
    this.t += dt;
    const cam = this.cam;
    if (this.mode === 'show') {
      if (this.drag > 0) this.drag -= dt; else this.spin += dt * 0.35;
      this.turn.rotation.y = this.spin;
      const off = wide ? -2.6 : 0;
      cam.position.set(12.5 * Math.sin(0.55) + off * 0.3, 4.2, 12.5 * Math.cos(0.55));
      cam.lookAt(off, 0.9, 0);
      cam.fov = wide ? 34 : 44;
    } else {
      const a = Math.sin(this.t * 0.3) * 0.3, wideR = innerWidth > 900;
      const cx = wideR ? 3.2 : 0;
      cam.position.set(cx + Math.sin(a) * 14, 5.4, Math.cos(a) * 14);
      cam.lookAt(cx, 2.2, 0);
      cam.fov = 42;
    }
    cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
  }
}

// ---- track thumbnails --------------------------------------------------------------------------------
export function drawThumb(cv, T, theme) {
  const c = cv.getContext('2d'), W = cv.width, H = cv.height;
  const bg = { city: ['#1a1240', '#3a1a5a'], coast: ['#1d6fb0', '#8fd0f0'], snow: ['#16305f', '#6f9ad0'], desert: ['#b8723a', '#f2c880'] }[theme];
  const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, bg[0]); g.addColorStop(1, bg[1]); c.fillStyle = g; c.fillRect(0, 0, W, H);
  const b = T.bounds, pad = 18, sc = Math.min((W - pad * 2) / (b.x1 - b.x0), (H - pad * 2 - 18) / (b.z1 - b.z0));
  const ox = (W - (b.x1 - b.x0) * sc) / 2, oz = (H - 18 - (b.z1 - b.z0) * sc) / 2;
  c.lineJoin = 'round';
  T.paths.forEach((P, pi) => {
    c.beginPath();
    for (let i = 0; i < P.n; i += 2) { const x = ox + (P.x[i] - b.x0) * sc, z = oz + (P.z[i] - b.z0) * sc; i ? c.lineTo(x, z) : c.moveTo(x, z); }
    if (P.closed) c.closePath();
    c.lineWidth = pi ? 5 : 9; c.strokeStyle = 'rgba(0,0,20,.55)'; c.stroke();
    c.lineWidth = pi ? 2.5 : 5; c.strokeStyle = pi ? '#ffd21f' : '#fff'; if (pi) c.setLineDash([4, 4]); c.stroke(); c.setLineDash([]);
  });
  const M = T.main; c.fillStyle = '#ff3d8b'; c.beginPath(); c.arc(ox + (M.x[0] - b.x0) * sc, oz + (M.z[0] - b.z0) * sc, 5, 0, 7); c.fill();
}

// ---- menus -----------------------------------------------------------------------------------------
export class Menus {
  constructor(game) {
    this.g = game;
    const sel = game.sel;
    // modes
    $('modes').innerHTML = Object.entries(MODES).map(([k, m]) => `<button data-m="${k}" aria-pressed="false">${m.zh}<small>${m.en.toUpperCase()}</small></button>`).join('');
    $('modes').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; sel.mode = b.dataset.m; this.sync(); game.sfx('ui'); };
    // difficulty (rival skill + rubber-band)
    const DIFF = [['easy', '轻松', 'EASY'], ['normal', '普通', 'NORMAL'], ['hard', '高手', 'EXPERT']];
    $('diffs').innerHTML = DIFF.map(([k, zh, en]) => `<button data-d="${k}" aria-pressed="false">${zh}<small>${en}</small></button>`).join('');
    $('diffs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; sel.diff = b.dataset.d; this.sync(); game.sfx('ui'); };
    // tracks
    $('tracks').innerHTML = TRACKS.map((t, i) => `<button class="tcard" data-t="${i}" aria-pressed="false"><canvas width="240" height="180"></canvas><div class="tn">${t.zh}<small>${t.en.toUpperCase()}</small></div><div class="tb"></div></button>`).join('');
    [...$('tracks').children].forEach((b, i) => drawThumb(b.querySelector('canvas'), game.trackGeo(i), TRACKS[i].theme));
    $('tracks').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; sel.track = +b.dataset.t; this.sync(); game.sfx('ui'); };
    // karts
    $('karts').innerHTML = KARTS.map((k, i) => `<button data-k="${i}" aria-pressed="false">${k.zh}<small>${k.en.toUpperCase()}</small></button>`).join('');
    $('karts').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; sel.kart = +b.dataset.k; this.sync(); game.showKart(); game.sfx('ui'); };
    $('paints').innerHTML = PAINTS.map((p, i) => `<button data-p="${i}" aria-label="${p.zh} ${p.en}" aria-pressed="false" style="background:${p.c}"></button>`).join('');
    $('paints').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; sel.paint = +b.dataset.p; this.sync(); game.showKart(); game.sfx('ui', { f: 1500 }); };
    $('bPlay').onclick = () => game.toSetup();
    $('bHelp').onclick = () => this.help(true);
    $('hClose').onclick = () => this.help(false);
    $('bBack').onclick = () => game.toTitle();
    $('bGo').onclick = () => game.startRace();
    $('pResume').onclick = () => game.pause(false);
    $('pRestart').onclick = () => game.restart();
    $('pHelp').onclick = () => this.help(true);
    $('pQuit').onclick = () => game.quit();
    $('rAgain').onclick = () => game.restart();
    $('rNext').onclick = () => { sel.track = (sel.track + 1) % TRACKS.length; game.startRace(); };
    $('rMenu').onclick = () => game.quit();
    if (location.pathname.includes('/games/')) $('allGames').hidden = false;
    this.sync();
  }
  help(on) { $('help').hidden = !on; if (on) { const p = $('help').querySelector('.panel'); p.scrollTop = 0; p.tabIndex = -1; p.focus({ preventScroll: true }); } }
  sync() {
    const s = this.g.sel;
    for (const b of $('modes').children) b.setAttribute('aria-pressed', b.dataset.m === s.mode);
    for (const b of $('diffs').children) b.setAttribute('aria-pressed', b.dataset.d === (s.diff || 'normal'));
    $('mdesc').innerHTML = `${MODES[s.mode].desc}<br><span style="opacity:.8">${MODES[s.mode].descEn}</span>`;
    [...$('tracks').children].forEach((b, i) => {
      b.setAttribute('aria-pressed', i === s.track);
      const br = bestRace(TRACKS[i].id, s.mode);
      b.querySelector('.tb').textContent = br ? '★ ' + fmt(br) : '';
    });
    const t = TRACKS[s.track];
    const bl = bestLap(t.id), br = bestRace(t.id, s.mode);
    $('tinfo').innerHTML = `<b style="font-family:var(--zh);font-size:20px">${t.zh}</b> ${t.en} · ${t.laps} 圈 LAPS<br>${t.blurb}<br><span style="opacity:.75">${t.blurbEn}</span><br>
      最佳成绩 BEST (${MODES[s.mode].zh}) <b>${fmt(br)}</b> · 最佳圈 BEST LAP <b>${fmt(bl)}</b>`;
    for (const b of $('karts').children) b.setAttribute('aria-pressed', +b.dataset.k === s.kart);
    const k = KARTS[s.kart];
    $('kname').innerHTML = `${k.zh}<small>${k.en.toUpperCase()}</small>`;
    $('ktag').textContent = k.tag;
    $('kstats').innerHTML = statBars(k).map(([zh, en, v]) => `<div class="stat"><span>${zh} <small>${en.toUpperCase()}</small></span><div class="bar"><i style="width:${(v * 100).toFixed(0)}%"></i></div></div>`).join('');
    for (const b of $('paints').children) b.setAttribute('aria-pressed', +b.dataset.p === s.paint);
    $('pname').textContent = `${PAINTS[s.paint].zh} · ${PAINTS[s.paint].en}`;
    const best = TRACKS.map((tr) => bestRace(tr.id, 'speed')).filter(Boolean);
    $('titleFoot').innerHTML = `四条赛道 · 八辆赛车 · 三种模式 &nbsp;|&nbsp; 4 circuits · 8 karts · 3 modes${best.length ? ` &nbsp;|&nbsp; 已破纪录 ${best.length} 条赛道` : ''}`;
    this.g.saveSel();
  }
  pauseOpts() {
    const g = this.g;
    $('optCam').innerHTML = CAMS.map((c, i) => `<button data-i="${i}" aria-pressed="${g.rig.mode === i}">${c.zh} ${c.en}</button>`).join('');
    $('optCam').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; g.setCam(+b.dataset.i); this.pauseOpts(); };
    const Q = [['auto', '自动 Auto'], [0, '低 Low'], [1, '中 Medium'], [2, '高 High'], [3, '极高 Ultra']];
    $('optQ').innerHTML = Q.map(([v, l]) => `<button data-v="${v}" aria-pressed="${g.R3.auto ? v === 'auto' : v === g.R3.level}">${l}</button>`).join('');
    $('optQ').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; g.setQuality(b.dataset.v); this.pauseOpts(); };
    $('optS').innerHTML = `<button data-v="0" aria-pressed="${!g.audio.muted}">开 On</button><button data-v="1" aria-pressed="${g.audio.muted}">静音 Muted</button>`;
    $('optS').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; g.setMute(b.dataset.v === '1'); this.pauseOpts(); };
  }
}
