// Runs a chamber's scripted solution through the real controls: it only turns the view, holds keys and presses
// buttons, one physics step at a time. Used by the verification harness and the "watch the evaluator" autoplay.
import { player } from './player.js';

const TURN = 7; // rad/s view turn rate
export function makeBot(steps, api) {
  const bot = { i: 0, t: 0, done: false, failed: null, log: [] };
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const turnTo = (yaw, pitch, dt) => {
    const dy = wrap(yaw - player.yaw), dp = pitch - player.pitch, k = TURN * dt;
    player.yaw = wrap(player.yaw + Math.max(-k, Math.min(k, dy)));
    player.pitch += Math.max(-k, Math.min(k, dp));
    return Math.abs(dy) < 0.01 && Math.abs(dp) < 0.01;
  };
  const aimAt = (x, y, z) => { const e = api.eye(); const dx = x - e.x, dy = y - e.y, dz = z - e.z; return [Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))]; };
  const keys = (f) => { player.botKeys = { f, b: 0, l: 0, r: 0 }; };
  bot.step = (dt) => {
    if (bot.done || bot.failed) { keys(0); return; }
    const s = steps[bot.i]; if (!s) { bot.done = true; keys(0); return; }
    const first = bot.t === 0; bot.t += dt;
    const next = (ok = true, why) => { keys(0); if (!ok) { bot.failed = `step ${bot.i} ${JSON.stringify(s)}: ${why}`; return; } bot.log.push(`${bot.i} ${s[0]} ok @${bot.t.toFixed(2)}s`); bot.i++; bot.t = 0; bot.tp = api.teleports(); };
    if (first) bot.tp = api.teleports();
    switch (s[0]) {
      case 'wait': keys(0); if (bot.t >= s[1]) next(); break;
      case 'goto': { // targets may be expressions, e.g. the x of the bridge as it actually lies
        const tx = typeof s[1] === 'string' ? api.num(s[1]) : s[1], tz = typeof s[2] === 'string' ? api.num(s[2]) : s[2];
        const p = player.body.position, dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz), tol = s[3] ?? 0.35;
        if (d < tol) { keys(0); if (Math.hypot(player.body.velocity.x, player.body.velocity.z) < 0.6 || bot.t > 12) next(); break; }
        const yaw = Math.atan2(-dx, -dz);
        if (!player.grounded && bot.t > 0.3) { keys(0); if (bot.t > 20) next(false, 'goto: airborne too long'); break; } // no steering mid-air
        turnTo(yaw, 0, dt);
        const off = Math.abs(wrap(yaw - player.yaw));
        keys(off < 0.5 ? (d < 0.9 ? Math.max(0.25, d / 0.9) : 1) : 0);
        if (bot.t > 20) next(false, 'goto timeout at ' + [p.x, p.y, p.z].map((v) => v.toFixed(2)));
        break;
      }
      case 'walk': {
        const yaw = s[1] * Math.PI / 180; const ok = turnTo(yaw, 0, dt);
        keys(ok || bot.t > 0.3 ? 1 : 0);
        if (api.teleports() !== bot.tp) next(); else if (bot.t > s[2]) next(s[3] !== 'gate', 'no gate crossed');
        break;
      }
      case 'look': case 'shoot': {
        const [yaw, pitch] = aimAt(s[s[0] === 'look' ? 1 : 2], s[s[0] === 'look' ? 2 : 3], s[s[0] === 'look' ? 3 : 4]);
        keys(0);
        if (turnTo(yaw, pitch, dt) || bot.t > 1.5) {
          if (s[0] === 'shoot' && !api.fire(s[1])) { next(false, 'gate did not open'); break; }
          next();
        }
        break;
      }
      case 'hold': { // hold forward at a yaw until a condition is true
        turnTo(s[1] * Math.PI / 180, 0, dt); keys(1);
        if (api.test(s[2])) { bot.log.push(`${bot.i} hold ok @${bot.t.toFixed(2)}s`); bot.i++; bot.t = 0; bot.tp = api.teleports(); }
        else if (bot.t > (s[3] || 10)) next(false, 'hold timed out: ' + s[2]);
        break;
      }
      case 'enter': { // ['enter', gate, timeout, approach]: line up in front of a wall gate as placed, then walk in
        const g = api.gate(s[1]), p = player.body.position, back = s[3] ?? 1.6;
        if (!g.open) { keys(0); if (bot.t > 2) next(false, 'enter: gate closed'); break; }
        if (api.teleports() !== bot.tp) { next(); break; }
        const ax = g.c.x + g.n.x * back, az = g.c.z + g.n.z * back, d = Math.hypot(ax - p.x, az - p.z);
        if (bot.lined === undefined || bot.t < 0.02) bot.lined = false;
        if (!bot.lined && d > 0.12 && bot.t < 6) {
          // face the gate the whole time (a carried block stays in front of it) and strafe to the line-up point
          turnTo(Math.atan2(g.n.x, g.n.z), 0, dt);
          const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw), dx = ax - p.x, dz = az - p.z, sp = Math.min(1, Math.max(0.25, d / 0.8)) / d;
          const fwd = (-dx * sy - dz * cy) * sp, rgt = (dx * cy - dz * sy) * sp;
          player.botKeys = { f: Math.max(0, fwd), b: Math.max(0, -fwd), r: Math.max(0, rgt), l: Math.max(0, -rgt) };
        } else {
          bot.lined = true;
          turnTo(Math.atan2(g.n.x, g.n.z), 0, dt); keys(1); // face into the wall (-n) and walk
        }
        if (bot.t > (s[2] || 8)) next(false, 'enter: no crossing');
        break;
      }
      case 'slow': { // ['slow', yaw, keyFraction, cond, timeout, pitch]: creep forward until cond, then let go
        turnTo(s[1] * Math.PI / 180, (s[5] || 0) * Math.PI / 180, dt); keys(s[2]);
        if (api.test(s[3])) next(); else if (bot.t > (s[4] || 8)) next(false, 'slow timed out: ' + s[3]);
        break;
      }
      case 'use': keys(0); api.use(); next(); break;
      case 'jump': api.jump(); next(); break;
      case 'until': keys(0); if (api.test(s[1])) next(); else if (bot.t > (s[2] || 10)) next(false, 'until timed out: ' + s[1]); break;
      case 'aim': { keys(0); if (turnTo(s[1] * Math.PI / 180, (s[2] || 0) * Math.PI / 180, dt) || bot.t > 1.5) next(); break; }
      default: next(false, 'unknown step');
    }
  };
  return bot;
}
