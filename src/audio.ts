let ctx: AudioContext | null = null;
let muted = false;

export function setMuted(m: boolean): void {
  muted = m;
}

function audio(): AudioContext | null {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(
  freq: number,
  dur: number,
  opts: { type?: OscillatorType; vol?: number; delay?: number; slideTo?: number } = {},
): void {
  const ac = audio();
  if (!ac) return;
  const { type = 'sine', vol = 0.15, delay = 0, slideTo } = opts;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export function beep(high = false): void {
  tone(high ? 880 : 440, high ? 0.45 : 0.18, { type: 'square', vol: 0.08 });
}

export function tick(): void {
  tone(1400, 0.03, { type: 'square', vol: 0.04 });
}

export function quack(): void {
  const ac = audio();
  if (!ac) return;
  const pitch = 0.85 + Math.random() * 0.4;
  for (const delay of [0, 0.13]) {
    const t0 = ac.currentTime + delay;
    const osc = ac.createOscillator();
    const filter = ac.createBiquadFilter();
    const gain = ac.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(560 * pitch, t0);
    osc.frequency.exponentialRampToValueAtTime(300 * pitch, t0 + 0.1);
    filter.type = 'bandpass';
    filter.frequency.value = 1300;
    filter.Q.value = 2.5;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.11);
    osc.connect(filter).connect(gain).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + 0.14);
  }
}

export function fanfare(): void {
  [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.14, delay: i * 0.12 }));
  tone(1047, 0.6, { type: 'triangle', vol: 0.14, delay: 0.5 });
  tone(784, 0.6, { type: 'triangle', vol: 0.08, delay: 0.5 });
}

export function horn(): void {
  tone(233, 0.9, { type: 'sawtooth', vol: 0.09 });
  tone(294, 0.9, { type: 'sawtooth', vol: 0.07 });
  tone(349, 0.9, { type: 'square', vol: 0.03 });
}
