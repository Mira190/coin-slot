// Entry point: builds the island, the pelican on its bicycle and all systems, then runs the loop.
// ?studio opens the model turntable instead. window.__debug exposes a deterministic step() for tests.
import { THREE, renderer, scene, camera, $, bus, clamp, smooth, V3, reduceMotion, isTouch, noReflect } from './core.js';
import { Pelican } from './pelican.js';
import { Bike, G } from './bike.js';
import { Scarf } from './cloth.js';
import { World } from './world.js';
import { SkySystem } from './sky.js';
import { Ocean } from './ocean.js';
import { Gulls } from './gulls.js';
import { FX } from './fx.js';
import { Rider } from './rider.js';
import { Game } from './game.js';
import { Director, MODES } from './director.js';
import { Post } from './post.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { LOOP_LEN } from './layout.js';

const Q = new URLSearchParams(location.search);
if (Q.has('studio')) { document.querySelectorAll('body > :not(canvas):not(script)').forEach((e) => { e.hidden = true; }); import('./studio.js').then((m) => m.studio()); }
else boot().catch((e) => { console.error(e); const el = $('#err'); if (el) { el.hidden = false; el.textContent = 'Something went wrong while building the island: ' + e.message; } });

async function boot() {
  const tick = () => new Promise((r) => setTimeout(r, 30));
  const veil = (m, p) => { $('#veil-msg').textContent = m; $('#veil-fill').style.width = Math.round(p * 100) + '%'; };
  veil('Sculpting feathers…', 0.08); await tick();
  const pel = new Pelican();
  const bike = new Bike(); scene.add(bike.group);
  pel.root.position.copy(G.saddle); bike.frame.add(pel.root);
  const scarf = new Scarf(pel); scarf.addTo(scene);
  // the rider is far from the waterline: keep it out of the (expensive) planar reflection
  noReflect(bike.group); scarf.tails.forEach((T) => noReflect(T.m));
  veil('Raising the island…', 0.25); await tick();
  const world = new World();
  veil('Painting the sky…', 0.55); await tick();
  const startQ = Q.has('q') ? +Q.get('q') : isTouch ? 1 : 2;
  const sky = new SkySystem(startQ);
  const ocean = new Ocean(world, startQ);
  veil('Calling the gulls…', 0.8); await tick();
  const gulls = new Gulls(26);
  const fx = new FX(pel.M.card);
  const rider = new Rider(bike, pel, scarf);
  const director = new Director((x, z) => world.heightAt(x, z));
  const game = new Game(rider, pel, fx, sky, director);
  const post = new Post();
  post.noAO.push(sky.sky, sky.clouds, sky.moon, sky.halo, ocean.water, world.beams, ...world.noAO, fx.feathers);
  const audio = new Audio();
  const input = new Input(renderer.domElement);

  // ------------------------------------------------------------------ app state & actions
  const app = {
    mode: 'attract', photoMode: false, paused: false, userPaused: false, hold: false,
    quality: Q.has('q') ? String(startQ) : 'auto', dayLen: 12, filter: 0,
    photoFocus: null, photoAperture: 0.06, photoExposure: 1, game, audio,
    startRide() {
      audio.unlock(); audio.ui(); ui.modal('#summary', false);
      game.start(); app.mode = 'play'; setBody();
      // start on a shot you can steer by
      if (director.mode === 'director' && ['crane', 'pouch', 'feet', 'low', 'tele'].includes(director.shot)) director.cut('hero');
      director.interactive = 4;
    },
    watch() { audio.unlock(); app.mode = 'attract'; document.body.classList.add('watch'); setBody(); },
    endRide() { app.pause(false); if (app.mode === 'play') { game.stop(); ui.summary(game); } app.mode = 'attract'; document.body.classList.remove('watch'); setBody(); ui.refreshMeta(); },
    photo(on) {
      if (on === app.photoMode) return;
      audio.unlock(); app.photoMode = on;
      if (on) { app.prevCam = director.mode; director.setMode('photo'); } else director.setMode(app.prevCam || 'director');
      ui.photoPanel(on); $('#t-photo').setAttribute('aria-pressed', String(on));
      if (on) { ui.P.time.value = Math.round(sky.hour * 60); ui.P.time.oninput(); }
      else { sky.exposureBias = 1; post.grade.uniforms.uFilter.value = 0; document.querySelectorAll('.fchip').forEach((x, i) => x.setAttribute('aria-pressed', String(i === 0))); }
      setBody();
    },
    nextCamera() { if (app.photoMode) return; const i = MODES.indexOf(director.mode); app.setCamera(MODES[(i + 1) % MODES.length]); },
    setCamera(m) { director.prevMode = m; director.setMode(m); ui.setCamLabel(m); if (app.mode === 'play' || document.body.classList.contains('watch')) ui.toast(({ director: 'Director', chase: 'Chase cam', side: 'Side cam', orbit: 'Orbit (drag)', pov: 'Pelican POV' })[m], '', 900); },
    toggleMute() { audio.unlock(); audio.setMuted(!audio.muted); ui.syncSound(); },
    pause(on, user) {
      if (on === app.paused && !(on && user)) return;
      app.paused = on; app.userPaused = on && !!user; audio.pause(on);
      ui.modal('#pause', on && (!!user || app.mode === 'play'));
    },
    setQuality(v) { app.quality = v; post.auto = v === 'auto'; if (v !== 'auto') post.setLevel(+v); },
    setDayLength(m) { app.dayLen = m; },
    setHour(h) { sky.set(h); },
    setFilter(f) { app.filter = f; post.grade.uniforms.uFilter.value = f; },
    screenshot() {
      post.frame(t);
      renderer.domElement.toBlob((b) => {
        if (!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b);
        a.download = 'pelican-pedal-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }, 'image/png');
      audio.shutter(); const f = $('#flash'); f.classList.add('on'); requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on')));
      game.unlock('photo');
    },
  };
  director.prevMode = 'director';
  const setBody = () => {
    const b = document.body.classList;
    b.toggle('playing', app.mode === 'play' && !app.photoMode); b.toggle('photo', app.photoMode);
    if (app.mode === 'play') b.remove('watch');
  };
  const ui = new UI(app);
  // quality levels also scale the cloud march, shadow maps and the pouch's transmission
  post.onLevel = (L) => { sky.setQuality(L); pel.M.pouch.transmission = L >= 2 ? 0.38 : 0; pel.M.pouch.opacity = 1; };
  post.setLevel(startQ); post.auto = app.quality === 'auto';

  // ------------------------------------------------------------------ input hotkeys
  input.onKey = (code, e) => {
    audio.unlock();
    if (code === 'KeyC') app.nextCamera();
    else if (/^Digit[1-5]$/.test(code) && !app.photoMode) app.setCamera(MODES[+code.slice(5) - 1]);
    else if (code === 'KeyP') app.photo(!app.photoMode);
    else if (code === 'KeyM') app.toggleMute();
    else if (code === 'KeyH') { if (app.photoMode) ui.photoPanel($('#photo').hidden); else document.body.classList.toggle('hide-hud'); }
    else if (code === 'Escape') {
      if (!$('#ach-modal').hidden) ui.showAch(false);
      else if (app.photoMode) app.photo(false);
      else if (app.mode === 'play') app.pause(!app.paused, true);
      else if (document.body.classList.contains('watch')) { document.body.classList.remove('watch'); }
    } else if ((code === 'Enter' || code === 'Space') && app.mode === 'attract' && !app.photoMode && $('#summary').hidden && !document.body.classList.contains('watch')) { e.preventDefault(); app.startRide(); }
  };
  input.onTouch = () => audio.unlock();
  addEventListener('pointerdown', () => audio.unlock(), { once: false, passive: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) app.pause(true); else if (!app.userPaused) app.pause(false); });
  addEventListener('blur', () => { if (app.mode === 'play') app.pause(true, true); });

  // ------------------------------------------------------------------ events -> audio / fx / director
  const panOf = (p) => { const d = new V3().subVectors(p, camera.position); const r = new V3().setFromMatrixColumn(camera.matrixWorld, 0); return clamp(d.normalize().dot(r), -1, 1); };
  bus.on('catch', (e) => audio.pickup(e.n, e.golden));
  bus.on('line', (e) => { if (e.perfect) audio.catchChime(e.golden, e.n); setTimeout(() => audio.gulp(), 370); });
  bus.on('bell', () => { audio.bell(); game.bell(); bellT = 0.35; });
  bus.on('hop', () => audio.hop());
  bus.on('land', () => audio.land());
  bus.on('crab-hit', (p) => { audio.bonk(); setTimeout(() => audio.grunt(), 120); });
  bus.on('crab-hop', () => audio.whoosh());
  bus.on('bonk', () => audio.bonk());
  bus.on('fish-leap', (p) => audio.splash(panOf(p), 0.12 * clamp(1 - p.distanceTo(camera.position) / 60, 0, 1)));
  let bellT = 0;

  // ------------------------------------------------------------------ start pose
  rider.s = LOOP_LEN * 0.075; rider.lat = -1.0; rider.v = 7.2;
  sky.set(Q.has('h') ? +Q.get('h') : 18.25);
  const NONE = { pedal: 0, brake: 0, steer: 0, hop: false, trick: false, scoop: false, any: false };
  rider.update(1 / 60, NONE, 0);
  gulls.place(rider.R.pos);
  director.restart();

  // ------------------------------------------------------------------ simulation
  let t = 0;
  function simulate(dt) {
    dt = Math.max(dt, 1 / 240); // a zero-length frame would divide by zero in the cloth and springs
    t += dt;
    const inp = input.read();
    const photo = app.photoMode;
    if (!photo) {
      if (app.dayLen > 0) sky.advance(dt, app.dayLen);
      const play = app.mode === 'play';
      const pin = play ? inp : NONE;
      if (play && inp.bell) rider.ring();
      const ai = game.update(dt, t, pin);
      if (play && inp.any) director.interactive = 2.5;
      // the pelican looks into the lens during the pouch close-up (unless a fish is incoming)
      // birds eye the lens sideways: a little head turn, mostly the near eye
      if (director.lookAtCam > 0 && rider.lookW < 0.2) { rider.look = camera.position; rider.lookW = director.lookAtCam * 0.35; rider.eyeLook = camera.position; }
      rider.lights = smooth(2.5, -1.5, sky.el);
      rider.update(dt, ai || pin, t);
      gulls.update(dt, t, rider.R.pos, rider.R.fwd, (x, z) => world.heightAt(x, z), camera.position);
      for (const c of gulls.cries) audio.gull(panOf(c.p), c.d);
      fx.update(dt, t);
      if (bellT > 0) { bellT -= dt; bike.striker.rotation.y = Math.sin(bellT * 60) * 0.5 * bellT; }
    }
    // camera-style auto exposure: stop down when looking into a low sun (bloom threshold follows)
    const vd = camera.getWorldDirection(new V3()), sunK = smooth(0.35, 0.95, vd.dot(sky.sunDir)) * smooth(-3, 3, sky.el) * smooth(35, 5, sky.el);
    app.autoExp = (app.autoExp ?? 1) + ((1 - 0.58 * sunK) - (app.autoExp ?? 1)) * (1 - Math.exp(-3 * dt));
    sky.exposureBias = (photo ? app.photoExposure : 1) * app.autoExp;
    sky.update(dt, t, camera);
    // bloom only above a fixed display brightness, whatever the exposure, and no single hot pixel (a glint, a
    // lamp) feeds it more than a fixed display brightness either
    post.bloom.threshold = 1.5 / renderer.toneMappingExposure;
    post.bloom.materialHighPassFilter.uniforms.uMaxBloom.value = 4 / renderer.toneMappingExposure;
    post.grade.uniforms.uWarm.value = smooth(-2.5, 2, sky.el) * smooth(16, 7, sky.el) * 0.8;
    const lamps = smooth(1, -3, sky.el); // street lights come on through civil twilight, once it's actually dim
    world.update(dt, t, lamps, rider.R.pos, 1 + Math.sin(t * 0.3) * 0.3);
    ocean.update(t, sky);
    sky.sun.shadow.camera.far = director.mode === 'director' && (director.shot === 'aerial' || director.shot === 'crane' || director.shot === 'tele') ? 160 : 55;
    director.frameBias = app.mode === 'attract' && !app.photoMode && !document.body.classList.contains('watch') && innerWidth > 700 ? 1 : 0;
    director.update(dt, rider.R, pel, sky, { drag: inp.drag, wheel: inp.wheel, move: inp.move, fast: inp.fast });
    for (const e of pel.eyes) e.g.visible = director.mode !== 'pov'; // the POV camera sits between the eyes
    if (photo) {
      post.focus = app.photoFocus ?? camera.position.distanceTo(rider.R.pos.clone().setY(rider.R.pos.y + 1.05));
      post.aperture = app.photoAperture;
    } else { post.focus = director.focus; post.aperture = director.aperture; }
    const seaNear = ({ beach: 1, boardwalk: 1, south: 0.9, town: 0.7, pines: 0.55, climb: 0.45, lighthouse: 0.6, cliffs: 0.5 })[rider.R.zone] ?? 0.6;
    audio.update(dt, { speed: rider.v, pedaling: rider.pedaling, crank: bike.crank, coastRev: rider.v / (2 * Math.PI * G.R), zone: rider.R.zone, seaNear, night: sky.night, golden: sky.isGolden() ? 1 : 0 });
    ui.update(dt, { speed: rider.v, combo: game.combo, fish: game.fishRide, hour: sky.hour, el: sky.el, shot: director.label, letterbox: director.letterbox && app.mode !== 'play' });
  }
  renderer.info.autoReset = false;
  function render() { renderer.info.reset(); post.frame(t); }

  // ------------------------------------------------------------------ warm-up and loop
  veil('Tuning the bell…', 0.95); await tick();
  simulate(1 / 60);
  renderer.compile(scene, camera);
  render();
  ui.veilDone();
  let last = performance.now(), smoothMs = 16;
  function loop(now) {
    requestAnimationFrame(loop);
    const raw = Math.max(0, now - last); last = now;
    if (app.hold) return;
    smoothMs = smoothMs * 0.92 + raw * 0.08;
    if (!app.paused) simulate(Math.min(raw / 1000, 0.05));
    render();
    if (!app.paused && !document.hidden) post.adapt(raw, now);
  }
  requestAnimationFrame(loop);

  // ------------------------------------------------------------------ test hook
  window.__debug = {
    app, pel, bike, rider, game, director, sky, world, post, ocean, gulls, scarf, fx, audio,
    hold(on = true) { app.hold = on; post.auto = !on && app.quality === 'auto'; },
    step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) simulate(dt); render(); },
    run(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) simulate(dt); },
    render,
    setHour(h) { sky.set(h); sky.bakedEl = -999; sky.exposure = 0; },
    cam(m) { app.setCamera(m); }, shot(s) { director.setMode('director'); director.cut(s); },
    quality(L) { post.auto = false; post.setLevel(L); },
    start() { app.startRide(); }, photo(on) { app.photo(on); },
    state() {
      const R = rider.R, info = renderer.info;
      return { mode: app.mode, score: game.score, combo: game.combo, fish: game.fishRide, s: rider.s, lat: rider.lat, v: rider.v, zone: R.zone, hour: sky.hour, el: sky.el, shot: director.shot, camMode: director.mode, quality: post.level, draw: info.render.calls, tris: info.render.triangles, geos: info.memory.geometries, tex: info.memory.textures, frameMs: smoothMs, unlocked: [...game.unlocked], build: world.buildTime };
    },
  };
}
