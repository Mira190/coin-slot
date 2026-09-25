// Local player: input -> look, movement intent and weapon commands.
import { curWeapon, tryFire, startReload, switchTo, throwGrenade, knifeAlt } from './combat.js';
import { PRIMARIES } from './weapons.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function updatePlayer(game, input, dt, S) {
  const a = game.player;
  const look = input.consumeLook();
  const w = curWeapon(a);
  const scoped = w && w.def.ads.sight === 'scope' && a.ads > 0.9;
  if (a.brain) { input.consume(); game.lookDelta = { dx: 0, dy: 0 }; return { scoped }; } // autopilot (tests)
  if (a.alive && game.state === 'play') {
    // look: sensitivity scales with the zoom so aiming feels the same through a scope
    const zoom = a.ads > 0.5 && w ? w.def.ads.fov : 1;
    const k = 0.0022 * S.sens * (a.ads > 0.5 ? S.adsSens * zoom : 1) * (S.fov / 75);
    a.yaw -= look.dx * k;
    a.pitch = clamp(a.pitch - look.dy * k * (S.invert ? -1 : 1), -1.5, 1.5);
    game.lookDelta = look;
    // movement intent (world space)
    const ax = input.axes();
    const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw), rx = Math.cos(a.yaw), rz = -Math.sin(a.yaw);
    a.move.set(fx * ax.y + rx * ax.x, fz * ax.y + rz * ax.x);
    a.walking = input.down('ShiftLeft') || input.down('ShiftRight');
    a.wantCrouch = input.down('KeyC') || input.down('ControlLeft') || input.down('ControlRight') || input.tbtn.has('crouch');
    if (input.hit('Space') || input.hit('T_jump')) a.wantJump = true;
    // weapons
    if (input.hit('Digit1')) switchTo(game, a, 0);
    if (input.hit('Digit2')) switchTo(game, a, 1);
    if (input.hit('Digit3')) switchTo(game, a, 2);
    if (input.hit('KeyQ')) switchTo(game, a, a.lastSlot);
    if (input.hit('T_swap')) switchTo(game, a, a.slot === 0 ? 1 : 0);
    if (input.wheel) switchTo(game, a, ((a.slot + (input.wheel > 0 ? 1 : 2)) % 3));
    const nadeKinds = ['frag', 'flash', 'smoke'];
    if (input.hit('Digit4') || input.hit('T_nade')) {
      const k = nadeKinds.find((n) => a.load.nades[n] > 0 && (a.nadeSel ? n !== a.nadeSel : true)) || nadeKinds.find((n) => a.load.nades[n] > 0);
      if (k) { a.nadeSel = k; game.vm.equip(k); a.soldier.setWeapon(k); a.switchT = 0.3; a.ads = 0; game.sound(a, 'draw'); }
    }
    if (input.hit('KeyG')) {
      const have = nadeKinds.filter((n) => a.load.nades[n] > 0);
      if (have.length) { const i = have.indexOf(a.nadeSel); a.nadeSel = have[(i + 1) % have.length]; game.vm.equip(a.nadeSel); a.soldier.setWeapon(a.nadeSel); a.switchT = 0.25; }
    }
    if (input.hit('KeyR') || input.hit('T_reload')) startReload(game, a);
    if (input.hit('KeyF') && !a.nadeSel && w && !w.reloading) game.vm.play('inspect', 2.6);
    // ADS: hold right mouse (touch AIM toggles)
    if (input.hit('T_aim')) a.adsToggle = !a.adsToggle;
    const wantAds = (input.aiming() || a.adsToggle) && w && !w.reloading && !a.nadeSel && w.def.kind !== 'knife' && a.switchT <= 0 && !(w.boltT > 0) && !(w.pumpT > 0.2);
    const adsT = w ? w.def.ads.time : 0.2;
    a.ads = clamp(a.ads + (wantAds ? 1 : -1.4) * dt / adsT, 0, 1);
    // fire
    const firing = input.firing();
    if (a.nadeSel) {
      if ((input.hit('Mouse0') || input.hit('T_fire')) && a.switchT <= 0 && !game.freeze) throwGrenade(game, a, a.nadeSel);
    } else if (w && !game.freeze) {
      if (w.def.kind === 'knife' && (input.hit('Mouse2'))) knifeAlt(game, a);
      else if (w.def.auto ? firing : (input.hit('Mouse0') || input.hit('T_fire'))) tryFire(game, a);
    }
  } else {
    // dead in deathmatch: 1-5 pick the primary for the next life (the pointer stays locked)
    if (!a.alive && game.mode && game.mode.id === 'tdm' && game.state === 'play') {
      for (let i = 0; i < PRIMARIES.length; i++) if (input.hit('Digit' + (i + 1)) && game.onPickNext) game.onPickNext(PRIMARIES[i]);
    }
    a.move.set(0, 0); a.wantJump = false; a.ads = 0;
    game.lookDelta = { dx: 0, dy: 0 };
  }
  input.consume();
  return { scoped };
}
