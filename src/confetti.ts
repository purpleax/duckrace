interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  spin: number;
  color: string;
}

const COLORS = ['#ffc93c', '#ff6b6b', '#4ecdc4', '#5b8def', '#ff9f1c', '#b388eb', '#ffffff'];

let pieces: Piece[] = [];
let last = 0;

export function burst(width: number, height: number): void {
  for (let i = 0; i < 160; i++) {
    const fromLeft = i % 2 === 0;
    pieces.push({
      x: fromLeft ? 0 : width,
      y: height * 0.75,
      vx: (fromLeft ? 1 : -1) * (width * 0.25 + Math.random() * width * 0.55),
      vy: -(height * 0.7 + Math.random() * height * 0.9),
      size: 6 + Math.random() * 8,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 12,
      color: COLORS[i % COLORS.length],
    });
  }
}

export function clearConfetti(): void {
  pieces = [];
}

export function drawConfetti(ctx: CanvasRenderingContext2D, width: number, height: number, now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  ctx.clearRect(0, 0, width, height);
  if (!pieces.length) return;
  const gravity = height * 1.6;
  for (const p of pieces) {
    p.vy += gravity * dt;
    p.vx *= 1 - 0.9 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.spin * dt;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    ctx.restore();
  }
  pieces = pieces.filter((p) => p.y < height + 40);
}
