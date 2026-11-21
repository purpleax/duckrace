import type { HazardKind, Race } from './raceEngine';

export interface RaceSceneState {
  /** Wall-clock seconds, drives bobbing and water. */
  time: number;
  /** Race seconds since the start (0 before the race). */
  t: number;
  race: Race | null;
  names: string[];
  /** lanes[i] is the row entrant i swims in. */
  lanes: number[];
  duration: number;
  moving: boolean;
}

type Ctx = CanvasRenderingContext2D;

const FONT = 'ui-rounded, "SF Pro Rounded", "Nunito", "Trebuchet MS", system-ui, sans-serif';
const TAU = Math.PI * 2;
const INK = '#111';
/** Seconds before the winner finishes at which a photo finish is called. */
export const PHOTO_FINISH_LEAD = 0.9;
const MARKERS: [number, string][] = [
  [0.25, '¾ TO GO'],
  [0.5, 'HALFWAY'],
  [0.75, '¼ TO GO'],
];

function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Track length in pixels: longer races get a longer river, within reason, and
 * so do bigger fields (up to twice as long from 50 ducks), so the pack has room to spread.
 */
function trackLength(width: number, duration: number, count: number): number {
  const crowd = 1 + Math.min(1, Math.max(0, (count - 10) / 40));
  return width * (2 + Math.min(duration, 90) / 30) * crowd;
}

// ---------------------------------------------------------------------------
// Duck sprites. Each duck is one of the pictures in duck-sprites/, fitted
// once to an offscreen canvas in unit coordinates (1 unit = body length)
// and then stamped every frame.
// ---------------------------------------------------------------------------

const SPRITE_W = 2.0;
const SPRITE_H = 1.95;
const ORIGIN_X = 0.95;
const ORIGIN_Y = 1.3;
/** The picture is fitted into this box, sitting on the waterline. */
const DUCK_W = 1.3;
const DUCK_H = 1.3;
const DUCK_CX = -0.04;
const DUCK_BOTTOM = 0.38;

interface DuckImage {
  img: HTMLImageElement;
  /** Bounds of the visible pixels, so every duck sits on the water whatever its padding. */
  box: { x: number; y: number; w: number; h: number } | null;
}

const duckUrls = Object.values(
  import.meta.glob<string>('../duck-sprites/*.png', { eager: true, query: '?url', import: 'default' }),
);

/** Shuffled on each page load, so the costumes are dealt out differently every time. */
const duckOrder = duckUrls.map((_, i) => i);
for (let i = duckOrder.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [duckOrder[i], duckOrder[j]] = [duckOrder[j], duckOrder[i]];
}

function visibleBox(img: HTMLImageElement): DuckImage['box'] {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, w, h).data;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? { x: 0, y: 0, w, h } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

const duckImages: DuckImage[] = duckUrls.map((url) => {
  const entry: DuckImage = { img: new Image(), box: null };
  entry.img.onload = () => {
    entry.box = visibleBox(entry.img);
    sprites.clear();
  };
  entry.img.src = url;
  return entry;
});

interface Sprite {
  canvas: HTMLCanvasElement;
  size: number;
  scale: number;
}
const sprites = new Map<number, Sprite>();

function ell(p: Path2D, cx: number, cy: number, rx: number, ry: number): void {
  p.moveTo(cx + rx, cy);
  p.ellipse(cx, cy, rx, ry, 0, 0, TAU);
}

/** Entrant i's picture; with more entrants than pictures they come round again. */
function paintDuck(g: Ctx, i: number): void {
  if (!duckImages.length) return;
  const { img, box } = duckImages[duckOrder[i % duckOrder.length]];
  if (!box) return; // Still loading: the sprite cache is cleared when it arrives.
  const k = Math.min(DUCK_W / box.w, DUCK_H / box.h);
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, box.x, box.y, box.w, box.h, DUCK_CX - (box.w * k) / 2, DUCK_BOTTOM - box.h * k, box.w * k, box.h * k);
}

function getSprite(i: number, size: number, scale: number): Sprite {
  let sprite = sprites.get(i);
  if (!sprite || sprite.size !== size || sprite.scale !== scale) {
    if (sprites.size > 450) sprites.clear();
    const canvas = document.createElement('canvas');
    const k = size * scale;
    canvas.width = Math.ceil(SPRITE_W * k);
    canvas.height = Math.ceil(SPRITE_H * k);
    const g = canvas.getContext('2d')!;
    g.setTransform(k, 0, 0, k, ORIGIN_X * k, ORIGIN_Y * k);
    paintDuck(g, i);
    sprite = { canvas, size, scale };
    sprites.set(i, sprite);
  }
  return sprite;
}

/** A standalone picture of duck i, for the podium. */
export function duckPortrait(i: number, size: number): HTMLCanvasElement {
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement('canvas');
  const k = size * scale;
  canvas.width = Math.ceil(SPRITE_W * k);
  canvas.height = Math.ceil(SPRITE_H * k);
  canvas.style.width = `${SPRITE_W * size}px`;
  canvas.style.height = `${SPRITE_H * size}px`;
  const g = canvas.getContext('2d')!;
  g.setTransform(k, 0, 0, k, ORIGIN_X * k, ORIGIN_Y * k);
  paintDuck(g, i);
  return canvas;
}

/** Whirlpools and lily pads are drawn on the river; a fast current is felt but not shown. */
function drawHazard(ctx: Ctx, kind: HazardKind, x: number, y: number, s: number, time: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineCap = 'round';
  if (kind === 'whirlpool') {
    ctx.scale(1, 0.42);
    ctx.fillStyle = 'rgba(10,50,90,0.45)';
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.8, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = s * 0.06;
    for (let arm = 0; arm < 3; arm++) {
      ctx.beginPath();
      for (let k = 0; k <= 20; k++) {
        const a = -time * 4 + arm * (TAU / 3) + k * 0.22;
        const r = s * (0.12 + k * 0.032);
        if (k === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.stroke();
    }
  } else if (kind === 'lilypad') {
    ctx.scale(1, 0.5);
    const pad = new Path2D();
    pad.moveTo(0, 0);
    pad.arc(0, 0, s * 0.62, 0.25, TAU - 0.25);
    pad.closePath();
    ctx.lineWidth = s * 0.08;
    ctx.strokeStyle = '#0c5a14';
    ctx.lineJoin = 'round';
    ctx.stroke(pad);
    ctx.fillStyle = '#35b043';
    ctx.fill(pad);
    ctx.fillStyle = '#ff8fc0';
    for (let k = 0; k < 5; k++) {
      ctx.beginPath();
      ctx.arc(-s * 0.4 + Math.cos(k * 1.257) * s * 0.11, -s * 0.2 + Math.sin(k * 1.257) * s * 0.11, s * 0.09, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.arc(-s * 0.4, -s * 0.2, s * 0.07, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawDuck(
  ctx: Ctx,
  sprite: Sprite,
  x: number,
  y: number,
  time: number,
  i: number,
  moving: boolean,
  pace: number,
  effect: HazardKind | null,
): void {
  const s = sprite.size;
  const surging = moving && pace > 1.35;
  const fading = moving && pace < 0.7;
  const speed = !moving ? 2.2 : surging ? 8 : fading ? 4 : 6;
  // A duck on a lily pad hops in frustration; one in a whirlpool is spun around.
  const bob = effect === 'lilypad' ? -Math.abs(Math.sin(time * 7)) * s * 0.14 : Math.sin(time * speed + i * 1.7) * s * 0.04;
  // Surging ducks lean into it, fading ducks sit back.
  const lean = surging ? 0.09 : fading ? -0.07 : 0;
  const tilt = effect === 'whirlpool' ? time * 7 : lean + Math.sin(time * speed * 0.8 + i) * (moving ? 0.07 : 0.03);

  if (surging) {
    // Spray and speed streaks kicked up behind a surging duck.
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, s * 0.05);
    for (let k = 0; k < 2; k++) {
      const phase = (time * 2 + k * 0.25 + i * 0.37) % 1;
      const sx = x - s * (0.7 + phase * 0.9);
      const sy = y + s * (0.3 - k * 0.17);
      ctx.globalAlpha = 1 - phase;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx - s * 0.3, sy);
      ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    for (let k = 0; k < 3; k++) {
      const phase = (time * 1.8 + k * 0.2 + i * 0.61) % 1;
      ctx.globalAlpha = 1 - phase;
      ctx.beginPath();
      ctx.arc(x - s * (0.55 + phase * 0.5 + k * 0.05), y + s * 0.25 - Math.sin(phase * Math.PI) * s * (0.25 + k * 0.05), s * 0.035, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = 'rgba(12,62,92,0.3)';
  ctx.beginPath();
  ctx.ellipse(x - s * 0.04, y + s * 0.33, s * 0.6, s * 0.11, 0, 0, TAU);
  ctx.fill();

  ctx.save();
  ctx.translate(x, y + bob);
  ctx.rotate(tilt);
  ctx.drawImage(sprite.canvas, -ORIGIN_X * s, -ORIGIN_Y * s, SPRITE_W * s, SPRITE_H * s);
  ctx.restore();
}

/** Speech-bubble name tag whose tail points down at (x, y). */
function drawTag(ctx: Ctx, text: string, x: number, y: number, size: number, W: number, fill: string): void {
  ctx.font = `600 ${size}px ${FONT}`;
  const label = text.length > 20 ? text.slice(0, 19) + '…' : text;
  const w = ctx.measureText(label).width + size * 0.8;
  if (x + w / 2 < 0 || x - w / 2 > W) return;
  const h = size * 1.42;
  const tail = size * 0.4;
  const top = y - tail - h;
  const bubble = new Path2D();
  bubble.roundRect(x - w / 2, top, w, h, h * 0.28);
  bubble.moveTo(x - size * 0.1, y - tail - 1);
  bubble.lineTo(x + size * 0.28, y);
  bubble.lineTo(x + size * 0.45, y - tail - 1);
  bubble.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, size * 0.2);
  ctx.strokeStyle = INK;
  ctx.stroke(bubble);
  ctx.fillStyle = fill;
  ctx.fill(bubble);
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, top + h / 2 + size * 0.04);
}

function drawBush(ctx: Ctx, x: number, y: number, r: number): void {
  const p = new Path2D();
  ell(p, x, y, r, r * 0.85);
  ell(p, x - r * 0.85, y + r * 0.25, r * 0.65, r * 0.6);
  ell(p, x + r * 0.85, y + r * 0.25, r * 0.65, r * 0.6);
  ctx.lineWidth = Math.max(3, r * 0.14);
  ctx.strokeStyle = '#0c5a14';
  ctx.lineJoin = 'round';
  ctx.stroke(p);
  ctx.fillStyle = '#1f9a2b';
  ctx.fill(p);
}

export function drawRace(ctx: Ctx, W: number, H: number, s: RaceSceneState): void {
  const riverTop = H * 0.24;
  const riverH = H - riverTop;
  const n = s.names.length;
  const L = trackLength(W, s.duration, n);
  const { race, time } = s;

  // Sized from the shorter side so a tall, narrow screen still fits the pack.
  const size = Math.min(H, W * 0.72) * (n <= 10 ? 0.2 : n <= 30 ? 0.175 : 0.155);
  const pos = new Array<number>(n);
  let lead = 0;
  for (let i = 0; i < n; i++) {
    pos[i] = race ? race.progress(i, s.t) : 0;
    if (pos[i] > lead) lead = pos[i];
  }
  // The camera travels at the race's even pace so the river never stalls when the
  // leader eases up; it only speeds up if a breakaway would leave the screen.
  const paceLine = race ? s.t / race.duration : 0;
  const follow = Math.max(paceLine * L - 0.5 * W, lead * L - 0.88 * W);
  const cam = Math.min(Math.max(follow, -0.3 * W), L - 0.85 * W);

  // Grassy bank.
  const bank = ctx.createLinearGradient(0, 0, 0, riverTop);
  bank.addColorStop(0, '#22c52c');
  bank.addColorStop(1, '#17a821');
  ctx.fillStyle = bank;
  ctx.fillRect(0, 0, W, riverTop);

  ctx.lineCap = 'round';
  for (let k = Math.floor((cam - 300) / 230); k * 230 - cam < W + 200; k++) {
    const x = k * 230 + hash(k + 50) * 130 - cam;
    const kind = hash(k + 52);
    if (kind < 0.55) {
      drawBush(ctx, x, riverTop * (0.5 + hash(k + 51) * 0.28), riverTop * (0.17 + hash(k + 53) * 0.08));
    }
    // Grass tuft.
    const tx = x + 110;
    const ty = riverTop * (0.35 + hash(k + 54) * 0.5);
    const ts = riverTop * 0.07;
    ctx.strokeStyle = '#0f7d1a';
    ctx.lineWidth = Math.max(2, ts * 0.3);
    ctx.beginPath();
    ctx.moveTo(tx - ts, ty - ts);
    ctx.lineTo(tx - ts * 0.4, ty);
    ctx.lineTo(tx, ty - ts * 1.3);
    ctx.lineTo(tx + ts * 0.4, ty);
    ctx.lineTo(tx + ts, ty - ts);
    ctx.stroke();
  }

  // River with rolling wave bands.
  ctx.fillStyle = '#2f93b9';
  ctx.fillRect(0, riverTop, W, riverH);
  const bands = 7;
  const bandH = riverH / bands;
  for (let b = 0; b < bands; b++) {
    const y0 = riverTop + (b + 0.35) * bandH;
    const dir = b % 2 ? 1 : -1;
    ctx.fillStyle = b % 2 ? 'rgba(255,255,255,0.09)' : 'rgba(0,45,85,0.1)';
    ctx.beginPath();
    for (let x = 0; x <= W + 24; x += 24) {
      const y = y0 + Math.sin((x + cam + b * 70) / 58 + time * 1.1 * dir) * bandH * 0.11;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let x = W + 24; x >= 0; x -= 24) {
      ctx.lineTo(x, y0 + bandH * 0.5 + Math.sin((x + cam + b * 40) / 72 - time * 0.9 * dir) * bandH * 0.11);
    }
    ctx.closePath();
    ctx.fill();
  }

  // Muddy shoreline.
  ctx.fillStyle = '#8b5a2b';
  ctx.fillRect(0, riverTop - 5, W, 8);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, riverTop + 3, W, 2);

  // Start rope.
  const startX = -cam + size * 0.1;
  if (startX > -10 && startX < W + 10) {
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(startX, riverTop + 5);
    ctx.lineTo(startX, H);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Finish line.
  const finishX = L - cam;
  const cell = Math.max(12, W * 0.016);
  if (finishX > -120 && finishX < W + 120) {
    for (let row = 0, y = riverTop + 5; y < H; row++, y += cell) {
      for (let col = 0; col < 2; col++) {
        ctx.fillStyle = (row + col) % 2 ? 'rgba(255,255,255,0.92)' : 'rgba(17,17,17,0.9)';
        ctx.fillRect(finishX + col * cell, y, cell, cell);
      }
    }
    const signW = Math.max(84, W * 0.12);
    const signH = riverTop * 0.3;
    const signY = riverTop * 0.5;
    ctx.fillStyle = '#6b4320';
    ctx.fillRect(finishX + cell - 3, signY, 6, riverTop - signY);
    const sign = new Path2D();
    sign.roundRect(finishX + cell - signW / 2, signY - signH / 2, signW, signH, 8);
    ctx.lineWidth = 6;
    ctx.strokeStyle = INK;
    ctx.stroke(sign);
    ctx.fillStyle = '#ffd23f';
    ctx.fill(sign);
    ctx.fillStyle = INK;
    ctx.font = `800 ${signH * 0.56}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('FINISH', finishX + cell, signY + 1);
  }

  // Distance markers: a rope of buoys across the river and a sign on the bank.
  for (const [frac, label] of MARKERS) {
    const mx = frac * L - cam;
    if (mx < -120 || mx > W + 120) continue;
    const r = Math.max(5, H * 0.011);
    for (let y = riverTop + r * 3; y < H; y += r * 5) {
      const by = y + Math.sin(time * 2 + y) * 2;
      ctx.beginPath();
      ctx.arc(mx, by, r, 0, TAU);
      ctx.lineWidth = 3;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.fillStyle = '#ff7a1a';
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(mx - r * 0.7, by - r * 0.25, r * 1.4, r * 0.5);
    }
    const signH = riverTop * 0.24;
    ctx.font = `800 ${signH * 0.56}px ${FONT}`;
    const signW = ctx.measureText(label).width + signH * 0.8;
    const signY = riverTop * 0.62;
    ctx.fillStyle = '#6b4320';
    ctx.fillRect(mx - 3, signY, 6, riverTop - signY);
    const sign = new Path2D();
    sign.roundRect(mx - signW / 2, signY - signH / 2, signW, signH, 7);
    ctx.lineWidth = 5;
    ctx.strokeStyle = INK;
    ctx.stroke(sign);
    ctx.fillStyle = '#fff';
    ctx.fill(sign);
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, mx, signY + 1);
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const spriteScale = n > 80 ? 1 : dpr;
  const top = riverTop + size * 0.2;
  const usable = H - size * 0.45 - top;
  const depthOf = (i: number): number => (n > 1 ? s.lanes[i] / (n - 1) : 0.5);
  const sizeOf = (i: number): number => Math.round(size * (0.86 + 0.28 * depthOf(i)));
  const laneY = (i: number): number => top + depthOf(i) * usable;

  // River hazards sit in the lane of the duck that will meet them.
  if (race) {
    for (const h of race.hazards) {
      const ds = sizeOf(h.duck);
      const hx = h.at * L - cam - ds * 0.74;
      if (hx < -ds * 2 || hx > W + ds * 2) continue;
      drawHazard(ctx, h.kind, hx, laneY(h.duck) + ds * 0.28, ds, time);
    }
  }

  // The current leader gets a golden spotlight.
  let leader = -1;
  if (race && s.t > 0) {
    for (let i = 0; i < n; i++) if (leader < 0 || pos[i] > pos[leader]) leader = i;
  }

  // Name bubbles shrink as the field grows, so a big pack does not bury the ducks.
  const tagScale = Math.max(0.11, Math.min(0.24, 0.24 * Math.sqrt(10 / n)));
  // The leader, and both ducks in a photo finish once it is on, get full-size gold bubbles on top of the pack.
  const starring = new Set<number>(leader >= 0 ? [leader] : []);
  if (race?.photoFinish && s.t > race.duration - PHOTO_FINISH_LEAD) {
    starring.add(race.order[0]);
    starring.add(race.order[1]);
  }
  const starTags: (() => void)[] = [];

  // Ducks and their name bubbles, back rows first so the pack piles up.
  const byLane = Array.from({ length: n }, (_, i) => i).sort((a, b) => s.lanes[a] - s.lanes[b]);
  for (const i of byLane) {
    const ds = sizeOf(i);
    // Spread the field out behind the start rope; the stagger is gone early in the race.
    const stagger = hash(i + 300) * size * 2.4 * Math.max(0, 1 - pos[i] / 0.12);
    const x = pos[i] * L - cam - ds * 0.74 - stagger;
    if (x < -ds * 4 || x > W + ds * 2) continue;
    const y = laneY(i);
    if (x > -ds * 1.2) {
      if (i === leader) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 5);
        ctx.strokeStyle = `rgba(255,214,48,${0.65 + 0.3 * pulse})`;
        ctx.lineWidth = ds * (0.07 + 0.03 * pulse);
        ctx.beginPath();
        ctx.ellipse(x - ds * 0.04, y + ds * 0.33, ds * (0.78 + 0.05 * pulse), ds * (0.19 + 0.02 * pulse), 0, 0, TAU);
        ctx.stroke();
      }
      const effect = race && s.moving ? race.effect(i, s.t) : null;
      drawDuck(ctx, getSprite(i, ds, spriteScale), x, y, time, i, s.moving, race ? race.pace(i, s.t) : 1, effect);
    }
    if (starring.has(i)) {
      starTags.push(() => drawTag(ctx, s.names[i], x - ds * 0.04, y - ds * 0.96, Math.max(11, ds * 0.24), W, '#ffd23f'));
    } else {
      drawTag(ctx, s.names[i], x - ds * 0.04, y - ds * 0.96, Math.max(10, ds * tagScale), W, '#fff');
    }
  }
  for (const draw of starTags) draw();
}

export function drawWheel(ctx: Ctx, W: number, H: number, names: string[], rot: number, time: number): void {
  const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
  bg.addColorStop(0, '#d9f3ff');
  bg.addColorStop(1, '#6fc6f2');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (let k = 0; k < 14; k++) {
    const y = ((hash(k + 200) * H - time * (10 + hash(k + 201) * 18)) % H + H) % H;
    ctx.beginPath();
    ctx.arc(hash(k + 202) * W, y, 4 + hash(k + 203) * 10, 0, Math.PI * 2);
    ctx.fill();
  }

  const n = names.length;
  const cx = W / 2;
  const cy = H / 2;
  const R = Math.min(W, H) * 0.44;

  ctx.fillStyle = 'rgba(29,43,83,0.18)';
  ctx.beginPath();
  ctx.arc(cx, cy + R * 0.04, R * 1.03, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);

  if (n === 0) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();
  }
  const arc = (Math.PI * 2) / Math.max(n, 1);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = `hsl(${(i * 360) / n} 85% ${i % 2 ? 70 : 62}%)`;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, R, i * arc, (i + 1) * arc);
    ctx.closePath();
    ctx.fill();
    if (n <= 80) {
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  if (n > 0 && n <= 60) {
    const fs = Math.max(9, Math.min(R * 0.11, arc * R * 0.62 * 0.8));
    ctx.font = `700 ${fs}px ${FONT}`;
    ctx.fillStyle = '#1d2b53';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const maxW = R * 0.66;
    for (let i = 0; i < n; i++) {
      let label = names[i];
      while (label.length > 1 && ctx.measureText(label).width > maxW) label = label.slice(0, -2) + '…';
      ctx.save();
      ctx.rotate((i + 0.5) * arc);
      ctx.fillText(label, R - R * 0.07, 0);
      ctx.restore();
    }
  }
  ctx.restore();

  // Rim and hub.
  ctx.strokeStyle = '#1d2b53';
  ctx.lineWidth = Math.max(5, R * 0.035);
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#ffc93c';
  ctx.lineWidth = Math.max(3, R * 0.025);
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.17, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#1d2b53';
  ctx.font = `800 ${R * 0.085}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SPIN', cx, cy + 1);

  // Pointer on the right, shaped like a beak.
  const px = cx + R;
  ctx.fillStyle = '#ff8c1a';
  ctx.strokeStyle = '#1d2b53';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(px - R * 0.1, cy);
  ctx.lineTo(px + R * 0.1, cy - R * 0.075);
  ctx.lineTo(px + R * 0.1, cy + R * 0.075);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}
