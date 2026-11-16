// Emberline palette: one look plan, every colour in the game comes from here.
// Foundry dusk: cold steel blues, hot ember orange for the attackers, deep teal
// for the Wardens, warm sodium lamps. HUD CSS uses the same six names.
export const PALETTE = {
  sky: '#1a2027',
  fog: '#232a31',
  ground: '#3a3f45',
  groundDark: '#2e3338',
  steel: '#4d565e',
  steelDark: '#39414a',
  rust: '#7a4a30',
  containerA: '#8a5a2e',
  containerB: '#2e6b6b',
  containerC: '#5d6b52',
  crate: '#6b5636',
  lamp: '#ffb347',
  ember: '#e8722a',
  emberDark: '#a34d16',
  warden: '#2aa5a0',
  wardenDark: '#17706c',
  ink: '#e9e6df',
  muted: '#98a0a8',
  accent: '#f0a830',
  danger: '#e5484d',
  good: '#46a758',
};

export function hex(name) {
  return PALETTE[name];
}
