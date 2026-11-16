// Bots: the nine AI fighters. One state machine per bot, driven by the same
// fixed step as the player. States: patrol (follow waypoints toward the
// objective), hold (sit on an angle), engage (a visible enemy: strafe + burst
// fire), investigate (walk to the last noise), plant / defuse / guard.
// Attackers push a site and plant; defenders hold sites and rotate on noise.
// Vision: 100-degree cone, 40 m, manual segment-vs-box line of sight.
// Hearing: gunshots are noise events with a 30 m radius.
import { MAP, WAYPOINTS, findPath, nearestNode, collide, hasLineOfSight, inSite } from './map.js';
import { WEAPONS, weaponStep, weaponCanFire, weaponFire, weaponReload, createWeaponState } from './weapons.js';
import { createGrenadeState } from './grenades.js';

export const BOT_NAMES_EMBER = ['Ash', 'Coal', 'Flint', 'Soot'];
export const BOT_NAMES_WARDEN = ['Vera', 'Holt', 'Maren', 'Ivo', 'Petra'];

const VISION_RANGE = 40;
const VISION_HALF_ANGLE = 0.87; // ~50 deg each side
const HEAR_RANGE = 30;
const BOT_SPEED = 3.6;
const EYE_Y = 1.5;

export function createBotState(team, name, x, z, weaponId, role) {
  return {
    kind: 'bot', team, name, role,
    pos: { x, y: 0, z },
    vel: { x: 0, z: 0 },
    yaw: team === 'ember' ? Math.PI : 0, pitch: 0,
    hp: 100, alive: true,
    weapon: createWeaponState(weaponId),
    state: 'patrol',
    path: [], pathI: 0,
    targetNode: -1,
    holdNode: -1, holdT: 0,
    enemy: null, lastSeen: { x: 0, z: 0, t: -99 },
    reactionT: 0, burstLeft: 0, burstT: 0, strafeDir: 1, strafeT: 0,
    plantT: 0, defuseT: 0,
    noise: null, speed: 0,
    hasBomb: false, grenades: { frag: 0, smoke: 0 },
    money: 800,
  };
}

function angleTo(b, x, z) {
  return Math.atan2(-(x - b.pos.x), -(z - b.pos.z));
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function dist2(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

// Pick the nearest visible enemy inside the vision cone.
export function botScan(bot, fighters, smokes, time) {
  let best = null;
  let bestD = Infinity;
  for (const f of fighters) {
    if (!f.alive || f.team === bot.team) continue;
    const d2 = dist2(bot.pos.x, bot.pos.z, f.pos.x, f.pos.z);
    if (d2 > VISION_RANGE * VISION_RANGE) continue;
    const ang = angleTo(bot, f.pos.x, f.pos.z);
    if (Math.abs(angleDiff(ang, bot.yaw)) > VISION_HALF_ANGLE) continue;
    if (!hasLineOfSight(bot.pos.x, EYE_Y, bot.pos.z, f.pos.x, 1.4, f.pos.z, smokes)) continue;
    if (d2 < bestD) { bestD = d2; best = f; }
  }
  if (best) {
    bot.lastSeen.x = best.pos.x;
    bot.lastSeen.z = best.pos.z;
    bot.lastSeen.t = time;
  }
  return best;
}

function setPath(bot, targetNode) {
  if (bot.targetNode === targetNode && bot.path.length > 0) return;
  bot.targetNode = targetNode;
  bot.path = findPath(bot.pos.x, bot.pos.z, targetNode);
  bot.pathI = 0;
}

function walkPath(bot, dt, speed) {
  if (bot.pathI >= bot.path.length) return true;
  const node = bot.path[bot.pathI];
  const dx = node[0] - bot.pos.x;
  const dz = node[1] - bot.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.6) { bot.pathI += 1; return bot.pathI >= bot.path.length; }
  bot.vel.x = (dx / d) * speed;
  bot.vel.z = (dz / d) * speed;
  bot.yaw = angleTo(bot, node[0], node[1]);
  bot.pos.x += bot.vel.x * dt;
  bot.pos.z += bot.vel.z * dt;
  collide(bot.pos, 0.42);
  bot.speed = speed;
  return false;
}

// Fire a burst at the enemy: hit chance falls with distance, target speed and
// crouch; headshot 8%. Damage by the bot's weapon. Returns hit info or null.
export function botShoot(bot, enemy, rng, time) {
  const def = WEAPONS[bot.weapon.id];
  if (!weaponCanFire(bot.weapon)) return null;
  weaponFire(bot.weapon);
  const dist = Math.sqrt(dist2(bot.pos.x, bot.pos.z, enemy.pos.x, enemy.pos.z));
  const targetSpeed = enemy.speed || 0;
  const crouch = enemy.crouched ? 0.08 : 0;
  let p = 0.52 - dist * 0.009 - (targetSpeed > 1 ? 0.14 : 0) - crouch;
  p = Math.max(0.04, Math.min(0.62, p));
  const hit = rng() < p;
  if (!hit) return { hit: false, damage: 0, head: false };
  const head = rng() < 0.08;
  let dmg = def.damage * (head ? def.headMult : 1) * (0.55 + rng() * 0.45);
  if (dist > 25) dmg *= 0.7;
  return { hit: true, damage: Math.max(4, Math.round(dmg)), head };
}

// One bot, one fixed step. ctx carries the shared world: fighters, smokes,
// noises, bomb, round info, rng, time, and an event sink (array).
export function botStep(bot, dt, ctx) {
  if (!bot.alive) return;
  const { fighters, smokes, time, rng, events } = ctx;
  weaponStep(bot.weapon, dt, false, false);
  if (bot.weapon.reloadT <= 0 && bot.weapon.mag === 0) weaponReload(bot.weapon);

  // Scan first: seeing an enemy overrides everything except plant/defuse.
  const seen = botScan(bot, fighters, smokes, time);
  if (seen && bot.state !== 'plant' && bot.state !== 'defuse') {
    if (bot.enemy !== seen) {
      bot.enemy = seen;
      bot.reactionT = 0.25 + rng() * 0.35;
      bot.burstLeft = 0;
    }
    bot.state = 'engage';
  } else if (bot.state === 'engage' && bot.enemy) {
    // Lost sight: keep the last seen position briefly, then give up.
    if (time - bot.lastSeen.t > 1.2) {
      bot.enemy = null;
      bot.state = 'patrol';
    }
  }

  switch (bot.state) {
    case 'engage': {
      const e = bot.enemy;
      if (!e || !e.alive) { bot.enemy = null; bot.state = 'patrol'; break; }
      const ang = angleTo(bot, e.pos.x, e.pos.z);
      bot.yaw += angleDiff(ang, bot.yaw) * Math.min(1, dt * 10);
      bot.reactionT -= dt;
      // Strafe sideways while fighting.
      bot.strafeT -= dt;
      if (bot.strafeT <= 0) {
        bot.strafeDir = rng() < 0.5 ? -1 : 1;
        bot.strafeT = 0.7 + rng() * 0.9;
      }
      const dist = Math.sqrt(dist2(bot.pos.x, bot.pos.z, e.pos.x, e.pos.z));
      const wantDist = bot.weapon.id === 'wasp' ? 10 : 16;
      let mx = 0;
      let mz = 0;
      if (dist > wantDist + 3) { mx = e.pos.x - bot.pos.x; mz = e.pos.z - bot.pos.z; }
      else if (dist < wantDist - 3) { mx = bot.pos.x - e.pos.x; mz = bot.pos.z - e.pos.z; }
      const px = -Math.sin(bot.yaw) * bot.strafeDir;
      const pz = -Math.cos(bot.yaw) * bot.strafeDir;
      mx += px * 1.4;
      mz += pz * 1.4;
      const ml = Math.hypot(mx, mz) || 1;
      bot.vel.x = (mx / ml) * BOT_SPEED * 0.55;
      bot.vel.z = (mz / ml) * BOT_SPEED * 0.55;
      bot.pos.x += bot.vel.x * dt;
      bot.pos.z += bot.vel.z * dt;
      collide(bot.pos, 0.42);
      bot.speed = BOT_SPEED * 0.55;
      if (bot.reactionT <= 0 && Math.abs(angleDiff(ang, bot.yaw)) < 0.12) {
        if (bot.burstLeft <= 0) {
          bot.burstLeft = bot.weapon.id === 'wasp' ? 5 : 3;
          bot.burstT = 0;
        }
        bot.burstT -= dt;
        if (bot.burstLeft > 0 && bot.burstT <= 0) {
          bot.burstT = WEAPONS[bot.weapon.id].fireInterval;
          bot.burstLeft -= 1;
          const shot = botShoot(bot, e, rng, time);
          events.push({ type: 'botShot', bot, target: e, shot, dist });
          if (bot.weapon.mag === 0) {
            bot.burstLeft = 0;
            weaponReload(bot.weapon);
          }
        }
      }
      break;
    }
    case 'plant': {
      bot.plantT += dt;
      bot.vel.x = 0; bot.vel.z = 0; bot.speed = 0;
      if (bot.plantT >= 4) {
        events.push({ type: 'planted', bot });
        bot.state = 'guard';
      }
      break;
    }
    case 'defuse': {
      bot.defuseT += dt;
      bot.vel.x = 0; bot.vel.z = 0; bot.speed = 0;
      if (bot.defuseT >= 5) {
        events.push({ type: 'defused', bot });
        bot.state = 'patrol';
      }
      break;
    }
    case 'hold': {
      bot.holdT -= dt;
      bot.vel.x = 0; bot.vel.z = 0; bot.speed = 0;
      // Slowly sweep the angle while holding.
      bot.yaw += Math.sin(time * 0.5 + bot.holdNode) * dt * 0.35;
      if (bot.holdT <= 0) bot.state = 'patrol';
      break;
    }
    case 'investigate': {
      if (bot.noise) {
        const done = walkPath(bot, dt, BOT_SPEED);
        if (done) {
          bot.state = 'hold';
          bot.holdT = 2.5;
          bot.holdNode = nearestNode(bot.pos.x, bot.pos.z);
        }
      } else {
        bot.state = 'patrol';
      }
      break;
    }
    case 'guard':
    case 'patrol':
    default: {
      // Objective behaviour, decided by the sim through ctx.orders.
      const order = ctx.orders(bot);
      if (order.kind === 'goto') {
        setPath(bot, order.node);
        const done = walkPath(bot, dt, BOT_SPEED);
        if (done && order.thenHold) {
          bot.state = 'hold';
          bot.holdT = order.holdT || 6;
          bot.holdNode = order.node;
        }
      } else if (order.kind === 'plant') {
        if (inSite(order.site, bot.pos.x, bot.pos.z)) {
          bot.state = 'plant';
          bot.plantT = 0;
          events.push({ type: 'plantStart', bot });
        } else {
          setPath(bot, order.node);
          walkPath(bot, dt, BOT_SPEED);
        }
      } else if (order.kind === 'defuse') {
        const b = ctx.bomb;
        const dx = b.x - bot.pos.x;
        const dz = b.z - bot.pos.z;
        if (Math.hypot(dx, dz) < 1.6) {
          bot.state = 'defuse';
          bot.defuseT = 0;
          events.push({ type: 'defuseStart', bot });
        } else {
          setPath(bot, order.node);
          walkPath(bot, dt, BOT_SPEED);
        }
      } else if (order.kind === 'hold') {
        bot.state = 'hold';
        bot.holdT = order.holdT || 8;
        bot.holdNode = nearestNode(bot.pos.x, bot.pos.z);
      }
      break;
    }
  }

  // Hear the newest noise inside range: walk to it.
  if (ctx.noises.length > 0 && bot.state !== 'engage' && bot.state !== 'plant' && bot.state !== 'defuse') {
    const n = ctx.noises[ctx.noises.length - 1];
    if (n.t > time - 0.5 && dist2(bot.pos.x, bot.pos.z, n.x, n.z) < HEAR_RANGE * HEAR_RANGE) {
      bot.noise = n;
      bot.state = 'investigate';
      setPath(bot, nearestNode(n.x, n.z));
    }
  }
}
