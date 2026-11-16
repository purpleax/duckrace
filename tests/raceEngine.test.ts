import { describe, expect, it } from 'vitest';
import { createRace } from '../src/raceEngine';
import { randInt, shuffle } from '../src/random';

describe('random', () => {
  it('randInt stays in range', () => {
    for (let i = 0; i < 2000; i++) {
      const v = randInt(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
  });

  it('shuffle returns a permutation', () => {
    const src = Array.from({ length: 50 }, (_, i) => i);
    expect(shuffle(src).sort((a, b) => a - b)).toEqual(src);
  });
});

describe('createRace', () => {
  it('finishing order is a permutation and matches finish times', () => {
    const race = createRace(40, 30);
    expect(race.order.slice().sort((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, i) => i));
    for (let k = 1; k < race.order.length; k++) {
      expect(race.finishTime[race.order[k]]).toBeGreaterThan(race.finishTime[race.order[k - 1]]);
    }
  });

  it('only the winner has reached the line at the chosen time', () => {
    const race = createRace(25, 20);
    const winner = race.order[0];
    expect(race.progress(winner, 20)).toBeCloseTo(1, 9);
    for (let i = 0; i < 25; i++) {
      if (i !== winner) expect(race.progress(i, 20)).toBeLessThan(1);
    }
    expect(race.ranking(20)[0]).toBe(winner);
  });

  it('every duck starts at zero and never swims backwards', () => {
    const race = createRace(30, 15);
    for (let i = 0; i < 30; i++) {
      expect(race.progress(i, 0)).toBe(0);
      let prev = 0;
      for (let t = 0.05; t <= race.lastFinish + 2; t += 0.05) {
        const p = race.progress(i, t);
        expect(p).toBeGreaterThan(prev);
        prev = p;
      }
    }
  });

  it('ranking after everyone finishes equals the drawn order', () => {
    const race = createRace(60, 10);
    expect(race.ranking(race.lastFinish + 1)).toEqual(race.order);
  });

  it('the lead changes during a race', () => {
    let changes = 0;
    for (let r = 0; r < 20; r++) {
      const race = createRace(10, 30);
      let leader = -1;
      for (let t = 1; t < 30; t += 0.25) {
        const now = race.ranking(t)[0];
        if (leader !== -1 && now !== leader) changes++;
        leader = now;
      }
    }
    expect(changes).toBeGreaterThan(20);
  });

  it('ducks surge and fade but the pack stays together', () => {
    let surges = 0;
    let fades = 0;
    let widest = 0;
    for (let r = 0; r < 10; r++) {
      const race = createRace(20, 120);
      for (let t = 2; t < 118; t += 0.5) {
        let lo = 1;
        let hi = 0;
        for (let i = 0; i < 20; i++) {
          const p = race.progress(i, t);
          lo = Math.min(lo, p);
          hi = Math.max(hi, p);
          const pace = race.pace(i, t);
          if (pace > 1.35) surges++;
          if (pace < 0.7) fades++;
        }
        widest = Math.max(widest, hi - lo);
      }
    }
    expect(surges).toBeGreaterThan(500);
    expect(fades).toBeGreaterThan(500);
    expect(widest).toBeLessThan(0.3);
  });

  it('about a quarter of races are photo finishes', () => {
    let photos = 0;
    for (let r = 0; r < 2000; r++) {
      const race = createRace(8, 60);
      const gap = race.finishTime[race.order[1]] - race.finishTime[race.order[0]];
      if (race.photoFinish) {
        photos++;
        expect(gap).toBeLessThan(0.1);
      } else {
        expect(gap).toBeGreaterThanOrEqual(0.5);
      }
    }
    expect(photos).toBeGreaterThan(400);
    expect(photos).toBeLessThan(600);
  });

  it('hazards slow or boost ducks without changing the result', () => {
    const race = createRace(20, 60, { hazards: true });
    expect(race.hazards.length).toBeGreaterThan(0);
    expect(createRace(20, 60).hazards.length).toBe(0);
    for (const h of race.hazards) {
      expect(h.at).toBeGreaterThan(0);
      expect(h.at).toBeLessThan(1);
      expect(race.effect(h.duck, (h.from + h.to) / 2)).toBe(h.kind);
    }
    for (let i = 0; i < 20; i++) {
      let prev = 0;
      for (let t = 0.05; t <= race.lastFinish + 1; t += 0.05) {
        const p = race.progress(i, t);
        expect(p).toBeGreaterThan(prev);
        prev = p;
      }
    }
    expect(race.ranking(race.lastFinish + 1)).toEqual(race.order);
  });

  it('every duck wins about equally often', () => {
    const ducks = 6;
    const runs = 6000;
    const wins = new Array(ducks).fill(0);
    for (let r = 0; r < runs; r++) wins[createRace(ducks, 10).order[0]]++;
    for (const w of wins) {
      expect(w).toBeGreaterThan(850);
      expect(w).toBeLessThan(1150);
    }
  });
});
