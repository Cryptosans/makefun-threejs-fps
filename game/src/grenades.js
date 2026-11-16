// Grenades: frag (timed fuse, radius damage through open air) and smoke
// (a sphere that blocks bot sight for 15 s). Thrown on a simple ballistic arc
// with gravity, bouncing once off the ground. All state lives in the sim.
import { hasLineOfSight, collide } from './map.js';
import { GRENADE_DEFS } from './weapons.js';

export function createGrenadeState(kind, x, y, z, vx, vy, vz, owner) {
  const def = GRENADE_DEFS[kind];
  return {
    kind, x, y, z, vx, vy, vz, owner,
    t: 0, fuse: kind === 'frag' ? def.fuse : 0,
    alive: true, exploded: false, landed: false,
    r: kind === 'smoke' ? def.radius : 0,
    life: kind === 'smoke' ? def.duration : 0,
  };
}

// Step one grenade. Returns an event object when it explodes, else null.
// Damage: falloff with distance, blocked by walls (no LOS = no damage).
export function grenadeStep(g, dt, fighters) {
  if (!g.alive) return null;
  g.t += dt;
  if (g.kind === 'smoke') {
    if (!g.landed) {
      g.vy -= 9.8 * dt;
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      g.z += g.vz * dt;
      if (g.y <= 0.1) { g.y = 0.1; g.landed = true; g.vx = 0; g.vy = 0; g.vz = 0; }
      const p = { x: g.x, z: g.z };
      collide(p, 0.2);
      g.x = p.x; g.z = p.z;
    }
    g.life -= dt;
    if (g.life <= 0) g.alive = false;
    return null;
  }
  // Frag: fly, bounce once, explode on fuse.
  g.vy -= 9.8 * dt;
  g.x += g.vx * dt;
  g.y += g.vy * dt;
  g.z += g.vz * dt;
  if (g.y <= 0.1) {
    g.y = 0.1;
    g.vy = Math.abs(g.vy) * 0.35;
    g.vx *= 0.6;
    g.vz *= 0.6;
    if (Math.abs(g.vy) < 0.8) { g.vy = 0; g.vx = 0; g.vz = 0; }
  }
  const p = { x: g.x, z: g.z };
  collide(p, 0.2);
  g.x = p.x; g.z = p.z;
  if (g.t >= g.fuse) {
    g.alive = false;
    g.exploded = true;
    const def = GRENADE_DEFS.frag;
    const hits = [];
    for (const f of fighters) {
      if (!f.alive || f === g.owner) continue;
      const dx = f.pos.x - g.x;
      const dy = 1.0 - g.y;
      const dz = f.pos.z - g.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > def.radius) continue;
      if (!hasLineOfSight(g.x, g.y, g.z, f.pos.x, 1.0, f.pos.z, null)) continue;
      const dmg = Math.round(def.maxDamage * (1 - dist / (def.radius + 1.5)));
      hits.push({ target: f, damage: Math.max(10, dmg) });
    }
    return { type: 'explosion', x: g.x, y: g.y, z: g.z, hits };
  }
  return null;
}

// Smoke spheres currently alive, for the sight check.
export function liveSmokes(grenades) {
  const out = [];
  for (const g of grenades) {
    if (g.alive && g.kind === 'smoke' && g.landed) out.push(g);
  }
  return out;
}
