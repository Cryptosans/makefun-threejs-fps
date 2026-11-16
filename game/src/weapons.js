// Weapons: definitions, recoil/spread model, hitscan resolution.
// Hitscan ray vs body box + head sphere; walls block first. Damage falls off
// past 25 m. Moving fire is punished: spread grows with speed and with bloom,
// recoil kicks pitch up and recovers. All numbers live here, nowhere else.
import { rayBox, rayWalls } from './map.js';

export const WEAPONS = {
  heron: {
    id: 'heron', name: 'AR-9 "Heron"', kind: 'rifle', price: 2700,
    mag: 30, reserve: 90, damage: 34, headMult: 4, auto: true,
    fireInterval: 0.11, reloadTime: 2.4, recoil: 0.011, spreadBase: 0.004,
    spreadMove: 0.016, bloom: 0.0022, range: 90,
  },
  wasp: {
    id: 'wasp', name: 'PDW "Wasp"', kind: 'smg', price: 1500,
    mag: 25, reserve: 100, damage: 26, headMult: 3, auto: true,
    fireInterval: 0.075, reloadTime: 2.0, recoil: 0.008, spreadBase: 0.007,
    spreadMove: 0.02, bloom: 0.0028, range: 70,
  },
  finch: {
    id: 'finch', name: 'P-12 "Finch"', kind: 'pistol', price: 0,
    mag: 12, reserve: 36, damage: 30, headMult: 3, auto: false,
    fireInterval: 0.16, reloadTime: 1.6, recoil: 0.009, spreadBase: 0.005,
    spreadMove: 0.014, bloom: 0.002, range: 50,
  },
};

export const GRENADE_DEFS = {
  frag: { id: 'frag', name: 'Frag GL-1', price: 300, fuse: 1.2, radius: 8, maxDamage: 110 },
  smoke: { id: 'smoke', name: 'Smoke SG-2', price: 300, radius: 4, duration: 15 },
};

export function createWeaponState(weaponId) {
  const def = WEAPONS[weaponId];
  return {
    id: weaponId, mag: def.mag, reserve: def.reserve,
    cooldown: 0, reloadT: 0, bloom: 0, triggerHeld: false,
  };
}

// One weapon slot: fire timing, reload, spread. Pure numbers, no rendering.
export function weaponStep(w, dt, wantFire, reloading) {
  const def = WEAPONS[w.id];
  if (w.cooldown > 0) w.cooldown -= dt;
  if (w.reloadT > 0) {
    w.reloadT -= dt;
    if (w.reloadT <= 0) {
      const need = def.mag - w.mag;
      const take = Math.min(need, w.reserve);
      w.mag += take;
      w.reserve -= take;
    }
  }
  w.bloom = Math.max(0, w.bloom - dt * 0.02);
  return w;
}

export function weaponCanFire(w) {
  const def = WEAPONS[w.id];
  return w.cooldown <= 0 && w.reloadT <= 0 && w.mag > 0;
}

export function weaponFire(w) {
  const def = WEAPONS[w.id];
  w.mag -= 1;
  w.cooldown = def.fireInterval;
  w.bloom = Math.min(0.03, w.bloom + def.bloom);
}

// Current spread in radians: base + movement + bloom; crouch halves the move part.
export function weaponSpread(w, speed, crouched) {
  const def = WEAPONS[w.id];
  const move = (crouched ? 0.45 : 1) * Math.min(1, speed / 5.2) * def.spreadMove;
  return def.spreadBase + move + w.bloom;
}

export function weaponReload(w) {
  const def = WEAPONS[w.id];
  if (w.reloadT > 0 || w.mag >= def.mag || w.reserve <= 0) return false;
  w.reloadT = def.reloadTime;
  return true;
}

// Resolve one hitscan shot. o/d = ray origin/direction (unit), shooter is the
// entity firing (skipped), targets = array of {pos, alive, team, ...} with
// body box [w=0.62, y 0..1.45] and head sphere at y 1.58 r 0.24.
// Returns {hit, target, head, damage, t} or {hit:false}.
export function hitscan(o, d, def, shooter, targets) {
  const wallT = rayWalls(o, d, def.range);
  let bestT = wallT;
  let bestTarget = null;
  let bestHead = false;
  for (const t of targets) {
    if (!t.alive || t === shooter) continue;
    // Body box.
    const bt = rayBox(o, d, [t.pos.x - 0.31, t.pos.z - 0.31, t.pos.x + 0.31, t.pos.z + 0.31, 1.45], def.range);
    // Head sphere: solve |o + t d - c|^2 = r^2.
    const cx = t.pos.x - o.x;
    const cy = 1.58 - o.y;
    const cz = t.pos.z - o.z;
    const b = cx * d.x + cy * d.y + cz * d.z;
    const c = cx * cx + cy * cy + cz * cz - 0.24 * 0.24;
    const disc = b * b - c;
    let ht = Infinity;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t1 = b - sq;
      const t2 = b + sq;
      ht = t1 >= 0 ? t1 : (t2 >= 0 ? t2 : Infinity);
    }
    if (ht < bestT) { bestT = ht; bestTarget = t; bestHead = true; }
    else if (bt < bestT) { bestT = bt; bestTarget = t; bestHead = false; }
  }
  if (!bestTarget) return { hit: false, t: wallT };
  let damage = def.damage * (bestHead ? def.headMult : 1);
  if (bestT > 25) damage *= 0.7;
  return { hit: true, target: bestTarget, head: bestHead, damage: Math.round(damage), t: bestT };
}
