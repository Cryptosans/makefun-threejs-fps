// Sim: the single state store and the fixed-step round machine.
// One state object holds everything; every module reads it, none keeps its
// own copy. simStep(state, dt, input) advances the world one fixed step and
// appends events to state.events (drained by main.js for sound, HUD, tracers).
// Phases: buy (15 s) -> round (100 s) -> planted (bomb 40 s) -> end (5 s).
// First to 5 round wins, max 9 rounds. Money: start $800, win +$3000,
// loss +$1900, kill +$300, plant +$300.
import { MAP, inSite } from './map.js';
import { WEAPONS, GRENADE_DEFS, createWeaponState, weaponStep, weaponCanFire, weaponFire, weaponSpread, weaponReload, hitscan } from './weapons.js';
import { createPlayerState, playerStep, playerLook, playerRecoil, EYE_STAND } from './player.js';
import { createBotState, botStep, BOT_NAMES_EMBER, BOT_NAMES_WARDEN } from './bots.js';
import { createGrenadeState, grenadeStep, liveSmokes } from './grenades.js';

export const BUY_TIME = 15;
export const ROUND_TIME = 100;
export const BOMB_TIME = 40;
export const PLANT_TIME = 4;
export const DEFUSE_TIME = 5;
export const WIN_ROUNDS = 5;
export const MAX_ROUNDS = 9;

export function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createGame(seed) {
  const rng = mulberry32(seed || 1);
  const state = {
    seed: seed || 1,
    rng,
    time: 0,
    phase: 'buy',
    phaseT: BUY_TIME,
    round: 1,
    score: { ember: 0, warden: 0 },
    matchOver: false,
    matchWinner: null,
    player: null,
    bots: [],
    bomb: { status: 'carried', site: null, x: 0, z: 0, timer: BOMB_TIME, carrier: null },
    grenades: [],
    noises: [],
    events: [],
    kills: 0,
    deaths: 0,
    roundKills: 0,
    buyOpen: true,
    selectedGrenade: 'frag',
    message: '',
    messageT: 0,
  };
  startRound(state);
  return state;
}

function makeFighters(state) {
  const fighters = [];
  if (state.player) fighters.push(state.player);
  for (const b of state.bots) fighters.push(b);
  return fighters;
}

export function startRound(state) {
  const rng = state.rng;
  state.phase = 'buy';
  state.phaseT = BUY_TIME;
  state.buyOpen = true;
  state.grenades = [];
  state.noises = [];
  state.bomb = { status: 'carried', site: null, x: 0, z: 0, timer: BOMB_TIME, carrier: null };
  state.roundKills = 0;

  // Player: attacker, spawns south facing north (yaw PI faces -z? yaw 0 looks
  // -z; spawn faces the map, yaw ~0 with a slight random offset).
  const ps = MAP.spawnEmber[0];
  const player = createPlayerState(ps[0], ps[1]);
  player.yaw = (rng() - 0.5) * 0.2;
  player.pitch = 0;
  player.team = 'ember';
  player.kind = 'player';
  player.name = 'You';
  player.weapon = createWeaponState('finch');
  player.weapons = { heron: false, wasp: false, finch: true };
  player.grenades = { frag: 0, smoke: 0 };
  player.money = state.player ? state.player.money : 800;
  player.plantT = 0;
  player.defuseT = 0;
  player.hasBomb = true;
  state.player = player;

  // Bots: 4 Ember allies, 5 Wardens. Sites split 2/2 for attackers.
  const bots = [];
  const emberSite = rng() < 0.5 ? 'A' : 'B';
  for (let i = 0; i < 4; i++) {
    const s = MAP.spawnEmber[i + 1];
    const w = i === 0 ? 'heron' : (i === 1 ? 'wasp' : (rng() < 0.5 ? 'heron' : 'wasp'));
    const b = createBotState('ember', BOT_NAMES_EMBER[i], s[0], s[1], w, 'attacker');
    b.site = i < 2 ? emberSite : (emberSite === 'A' ? 'B' : 'A');
    b.grenades = { frag: 0, smoke: 0 };
    bots.push(b);
  }
  const wardenHold = [11, 9, 12, 10, 14]; // A, A-mouth, B, B-mouth, mid
  for (let i = 0; i < 5; i++) {
    const s = MAP.spawnWarden[i];
    const w = i === 4 ? 'wasp' : (rng() < 0.5 ? 'heron' : 'wasp');
    const b = createBotState('warden', BOT_NAMES_WARDEN[i], s[0], s[1], w, 'defender');
    b.holdNode = wardenHold[i];
    b.grenades = { frag: 0, smoke: 0 };
    bots.push(b);
  }
  state.bots = bots;
  state.bomb.carrier = player;
  state.events.push({ type: 'roundStart', round: state.round });
}

function aliveCount(state, team) {
  let n = 0;
  const fighters = makeFighters(state);
  for (const f of fighters) if (f.alive && f.team === team) n += 1;
  return n;
}

function siteOf(state, site) {
  return site === 'A' ? MAP.siteA : MAP.siteB;
}

function siteNode(site) {
  return site === 'A' ? 11 : 12;
}

function approachNode(site) {
  return site === 'A' ? 16 : 17;
}

// Orders for one bot, read by bots.js. Pure decision, no movement here.
function botOrders(state) {
  return function orders(bot) {
    const bomb = state.bomb;
    if (bot.team === 'ember') {
      if (bomb.status === 'planted') {
        return { kind: 'goto', node: siteNode(bomb.site), thenHold: true, holdT: 10 };
      }
      if (bot.hasBomb) return { kind: 'plant', site: siteOf(state, bot.site), node: siteNode(bot.site) };
      return { kind: 'goto', node: approachNode(bot.site), thenHold: true, holdT: 7 };
    }
    // Wardens.
    if (bomb.status === 'planted') {
      return { kind: 'defuse', node: siteNode(bomb.site) };
    }
    return { kind: 'hold', node: bot.holdNode, holdT: 8 };
  };
}

function endRound(state, winner, reason) {
  if (state.phase === 'end') return;
  state.phase = 'end';
  state.phaseT = 5;
  state.buyOpen = false;
  state.score[winner] += 1;
  const p = state.player;
  if (winner === 'ember') {
    p.money += 3000;
    state.message = reason === 'bomb' ? 'Charge detonated — Ember takes the round' : 'Round won — Wardens eliminated';
  } else {
    p.money += 1900;
    state.message = reason === 'defuse' ? 'Charge defused — Wardens take the round' : (reason === 'time' ? 'Time expired — Wardens take the round' : 'Round lost — Ember eliminated');
  }
  state.messageT = 5;
  state.events.push({ type: 'roundEnd', winner, reason });
  if (state.score[winner] >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
    state.matchOver = true;
    state.matchWinner = state.score.ember > state.score.warden ? 'ember' : 'warden';
  }
}

function damageFighter(state, target, damage, killer) {
  if (!target.alive) return;
  target.hp -= damage;
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    target.vel.x = 0;
    target.vel.z = 0;
    state.events.push({ type: 'kill', killer, victim: target });
    if (killer === state.player) {
      state.player.money += 300;
      state.kills += 1;
      state.roundKills += 1;
    }
    if (target === state.player) state.deaths += 1;
    // Bomb drops where the carrier fell.
    if (target.hasBomb) {
      target.hasBomb = false;
      state.bomb.status = 'dropped';
      state.bomb.x = target.pos.x;
      state.bomb.z = target.pos.z;
      state.bomb.carrier = null;
      state.events.push({ type: 'bombDropped', x: target.pos.x, z: target.pos.z });
    }
  }
}

// Player buys during the buy phase. Returns a message for the HUD.
function playerBuy(state, key) {
  const p = state.player;
  const items = {
    Digit1: { id: 'heron', price: WEAPONS.heron.price },
    Digit2: { id: 'wasp', price: WEAPONS.wasp.price },
    Digit4: { id: 'frag', price: GRENADE_DEFS.frag.price },
    Digit5: { id: 'smoke', price: GRENADE_DEFS.smoke.price },
  };
  if (key === 'Digit3') {
    p.weapon = createWeaponState('finch');
    p.weapons.finch = true;
    state.events.push({ type: 'bought', item: 'finch' });
    return;
  }
  const item = items[key];
  if (!item) return;
  if (item.id === 'frag' || item.id === 'smoke') {
    if (p.grenades[item.id] >= 2) return;
    if (p.money < item.price) { state.events.push({ type: 'buyFail' }); return; }
    p.money -= item.price;
    p.grenades[item.id] += 1;
    state.events.push({ type: 'bought', item: item.id });
    return;
  }
  if (p.weapons[item.id]) {
    p.weapon = createWeaponState(item.id);
    state.events.push({ type: 'bought', item: item.id });
    return;
  }
  if (p.money < item.price) { state.events.push({ type: 'buyFail' }); return; }
  p.money -= item.price;
  p.weapons[item.id] = true;
  p.weapon = createWeaponState(item.id);
  state.events.push({ type: 'bought', item: item.id });
}

function throwGrenade(state, kind) {
  const p = state.player;
  if (!p.alive || p.grenades[kind] <= 0) return;
  p.grenades[kind] -= 1;
  const yaw = p.yaw;
  const pitch = p.pitch;
  const speed = 13;
  const vx = -Math.sin(yaw) * Math.cos(pitch) * speed;
  const vz = -Math.cos(yaw) * Math.cos(pitch) * speed;
  const vy = Math.sin(pitch) * speed + 3.5;
  const g = createGrenadeState(kind, p.pos.x, p.pos.y + p.eye, p.pos.z, vx, vy, vz, p);
  state.grenades.push(g);
  state.events.push({ type: 'grenadeThrown', kind });
  state.noises.push({ x: p.pos.x, z: p.pos.z, t: state.time, r: 30 });
}

function playerShoot(state) {
  const p = state.player;
  const w = p.weapon;
  if (!weaponCanFire(w)) {
    if (w.mag === 0 && w.reloadT <= 0) state.events.push({ type: 'dryClick' });
    return;
  }
  const def = WEAPONS[w.id];
  weaponFire(w);
  const spread = weaponSpread(w, p.speed, p.crouched);
  const rng = state.rng;
  const yaw = p.yaw + (rng() * 2 - 1) * spread;
  const pitch = p.pitch + (rng() * 2 - 1) * spread + p.recoilPitch * 0.2;
  const d = {
    x: -Math.sin(yaw) * Math.cos(pitch),
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * Math.cos(pitch),
  };
  const o = { x: p.pos.x, y: p.pos.y + p.eye, z: p.pos.z };
  const fighters = makeFighters(state);
  const res = hitscan(o, d, def, p, fighters);
  const end = res.hit
    ? { x: o.x + d.x * res.t, y: o.y + d.y * res.t, z: o.z + d.z * res.t }
    : { x: o.x + d.x * def.range, y: o.y + d.y * def.range, z: o.z + d.z * def.range };
  state.events.push({ type: 'shot', from: { x: o.x, y: o.y - 0.15, z: o.z }, to: end, weapon: w.id });
  state.noises.push({ x: p.pos.x, z: p.pos.z, t: state.time, r: 30 });
  playerRecoil(p, def.recoil, (rng() * 2 - 1) * 0.003);
  if (res.hit) {
    damageFighter(state, res.target, res.damage, p);
    state.events.push({ type: 'hit', target: res.target, head: res.head, damage: res.damage, killed: !res.target.alive });
  }
}

// One fixed step. input: {keys:Set, look:{x,y}, firing:bool, pressed:Set}.
export function simStep(state, dt, input) {
  state.time += dt;
  const p = state.player;

  if (state.phase === 'end') {
    state.phaseT -= dt;
    if (state.phaseT <= 0) {
      if (state.matchOver) return;
      state.round += 1;
      startRound(state);
    }
    return;
  }

  // Phase timers.
  if (state.phase === 'buy') {
    state.phaseT -= dt;
    if (state.phaseT <= 0) {
      state.phase = 'round';
      state.phaseT = ROUND_TIME;
      state.buyOpen = false;
      state.events.push({ type: 'roundLive' });
    }
  } else if (state.phase === 'round') {
    state.phaseT -= dt;
    if (state.phaseT <= 0) {
      endRound(state, 'warden', 'time');
      return;
    }
  } else if (state.phase === 'planted') {
    state.bomb.timer -= dt;
    if (state.bomb.timer <= 0) {
      state.events.push({ type: 'explosion', x: state.bomb.x, y: 1, z: state.bomb.z, hits: [] });
      endRound(state, 'ember', 'bomb');
      return;
    }
  }

  // Player look + movement.
  if (input.look) playerLook(p, input.look.x, input.look.y);
  playerStep(p, dt, input.keys, input.keys.has('ControlLeft') || input.keys.has('ControlRight'));

  // Edge-triggered keys.
  for (const code of input.pressed) {
    if (code === 'KeyR') {
      if (weaponReload(p.weapon)) state.events.push({ type: 'reload' });
    } else if (code === 'KeyB') {
      state.buyOpen = !state.buyOpen;
    } else if (code === 'KeyG') {
      throwGrenade(state, 'frag');
    } else if (code === 'KeyF') {
      throwGrenade(state, 'smoke');
    } else if (code === 'KeyQ') {
      state.selectedGrenade = state.selectedGrenade === 'frag' ? 'smoke' : 'frag';
    } else if (state.phase === 'buy' && (code === 'Digit1' || code === 'Digit2' || code === 'Digit3' || code === 'Digit4' || code === 'Digit5')) {
      playerBuy(state, code);
    }
  }

  // Weapon step + fire.
  const w = p.weapon;
  weaponStep(w, dt, false, false);
  if (input.firing && p.alive) {
    if (w.auto) playerShoot(state);
    else if (!w._semiLatch) { playerShoot(state); w._semiLatch = true; }
  } else {
    w._semiLatch = false;
  }

  // Plant / defuse: hold E.
  const eHeld = input.keys.has('KeyE');
  if (p.alive && p.hasBomb && state.phase === 'round') {
    const site = inSite(MAP.siteA, p.pos.x, p.pos.z) ? 'A' : (inSite(MAP.siteB, p.pos.x, p.pos.z) ? 'B' : null);
    if (site && eHeld) {
      p.plantT += dt;
      if (p.plantT >= PLANT_TIME) {
        state.bomb.status = 'planted';
        state.bomb.site = site;
        state.bomb.x = p.pos.x;
        state.bomb.z = p.pos.z;
        state.bomb.timer = BOMB_TIME;
        state.phase = 'planted';
        p.hasBomb = false;
        p.money += 300;
        state.events.push({ type: 'planted', bot: p });
      }
    } else {
      p.plantT = 0;
    }
  } else {
    p.plantT = 0;
  }
  // The player is always Ember (attacker): defusing is the Wardens' job,
  // so there is no player-defuse path. p.defuseT stays 0.
  p.defuseT = 0;

  // Bomb pickup: a dropped charge is taken by any living Ember walking over it.
  if (state.bomb.status === 'dropped') {
    const fighters = makeFighters(state);
    for (const f of fighters) {
      if (!f.alive || f.team !== 'ember') continue;
      if (Math.hypot(f.pos.x - state.bomb.x, f.pos.z - state.bomb.z) < 1.5) {
        f.hasBomb = true;
        state.bomb.status = 'carried';
        state.bomb.carrier = f;
        state.events.push({ type: 'bombPickup', bot: f });
        break;
      }
    }
  }

  // Grenades.
  const fighters = makeFighters(state);
  for (const g of state.grenades) {
    const ev = grenadeStep(g, dt, fighters);
    if (ev) {
      for (const h of ev.hits) damageFighter(state, h.target, h.damage, g.owner);
      state.events.push(ev);
      state.noises.push({ x: ev.x, z: ev.z, t: state.time, r: 30 });
    }
  }
  state.grenades = state.grenades.filter((g) => g.alive);

  // Bots.
  const smokes = liveSmokes(state.grenades);
  const ctx = {
    fighters, smokes,
    noises: state.noises,
    bomb: state.bomb,
    time: state.time,
    rng: state.rng,
    events: state.events,
    orders: botOrders(state),
  };
  const evStart = state.events.length;
  for (const b of state.bots) botStep(b, dt, ctx);
  // Handle only this step's new bot events: planted / defused / botShot.
  // (A snapshot: processing pushes new events, which must not be re-read.)
  const newEvents = state.events.slice(evStart);
  for (const ev of newEvents) {
    if (ev.type === 'planted' && ev.bot !== p && state.phase === 'round') {
      state.bomb.status = 'planted';
      state.bomb.site = ev.bot.site;
      state.bomb.x = ev.bot.pos.x;
      state.bomb.z = ev.bot.pos.z;
      state.bomb.timer = BOMB_TIME;
      state.phase = 'planted';
      ev.bot.hasBomb = false;
      ev.bot.state = 'guard';
    } else if (ev.type === 'defused' && ev.bot !== p && state.phase === 'planted') {
      endRound(state, 'warden', 'defuse');
      return;
    } else if (ev.type === 'botShot') {
      const s = ev.shot;
      if (s && s.hit) {
        damageFighter(state, ev.target, s.damage, ev.bot);
        state.events.push({ type: 'hit', target: ev.target, head: s.head, damage: s.damage, killed: !ev.target.alive, byBot: true });
      }
      const from = { x: ev.bot.pos.x, y: 1.4, z: ev.bot.pos.z };
      const to = ev.target ? { x: ev.target.pos.x, y: 1.2, z: ev.target.pos.z } : from;
      state.events.push({ type: 'botShotTrace', from, to });
      state.noises.push({ x: ev.bot.pos.x, z: ev.bot.pos.z, t: state.time, r: 30 });
    }
  }

  // Round end by elimination.
  const emberAlive = aliveCount(state, 'ember');
  const wardenAlive = aliveCount(state, 'warden');
  if (state.phase === 'round' || state.phase === 'planted') {
    if (emberAlive === 0) endRound(state, 'warden', 'elim');
    else if (wardenAlive === 0) endRound(state, 'ember', 'elim');
  }

  // Old noises fade.
  if (state.noises.length > 0 && state.time - state.noises[state.noises.length - 1].t > 2) {
    state.noises = [];
  }
  if (state.messageT > 0) state.messageT -= dt;
}

export function aliveFighters(state) {
  return makeFighters(state).filter((f) => f.alive);
}

export function teamAlive(state, team) {
  return aliveCount(state, team);
}
