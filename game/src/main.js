// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. Events flow sim -> main -> sound/HUD/tracers; rendering
// never writes sim state. ?shot=buy|fight|plant|win with &seed=N sets up a
// deterministic frame for a capture, renders it twice, then freezes it and
// sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createGame, simStep, ROUND_TIME } from './sim.js';
import { MAP } from './map.js';
import { WEAPONS } from './weapons.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { createScene } from './render.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;

let state = createGame(seed);
const audio = createAudio();
const hud = createHud();

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('game').appendChild(renderer.domElement);

const view = createScene(state);
const scene = view.scene;
const camera = view.camera;

const input = createInput(renderer.domElement, onLockChange);
const uiPressed = new Set();
let started = false;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let stepCount = 0;
let footAcc = 0;

hud.onPlay(() => {
  audio.unlock();
  if (shot) return;
  if (state.matchOver) {
    state = createGame((Math.random() * 1e9) | 0);
    view.resetFighters();
    hud.hideOverlay();
    hud.hideBanner();
  }
  input.requestLock();
});
hud.onBuy((code) => {
  if (code === 'heron') uiPressed.add('Digit1');
  else if (code === 'wasp') uiPressed.add('Digit2');
  else if (code === 'finch') uiPressed.add('Digit3');
  else if (code === 'frag') uiPressed.add('Digit4');
  else if (code === 'smoke') uiPressed.add('Digit5');
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (!state.player.alive) {
    // Dead: keep spectating, no pause overlay.
  } else if (!state.matchOver) {
    hud.showOverlay(started ? 'paused' : 'start', state.score);
  }
}

function aimAt(x, y, z) {
  const p = state.player;
  const dx = x - p.pos.x;
  const dy = y - (p.pos.y + p.eye);
  const dz = z - p.pos.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
}

function drainEvents() {
  for (const ev of state.events) {
    switch (ev.type) {
      case 'shot':
        view.spawnTracer(ev.from, ev.to, 0xffc46b);
        view.muzzleFlash();
        audio.shot(ev.weapon);
        break;
      case 'botShotTrace':
        view.spawnTracer(ev.from, ev.to, 0xff7a5c);
        break;
      case 'hit':
        if (!ev.byBot) hud.hitMarker(ev.killed, ev.killed ? 4000 : 90);
        if (ev.killed && !ev.byBot) audio.kill();
        else if (!ev.byBot) audio.hit();
        break;
      case 'kill': {
        const k = ev.killer ? ev.killer.name : '?';
        const v = ev.victim ? ev.victim.name : '?';
        hud.feed(k + ' ▸ ' + v);
        if (ev.victim === state.player) {
          hud.banner('YOU ARE DOWN', 'Spectating — your team fights on.');
          if (document.pointerLockElement) document.exitPointerLock();
        }
        break;
      }
      case 'explosion':
        view.spawnBoom(ev.x, ev.y, ev.z);
        audio.explosion();
        break;
      case 'roundStart':
        hud.banner('ROUND ' + ev.round, 'Buy phase — B opens the shop, 1-5 buys.', 2500);
        break;
      case 'roundLive':
        hud.banner('GO', 'Plant the charge at A or B.', 1800);
        break;
      case 'roundEnd': {
        const won = ev.winner === 'ember';
        hud.banner(won ? 'ROUND WON' : 'ROUND LOST',
          ev.reason === 'bomb' ? 'The charge detonated.'
          : ev.reason === 'defuse' ? 'The charge was defused.'
          : ev.reason === 'time' ? 'Time expired.'
          : 'One team eliminated.', 4200);
        if (won) audio.roundWin(); else audio.roundLose();
        if (state.matchOver) {
          setTimeout(() => {
            hud.showOverlay('match', state.score);
            if (document.pointerLockElement) document.exitPointerLock();
          }, 1200);
        }
        break;
      }
      case 'planted':
        hud.banner('CHARGE PLANTED', 'Hold the site — 40 seconds to detonation.', 3000);
        audio.plantBeep();
        break;
      case 'defused':
        hud.banner('CHARGE DEFUSED', '', 3000);
        break;
      case 'dryClick':
        audio.dryClick();
        break;
      case 'reload':
        audio.reload();
        break;
      case 'grenadeThrown':
        audio.grenadePin();
        break;
      case 'bombDropped':
        hud.feed('The charge was dropped');
        break;
      case 'bombPickup':
        hud.feed((ev.bot.name || 'Someone') + ' picked up the charge');
        break;
      default:
        break;
    }
  }
  state.events.length = 0;
}

function syncHud() {
  const p = state.player;
  const w = p.weapon;
  hud.setHealth(p.hp);
  hud.setAmmo(w.mag, w.reserve, WEAPONS[w.id].name);
  hud.setScore(state.score.ember, state.score.warden, state.round);
  hud.setMoney(p.money);
  let emberAlive = p.alive ? 1 : 0;
  let wardenAlive = 0;
  for (const b of state.bots) {
    if (!b.alive) continue;
    if (b.team === 'ember') emberAlive += 1;
    else wardenAlive += 1;
  }
  hud.setAlive(emberAlive, wardenAlive);
  hud.setGrenades(p.grenades.frag, p.grenades.smoke, state.selectedGrenade);
  hud.setSpread(0.004 + p.speed * 0.002 + w.bloom);
  // Timer.
  if (state.phase === 'buy') {
    hud.setTimer('BUY ' + Math.ceil(state.phaseT), false);
  } else if (state.phase === 'round') {
    hud.setTimer(fmtTime(state.phaseT), state.phaseT < 15);
  } else if (state.phase === 'planted') {
    hud.setTimer(fmtTime(state.bomb.timer), true);
  } else {
    hud.setTimer('—', false);
  }
  // Plant / defuse progress.
  const planting = p.alive && p.hasBomb && p.plantT > 0;
  hud.setPlant(planting, p.plantT / 4, planting ? 'PLANTING…' : '');
  hud.setBombTimer(state.phase === 'planted', 'CHARGE ' + fmtTime(state.bomb.timer));
  hud.setBuy(state.buyOpen && state.phase === 'buy', p.money, p.weapons, p.grenades);
  // Footsteps.
  if (p.alive && p.speed > 1) {
    footAcc += p.speed * FIXED_STEP;
    if (footAcc > 2.2) { footAcc = 0; audio.step(); }
  }
}

function fmtTime(t) {
  const s = Math.max(0, Math.ceil(t));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function stepOnce(dt, look, firing) {
  const pressed = input.takePressed();
  for (const c of uiPressed) pressed.add(c);
  uiPressed.clear();
  simStep(state, dt, { keys: input.state.keys, look, firing, pressed });
  stepCount += 1;
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    const firing = input.state.firing;
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      stepOnce(FIXED_STEP, steps === 0 ? look : { x: 0, y: 0 }, firing);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    drainEvents();
    syncHud();
    camera.position.set(state.player.pos.x, state.player.pos.y + state.player.eye, state.player.pos.z);
    camera.rotation.set(state.player.pitch + state.player.recoilPitch, state.player.yaw, 0, 'YXZ');
  }
  view.render(state, dt);
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i++) {
    stepOnce(FIXED_STEP, { x: 0, y: 0 }, false);
  }
  drainEvents();
  syncHud();
}

function runShot(name) {
  const p = state.player;
  hud.hideOverlay();
  if (name === 'buy') {
    // Buy phase: spawn view down Mid, shop open.
    p.pos.x = 0; p.pos.z = 19;
    p.yaw = 0; p.pitch = 0;
    settle(30);
    state.buyOpen = true;
    syncHud();
    hud.setBuy(true, p.money, p.weapons, p.grenades);
    hud.hideBanner();
  } else if (name === 'fight') {
    // Mid-fight: clear lane south of the mid walls, a Warden in the
    // crosshair 10 m ahead, two aimed rounds (he survives, tracer visible).
    state.phase = 'round';
    state.phaseT = ROUND_TIME - 12;
    state.buyOpen = false;
    p.pos.x = -6; p.pos.z = 18;
    p.yaw = 0; p.pitch = 0;
    p.weapon = { id: 'heron', mag: 30, reserve: 90, cooldown: 0, reloadT: 0, bloom: 0, triggerHeld: false };
    p.weapons.heron = true;
    p.money = 800;
    const enemy = state.bots.find((b) => b.team === 'warden');
    enemy.pos.x = -6; enemy.pos.z = 8;
    enemy.yaw = Math.PI;
    enemy.state = 'hold'; enemy.holdT = 30;
    const ally = state.bots.find((b) => b.team === 'ember');
    ally.pos.x = -11; ally.pos.z = 13;
    ally.state = 'hold'; ally.holdT = 30;
    settle(25);
    aimAt(enemy.pos.x, 1.1, enemy.pos.z);
    for (let r = 0; r < 2; r++) {
      stepOnce(FIXED_STEP, { x: 0, y: 0 }, true);
      settle(6);
    }
    settle(4);
    aimAt(enemy.pos.x, 1.1, enemy.pos.z);
    syncHud();
    hud.hideBanner();
  } else if (name === 'plant') {
    // Site A, charge half-planted, Warden visible at the site edge.
    state.phase = 'round';
    state.phaseT = ROUND_TIME - 30;
    state.buyOpen = false;
    p.pos.x = -20; p.pos.z = -12.5;
    p.hasBomb = true;
    const enemy = state.bots.find((b) => b.team === 'warden');
    enemy.pos.x = -14; enemy.pos.z = -8;
    enemy.state = 'hold'; enemy.holdT = 30;
    settle(25);
    aimAt(enemy.pos.x, 1.4, enemy.pos.z);
    p.plantT = 2.4;
    syncHud();
    hud.setPlant(true, 0.6, 'PLANTING…');
    hud.hideBanner();
  } else if (name === 'win') {
    // Round-win banner over the yard, score 1-0, open view down Mid.
    state.phase = 'end';
    state.phaseT = 4;
    state.score.ember = 1;
    state.round = 1;
    p.pos.x = 0; p.pos.z = 17;
    p.yaw = -0.45; p.pitch = 0.02;
    settle(20);
    hud.banner('ROUND WON', 'Wardens eliminated.', 0);
    syncHud();
  }
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    camera.position.set(state.player.pos.x, state.player.pos.y + state.player.eye, state.player.pos.z);
    camera.rotation.set(state.player.pitch + state.player.recoilPitch, state.player.yaw, 0, 'YXZ');
    view.render(state, 0);
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

camera.position.set(state.player.pos.x, state.player.pos.y + state.player.eye, state.player.pos.z);
camera.rotation.set(state.player.pitch, state.player.yaw, 0, 'YXZ');
syncHud();
if (shot) runShot(shot);
else {
  hud.showOverlay('start', state.score);
  requestAnimationFrame(frame);
}
