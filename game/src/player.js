// The player: movement, camera, health. Acceleration-based WASD with friction,
// AABB slide collision from map.js, crouch halves speed and eye height.
// The player is one entry of the sim's single state object; this module only
// steps the numbers. Rendering reads the same state.
import { collide } from './map.js';

export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.12;
export const RADIUS = 0.42;

export function createPlayerState(x, z) {
  return {
    pos: { x, y: 0, z },
    vel: { x: 0, z: 0 },
    yaw: 0, pitch: 0,
    hp: 100, alive: true,
    crouched: false, eye: EYE_STAND,
    speed: 0, // horizontal speed, for spread + HUD
    recoilPitch: 0, // unrecovered recoil, decays back to 0
  };
}

export function playerStep(p, dt, keys, wantCrouch) {
  if (!p.alive) { p.vel.x = 0; p.vel.z = 0; p.speed = 0; return; }
  p.crouched = wantCrouch;
  const targetEye = p.crouched ? EYE_CROUCH : EYE_STAND;
  p.eye += (targetEye - p.eye) * Math.min(1, dt * 12);
  // Recoil recovery: pitch returns toward the player's own pitch.
  p.recoilPitch *= Math.max(0, 1 - dt * 6);

  let fx = 0;
  let fz = 0;
  if (keys.has('KeyW')) fz -= 1;
  if (keys.has('KeyS')) fz += 1;
  if (keys.has('KeyA')) fx -= 1;
  if (keys.has('KeyD')) fx += 1;
  const len = Math.hypot(fx, fz) || 1;
  fx /= len;
  fz /= len;
  // Rotate the wish direction by yaw (forward is -z in view space).
  const sin = Math.sin(p.yaw);
  const cos = Math.cos(p.yaw);
  const wx = fx * cos - fz * sin;
  const wz = fx * sin + fz * cos;
  const accel = 60;
  const maxSpeed = p.crouched ? 3.2 : 5.2;
  p.vel.x += wx * accel * dt;
  p.vel.z += wz * accel * dt;
  // Friction when no input: strong decel so stopping to aim pays off fast.
  if (fx === 0 && fz === 0) {
    const f = Math.max(0, 1 - dt * 10);
    p.vel.x *= f;
    p.vel.z *= f;
  }
  const sp = Math.hypot(p.vel.x, p.vel.z);
  if (sp > maxSpeed) {
    p.vel.x = (p.vel.x / sp) * maxSpeed;
    p.vel.z = (p.vel.z / sp) * maxSpeed;
  }
  p.pos.x += p.vel.x * dt;
  p.pos.z += p.vel.z * dt;
  collide(p.pos, RADIUS);
  p.speed = Math.hypot(p.vel.x, p.vel.z);
}

export function playerLook(p, dx, dy) {
  p.yaw -= dx * 0.0022;
  p.pitch -= dy * 0.0022;
  const lim = 1.55;
  p.pitch = Math.max(-lim, Math.min(lim, p.pitch));
}

// Apply a recoil kick: pitch jumps up, then recovers in playerStep.
export function playerRecoil(p, amount, yawKick) {
  p.recoilPitch += amount;
  p.yaw += yawKick;
}

// Camera pitch includes unrecovered recoil so shots visibly climb.
export function playerCameraPitch(p) {
  return p.pitch + p.recoilPitch;
}
