// Render: the three.js scene, built once from the map and the sim state.
// The sim owns all numbers; this module only moves meshes to match them.
// One mesh group per fighter, one pool of tracers, one mesh per smoke cloud.
// No allocation in the frame loop: pooled vectors, reused geometries.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { MAP } from './map.js';
import { WEAPONS } from './weapons.js';

const tmpV = new THREE.Vector3();

function box(w, h, d, color, opts) {
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: (opts && opts.roughness) || 0.85,
    metalness: (opts && opts.metalness) || 0.15,
    emissive: (opts && opts.emissive) || 0x000000,
    emissiveIntensity: (opts && opts.emissiveIntensity) || 0,
    transparent: !!(opts && opts.transparent),
    opacity: (opts && opts.opacity) || 1,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

function letterTexture(letter, color) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(20,22,26,0.55)';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = color;
  g.lineWidth = 6;
  g.strokeRect(4, 4, 120, 120);
  g.fillStyle = color;
  g.font = 'bold 84px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(letter, 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createRenderer(scene, camera) {
  // Scene dressing: ground, skyline, lamps, site decals.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(62, 46),
    new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 0.95, metalness: 0.05 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, 0);
  scene.add(ground);
  // Concrete yard slabs: a darker checker of thin planes for readability.
  const slabMat = new THREE.MeshStandardMaterial({ color: PALETTE.groundDark, roughness: 1 });
  for (let i = 0; i < 5; i++) {
    const slab = new THREE.Mesh(new THREE.PlaneGeometry(10, 3.2), slabMat);
    slab.rotation.x = -Math.PI / 2;
    slab.position.set(-24 + i * 12, 0.01, 8);
    scene.add(slab);
  }
  // Map boxes.
  const kindColor = {
    wall: PALETTE.steelDark,
    container: PALETTE.containerA,
    crate: PALETTE.crate,
  };
  const kindColor2 = { container: PALETTE.containerB };
  let ci = 0;
  for (const b of MAP.boxes) {
    const w = b[2] - b[0];
    const d = b[3] - b[1];
    const color = b[5] === 'container' ? (ci % 2 === 0 ? kindColor.container : kindColor2.container) : kindColor[b[5]];
    ci += 1;
    const m = box(w, b[4], d, color, { roughness: 0.8, metalness: 0.25 });
    m.position.set((b[0] + b[2]) / 2, b[4] / 2, (b[1] + b[3]) / 2);
    scene.add(m);
    // Hazard stripe on tall containers: a thin emissive top edge.
    if (b[4] >= 2.2 && b[5] === 'container') {
      const edge = box(w * 0.98, 0.08, 0.12, PALETTE.lamp, { emissive: PALETTE.lamp, emissiveIntensity: 0.7 });
      edge.position.set((b[0] + b[2]) / 2, b[4] + 0.04, b[1] + 0.06);
      scene.add(edge);
    }
  }
  // Distant foundry silhouettes outside the walls.
  const silMat = new THREE.MeshStandardMaterial({ color: '#20262c', roughness: 1 });
  // [x, z, width, height, depth]
  const silhouettes = [
    [-38, -30, 14, 6, 10], [38, -28, 12, 8, 10], [-20, -32, 8, 10, 8],
    [24, 30, 10, 7, 8], [0, -34, 18, 12, 6],
  ];
  for (const s of silhouettes) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(s[2], s[3], s[4]), silMat);
    m.position.set(s[0], s[3] / 2, s[1]);
    scene.add(m);
  }
  // Sodium lamps: poles + glowing heads + a few real point lights.
  const lampPositions = [[-14, 6], [14, 6], [0, -16], [-26, 4], [26, 4]];
  const poleMat = new THREE.MeshStandardMaterial({ color: '#2a2f34', roughness: 0.7, metalness: 0.6 });
  for (const [x, z] of lampPositions) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.2, 6), poleMat);
    pole.position.set(x, 2.6, z);
    scene.add(pole);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 10, 8),
      new THREE.MeshBasicMaterial({ color: PALETTE.lamp }),
    );
    head.position.set(x, 5.25, z);
    scene.add(head);
  }
  // Site decals + floating letters.
  for (const [site, letter, color] of [[MAP.siteA, 'A', PALETTE.ember], [MAP.siteB, 'B', PALETTE.ember]]) {
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(site.x1 - site.x0, site.z1 - site.z0),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.1, depthWrite: false }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(site.cx, 0.02, site.cz);
    scene.add(decal);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: letterTexture(letter, color), transparent: true, depthTest: true,
    }));
    sprite.scale.set(3.2, 3.2, 1);
    sprite.position.set(site.cx, 4.4, site.cz);
    scene.add(sprite);
  }

  // Lights: hemisphere wash + one directional sun + three lamp points.
  const hemi = new THREE.HemisphereLight(0x8fa3b8, 0x2a2118, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd9a0, 1.1);
  sun.position.set(18, 30, 12);
  scene.add(sun);
  for (const [x, z] of [[-14, 6], [14, 6], [0, -16]]) {
    const pl = new THREE.PointLight(0xffb347, 12, 22, 1.8);
    pl.position.set(x, 5, z);
    scene.add(pl);
  }
  scene.fog = new THREE.Fog(new THREE.Color(PALETTE.fog), 24, 70);
}

// A low-poly humanoid: torso, head, legs, arms, gun. Team colours on the
// torso and head band. Built once per fighter, posed every frame.
function buildHumanoid(team) {
  const group = new THREE.Group();
  const main = team === 'ember' ? PALETTE.ember : PALETTE.warden;
  const dark = team === 'ember' ? PALETTE.emberDark : PALETTE.wardenDark;
  const torso = box(0.56, 0.62, 0.3, main, { roughness: 0.7 });
  torso.position.y = 1.08;
  group.add(torso);
  const vest = box(0.58, 0.2, 0.32, dark, { roughness: 0.7 });
  vest.position.y = 1.18;
  group.add(vest);
  const head = box(0.3, 0.3, 0.3, '#c9a184', { roughness: 0.8 });
  head.position.y = 1.58;
  group.add(head);
  const band = box(0.32, 0.08, 0.32, main, { roughness: 0.6 });
  band.position.y = 1.68;
  group.add(band);
  const legL = box(0.2, 0.72, 0.22, '#23272b', { roughness: 0.9 });
  legL.position.set(-0.15, 0.36, 0);
  group.add(legL);
  const legR = box(0.2, 0.72, 0.22, '#23272b', { roughness: 0.9 });
  legR.position.set(0.15, 0.36, 0);
  group.add(legR);
  const armL = box(0.14, 0.5, 0.16, dark, { roughness: 0.7 });
  armL.position.set(-0.36, 1.1, 0.08);
  armL.rotation.x = -0.9;
  group.add(armL);
  const armR = box(0.14, 0.5, 0.16, dark, { roughness: 0.7 });
  armR.position.set(0.36, 1.1, 0.08);
  armR.rotation.x = -0.9;
  group.add(armR);
  const gun = box(0.07, 0.12, 0.72, '#15181b', { roughness: 0.4, metalness: 0.7 });
  gun.position.set(0.18, 1.28, -0.3);
  group.add(gun);
  group.userData.legL = legL;
  group.userData.legR = legR;
  // Blob shadow: a dark disc that follows the fighter on the ground.
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.02;
  group.add(blob);
  return group;
}

// Viewmodel: the player's own gun, attached to the camera.
function buildViewmodel(camera) {
  const group = new THREE.Group();
  const body = box(0.07, 0.11, 0.42, '#1a1e22', { roughness: 0.35, metalness: 0.75 });
  group.add(body);
  const barrel = box(0.04, 0.04, 0.22, '#0e1113', { roughness: 0.3, metalness: 0.8 });
  barrel.position.set(0, 0.02, -0.3);
  group.add(barrel);
  const mag = box(0.05, 0.14, 0.08, '#2a2f34', { roughness: 0.5, metalness: 0.5 });
  mag.position.set(0, -0.1, -0.04);
  mag.rotation.x = 0.2;
  group.add(mag);
  const sight = box(0.025, 0.04, 0.06, PALETTE.accent, { emissive: PALETTE.accent, emissiveIntensity: 0.4 });
  sight.position.set(0, 0.07, -0.12);
  group.add(sight);
  group.position.set(0.24, -0.22, -0.5);
  camera.add(group);
  return group;
}

export function createScene(state) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);
  const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
  scene.add(camera);
  createRenderer(scene, camera);

  const viewmodel = buildViewmodel(camera);
  // Muzzle flash: a small additive quad at the viewmodel barrel tip.
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.15, 0.15),
    new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.19, -0.85);
  camera.add(flash);

  const fighterMeshes = new Map();
  function meshFor(f) {
    let m = fighterMeshes.get(f);
    if (!m) {
      m = buildHumanoid(f.team);
      scene.add(m);
      fighterMeshes.set(f, m);
    }
    return m;
  }

  // Tracer pool: 24 lines, reused.
  const tracers = [];
  for (let i = 0; i < 24; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0 }));
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerI = 0;
  function spawnTracer(from, to, color) {
    const t = tracers[tracerI];
    tracerI = (tracerI + 1) % tracers.length;
    const pos = t.line.geometry.attributes.position.array;
    pos[0] = from.x; pos[1] = from.y; pos[2] = from.z;
    pos[3] = to.x; pos[4] = to.y; pos[5] = to.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.material.color.setHex(color || 0xffc46b);
    t.line.material.opacity = 0.9;
    t.life = 0.09;
  }

  // Explosion flash pool.
  const booms = [];
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xff8c2e, transparent: true, opacity: 0, depthWrite: false }),
    );
    scene.add(m);
    booms.push({ mesh: m, life: 0 });
  }
  let boomI = 0;
  function spawnBoom(x, y, z) {
    const b = booms[boomI];
    boomI = (boomI + 1) % booms.length;
    b.mesh.position.set(x, y, z);
    b.mesh.scale.set(0.5, 0.5, 0.5);
    b.mesh.material.opacity = 0.85;
    b.life = 0.5;
  }

  // Smoke spheres, one mesh each, reused.
  const smokeMeshes = [];
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(1, 14, 12),
      new THREE.MeshStandardMaterial({ color: 0x9aa0a6, transparent: true, opacity: 0, roughness: 1, depthWrite: false }),
    );
    m.visible = false;
    scene.add(m);
    smokeMeshes.push(m);
  }

  // The charge: a small box with a blinking light, shown when dropped/planted.
  const bombMesh = new THREE.Group();
  const bombBox = box(0.5, 0.28, 0.34, '#20242a', { roughness: 0.4, metalness: 0.6 });
  bombBox.position.y = 0.14;
  bombMesh.add(bombBox);
  const bombLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 8, 6),
    new THREE.MeshBasicMaterial({ color: PALETTE.danger }),
  );
  bombLight.position.set(0, 0.34, 0);
  bombMesh.add(bombLight);
  scene.add(bombMesh);

  let flashT = 0;

  function render(state, dt) {
    const p = state.player;
    // Camera follows the player; when dead, hold the death view.
    camera.position.set(p.pos.x, p.pos.y + p.eye, p.pos.z);
    camera.rotation.set(p.pitch + p.recoilPitch, p.yaw, 0, 'YXZ');
    // Viewmodel bobs with movement and dips while reloading.
    const bob = p.alive ? Math.sin(state.time * 9) * Math.min(1, p.speed / 5) * 0.012 : 0;
    viewmodel.position.y = -0.22 + bob - (p.weapon.reloadT > 0 ? 0.08 : 0);
    viewmodel.rotation.x = p.weapon.reloadT > 0 ? -0.35 : 0;
    if (flashT > 0) {
      flashT -= dt;
      flash.material.opacity = Math.max(0, flashT / 0.05);
      flash.rotation.z = Math.random() * Math.PI;
    }

    // Fighters.
    for (const b of state.bots) {
      const m = meshFor(b);
      m.position.set(b.pos.x, b.pos.y, b.pos.z);
      if (b.alive) {
        m.rotation.set(0, b.yaw, 0);
        m.visible = true;
        // Walk cycle: legs swing with speed.
        const swing = Math.sin(state.time * 10) * Math.min(1, (b.speed || 0) / 3.6) * 0.5;
        m.userData.legL.rotation.x = swing;
        m.userData.legR.rotation.x = -swing;
      } else {
        // Fallen: lying on the ground, faded.
        m.rotation.set(0, b.yaw, Math.PI / 2);
        m.position.y = 0.15;
      }
    }
    // The bomb.
    const bomb = state.bomb;
    if (bomb.status === 'planted' || bomb.status === 'dropped') {
      bombMesh.visible = true;
      bombMesh.position.set(bomb.x, 0, bomb.z);
      bombLight.material.color.setHex(Math.sin(state.time * 8) > 0 ? 0xff2a2a : 0x881111);
    } else {
      bombMesh.visible = false;
    }
    // Smoke clouds.
    let si = 0;
    for (const g of state.grenades) {
      if (g.kind !== 'smoke' || !g.landed || si >= smokeMeshes.length) continue;
      const m = smokeMeshes[si];
      si += 1;
      m.visible = true;
      m.position.set(g.x, 1.2, g.z);
      const r = 4 * Math.min(1, g.t * 2);
      m.scale.set(r, r * 0.8, r);
      m.material.opacity = 0.42;
    }
    for (; si < smokeMeshes.length; si++) smokeMeshes[si].visible = false;
    // Tracers fade.
    for (const t of tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.9;
      }
    }
    for (const b of booms) {
      if (b.life > 0) {
        b.life -= dt;
        const s = 0.5 + (0.5 - b.life) * 14;
        b.mesh.scale.set(s, s, s);
        b.mesh.material.opacity = Math.max(0, b.life / 0.5) * 0.85;
      }
    }
  }

  return {
    scene, camera, render,
    spawnTracer, spawnBoom,
    muzzleFlash() { flashT = 0.05; flash.material.opacity = 0.95; },
    weaponName() { return WEAPONS[state.player.weapon.id].name; },
    resetFighters() {
      for (const m of fighterMeshes.values()) scene.remove(m);
      fighterMeshes.clear();
    },
  };
}
