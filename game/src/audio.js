// Procedural audio only: every sound is synthesised with WebAudio, no files.
// A tiny synth: noise bursts for shots/explosions, short blips for clicks and
// beeps, two-note stingers for round end. Silent until the first user gesture
// creates the context; shot mode (?shot=) never creates one.
export function createAudio() {
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.22;
      master.connect(ctx.destination);
    } catch {
      return false;
    }
    return true;
  }

  function noiseBuffer(seconds) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function burst(duration, filterFreq, gain, type) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(duration);
    const filter = ctx.createBiquadFilter();
    filter.type = type || 'lowpass';
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + duration);
  }

  function tone(freq, duration, gain, type, slideTo) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + duration);
  }

  return {
    unlock() { ensure(); },
    shot(kind) {
      if (kind === 'rifle') burst(0.09, 1800, 0.5);
      else if (kind === 'smg') burst(0.06, 2400, 0.35);
      else burst(0.12, 1200, 0.55);
      tone(180, 0.06, 0.25, 'square', 60);
    },
    enemyShot() { burst(0.08, 900, 0.18); },
    dryClick() { tone(1400, 0.03, 0.12, 'square'); },
    reload() {
      tone(900, 0.04, 0.15, 'square');
      setTimeout(() => tone(700, 0.04, 0.15, 'square'), 180);
    },
    hit() { tone(2200, 0.05, 0.2, 'sine'); },
    kill() { tone(660, 0.08, 0.25, 'sine'); tone(990, 0.1, 0.2, 'sine'); },
    step() { burst(0.05, 500, 0.06); },
    plantBeep() { tone(1200, 0.09, 0.25, 'sine'); },
    bombBeep() { tone(1500, 0.06, 0.2, 'square'); },
    explosion() {
      burst(0.9, 300, 0.9);
      tone(70, 0.8, 0.5, 'sine', 30);
    },
    grenadePin() { tone(1800, 0.03, 0.12, 'square'); },
    roundWin() {
      tone(523, 0.12, 0.25, 'triangle');
      setTimeout(() => tone(659, 0.12, 0.25, 'triangle'), 120);
      setTimeout(() => tone(784, 0.22, 0.3, 'triangle'), 240);
    },
    roundLose() {
      tone(392, 0.14, 0.25, 'triangle');
      setTimeout(() => tone(311, 0.2, 0.25, 'triangle'), 140);
      setTimeout(() => tone(233, 0.3, 0.3, 'triangle'), 300);
    },
  };
}
