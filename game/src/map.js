// Foundry Yard: the map. One job: geometry data, collision and line-of-sight.
// Coordinates: x east-west (-30..30), z north-south (-22..22). Attackers spawn
// south (z +18), defenders north (z -18). Site A is the crate yard west, site B
// the pump house east. Three lanes: A Long (west), Mid (centre), B Service (east).
// Every solid is an axis-aligned box {x0,z0,x1,z1,h}: movement collides in 2D,
// shots and sight use the full 3D box. Low boxes (h <= 1.2) are vaultable cover:
// they block movement and bullets but not sight over the top.

// [x0, z0, x1, z1, height, kind]
const BOXES = [
  // Perimeter walls (height 4).
  [-31, -23, 31, -22, 4, 'wall'],
  [-31, 22, 31, 23, 4, 'wall'],
  [-31, -22, -30, 22, 4, 'wall'],
  [30, -22, 31, 22, 4, 'wall'],
  // Mid lane spine: two long walls with a gap at z 2..6 (the mid door).
  [-2, -14, 2, 2, 3.2, 'wall'],
  [-2, 6, 2, 14, 3.2, 'wall'],
  // A Long: container wall splitting the lane, gap at the north end.
  [-28, -6, -24, 8, 2.6, 'container'],
  [-28, -16, -26, -6, 2.6, 'container'],
  // B Service: pump house block + pipe rack.
  [24, -16, 28, -6, 3.4, 'wall'],
  [18, 2, 28, 5, 2.2, 'container'],
  // Central cross walls giving each lane corners and sightline breaks.
  [-14, -2, -6, 1, 2.4, 'wall'],
  [6, -2, 14, 1, 2.4, 'wall'],
  [-10, 10, -4, 12, 1.1, 'crate'],
  [4, 10, 10, 12, 1.1, 'crate'],
  // Site A crates (the yard).
  [-26, -14, -22, -11, 1.2, 'crate'],
  [-20, -17, -16, -14, 1.2, 'crate'],
  [-24, -9, -20, -7, 2.2, 'container'],
  // Site B crates (the pump house).
  [16, -17, 20, -14, 1.2, 'crate'],
  [22, -13, 26, -10, 1.2, 'crate'],
  [15, -9, 19, -7, 2.2, 'container'],
  // Mid cover: forklift crates and a low wall near spawn exits.
  [-4, -8, -1, -6, 1.1, 'crate'],
  [1, -8, 4, -6, 1.1, 'crate'],
  [-8, 16, -2, 18, 1.1, 'crate'],
  [2, 16, 8, 18, 1.1, 'crate'],
];

export const MAP = {
  minX: -30, maxX: 30, minZ: -22, maxZ: 22,
  boxes: BOXES,
  siteA: { x0: -27, z0: -19, x1: -13, z1: -6, cx: -20, cz: -12.5 },
  siteB: { x0: 13, z0: -19, x1: 27, z1: -6, cx: 20, cz: -12.5 },
  spawnEmber: [
    [-6, 19], [-2, 19.5], [2, 19], [6, 19.5], [0, 17.5],
  ],
  spawnWarden: [
    [-24, -19.5], [-12, -20], [0, -20], [12, -20], [24, -19.5],
  ],
};

// Waypoint graph: nodes over lanes, sites and corners; edges join neighbours
// with a clear walk. Bots pathfind with BFS and walk node to node.
const NODES = [
  [-4, 19], [4, 19], [0, 16],           // 0-2 attacker spawn
  [-14, 16], [14, 16],                  // 3-4 lane mouths south
  [-26, 12], [26, 12],                  // 5-6 lane mouths mid
  [-26, 0], [26, 0],                    // 7-8 lane middles
  [-26, -12], [26, -12],                // 9-10 lane mouths north / sites
  [-20, -12.5], [20, -12.5],            // 11-12 sites A / B
  [0, 4], [0, -4], [0, -12],            // 13-15 mid corridor
  [-10, -12], [10, -12],                // 16-17 site approaches
  [-18, -19], [18, -19],                // 18-19 defender spawn
  [-4, -18], [4, -18],                  // 20-21 defender back line
];
const EDGES = [
  [0, 2], [1, 2], [2, 3], [2, 4], [3, 5], [4, 6], [5, 7], [6, 8],
  [7, 9], [8, 10], [9, 11], [10, 12], [3, 13], [4, 13], [13, 14],
  [14, 15], [15, 16], [15, 17], [16, 11], [17, 12], [9, 18], [10, 19],
  [18, 20], [19, 21], [20, 15], [21, 15], [11, 16], [12, 17], [7, 16],
  [8, 17], [13, 3], [14, 7], [14, 8], [0, 3], [1, 4], [5, 3], [6, 4],
];
export const WAYPOINTS = { nodes: NODES, edges: EDGES };

const ADJ = NODES.map(() => []);
for (const [a, b] of EDGES) {
  ADJ[a].push(b);
  ADJ[b].push(a);
}

export function nearestNode(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < NODES.length; i++) {
    const dx = NODES[i][0] - x;
    const dz = NODES[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// BFS path as a list of [x, z] points from (x,z) to the target node.
export function findPath(x, z, targetNode) {
  const start = nearestNode(x, z);
  if (start === targetNode) return [[NODES[targetNode][0], NODES[targetNode][1]]];
  const prev = new Int16Array(NODES.length).fill(-1);
  const queue = [start];
  prev[start] = start;
  for (let head = 0; head < queue.length; head++) {
    const n = queue[head];
    if (n === targetNode) break;
    for (const m of ADJ[n]) {
      if (prev[m] === -1) { prev[m] = n; queue.push(m); }
    }
  }
  if (prev[targetNode] === -1) return [[NODES[targetNode][0], NODES[targetNode][1]]];
  const path = [];
  let n = targetNode;
  while (n !== start) { path.push([NODES[n][0], NODES[n][1]]); n = prev[n]; }
  path.reverse();
  return path;
}

// 2D circle-vs-box collision: push (x,z) with radius r out of every box.
// Returns true when a push happened. Mutates pos in place (no allocation).
export function collide(pos, r) {
  let hit = false;
  for (const b of BOXES) {
    const cx = Math.max(b[0], Math.min(pos.x, b[2]));
    const cz = Math.max(b[1], Math.min(pos.z, b[3]));
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        pos.x = cx + (dx / d) * r;
        pos.z = cz + (dz / d) * r;
      } else {
        // Centre inside the box: push out along the smallest penetration axis.
        const pl = pos.x - b[0] + r;
        const pr = b[2] - pos.x + r;
        const pt = pos.z - b[1] + r;
        const pb = b[3] - pos.z + r;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) pos.x = b[0] - r;
        else if (m === pr) pos.x = b[2] + r;
        else if (m === pt) pos.z = b[1] - r;
        else pos.z = b[3] + r;
      }
      hit = true;
    }
  }
  pos.x = Math.max(MAP.minX + r, Math.min(MAP.maxX - r, pos.x));
  pos.z = Math.max(MAP.minZ + r, Math.min(MAP.maxZ - r, pos.z));
  return hit;
}

// Ray vs 3D AABB (slab test). Origin o, direction d (unit). Returns the
// nearest t in [0, maxT] or Infinity. Reuses no heap: plain numbers.
export function rayBox(o, d, b, maxT) {
  let tMin = 0;
  let tMax = maxT;
  // X slab
  if (Math.abs(d.x) < 1e-9) {
    if (o.x < b[0] || o.x > b[2]) return Infinity;
  } else {
    let t1 = (b[0] - o.x) / d.x;
    let t2 = (b[2] - o.x) / d.x;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return Infinity;
  }
  // Z slab
  if (Math.abs(d.z) < 1e-9) {
    if (o.z < b[1] || o.z > b[3]) return Infinity;
  } else {
    let t1 = (b[1] - o.z) / d.z;
    let t2 = (b[3] - o.z) / d.z;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return Infinity;
  }
  // Y slab (box base 0, top h)
  if (Math.abs(d.y) < 1e-9) {
    if (o.y < 0 || o.y > b[4]) return Infinity;
  } else {
    let t1 = (0 - o.y) / d.y;
    let t2 = (b[4] - o.y) / d.y;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return Infinity;
  }
  return tMin;
}

// Nearest wall hit along a ray, or Infinity when the ray is clear.
export function rayWalls(o, d, maxT) {
  let best = Infinity;
  for (const b of BOXES) {
    const t = rayBox(o, d, b, maxT);
    if (t < best) best = t;
  }
  return best;
}

// 2D segment vs box footprint: does segment (ax,az)-(bx,bz) cross box b?
// Used for sight and noise checks (eye height handled by the caller's h test).
export function segmentHitsBox(ax, az, bx, bz, b) {
  const dx = bx - ax;
  const dz = bz - az;
  let t0 = 0;
  let t1 = 1;
  if (Math.abs(dx) < 1e-9) {
    if (ax < b[0] || ax > b[2]) return false;
  } else {
    let ta = (b[0] - ax) / dx;
    let tb = (b[2] - ax) / dx;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  if (Math.abs(dz) < 1e-9) {
    if (az < b[1] || az > b[3]) return false;
  } else {
    let ta = (b[1] - az) / dz;
    let tb = (b[3] - az) / dz;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

// Line of sight between two points at eye height: blocked by any box tall
// enough to cover the sight line (h >= 1.6) or by a smoke sphere.
export function hasLineOfSight(ax, ay, az, bx, by, bz, smokes) {
  for (const b of BOXES) {
    if (b[4] < 1.6) continue;
    if (segmentHitsBox(ax, az, bx, bz, b)) {
      // The box only blocks if the sight line passes below its top.
      const t = 0.5;
      const yMid = ay + (by - ay) * t;
      if (yMid < b[4]) return false;
    }
  }
  if (smokes) {
    for (const s of smokes) {
      if (s.alive && segmentHitsSphere(ax, ay, az, bx, by, bz, s)) return false;
    }
  }
  return true;
}

export function segmentHitsSphere(ax, ay, az, bx, by, bz, s) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const cx = s.x - ax;
  const cy = s.y - ay;
  const cz = s.z - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  if (len2 < 1e-9) return false;
  let t = (cx * dx + cy * dy + cz * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = ax + dx * t - s.x;
  const py = ay + dy * t - s.y;
  const pz = az + dz * t - s.z;
  return px * px + py * py + pz * pz < s.r * s.r;
}

export function inSite(site, x, z) {
  return x >= site.x0 && x <= site.x1 && z >= site.z0 && z <= site.z1;
}
