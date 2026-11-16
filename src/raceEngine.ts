import { randFloat, shuffle } from './random';

export type HazardKind = 'whirlpool' | 'current' | 'lilypad';

export interface Hazard {
  duck: number;
  kind: HazardKind;
  /** Track position (0 to 1) where the hazard sits in the duck's lane. */
  at: number;
  /** Race seconds during which the duck is affected. */
  from: number;
  to: number;
}

export interface RaceOptions {
  /** Scatter whirlpools, lily pads and fast currents along the river. */
  hazards?: boolean;
}

export interface Race {
  count: number;
  /** Seconds until the winner crosses the line. */
  duration: number;
  /** Entrant indices in finishing order; order[0] is the winner. */
  order: number[];
  /** Seconds at which each entrant crosses the line. */
  finishTime: number[];
  lastFinish: number;
  /** Length in seconds of the final stretch before the winner finishes. */
  stretch: number;
  /** True when first and second are separated by a beak at the line. */
  photoFinish: boolean;
  hazards: Hazard[];
  /** The hazard entrant i is caught in at time t, if any. */
  effect(i: number, t: number): HazardKind | null;
  /** Fraction of the track covered by entrant i at time t (1 = finish line). */
  progress(i: number, t: number): number;
  /** Entrant i's current speed relative to an even pace (1 = cruising, about 1.4+ = surging, under 0.7 = fading). */
  pace(i: number, t: number): number;
  /** Entrant indices sorted by current position, leader first. */
  ranking(t: number): number[];
}

/** Average of the random speed draws below; used to judge who is ahead of an even pace. */
const MEAN_SPEED = 1.08;
const SURGE_CHANCE = 0.12;
/** Surges come more often once the field is in the final stretch. */
const STRETCH_SURGE_CHANCE = 0.26;
const FADE_CHANCE = 0.1;
/** How hard a duck that has got ahead is reined in (and a straggler helped), keeping the pack on screen. */
const RUBBER_BAND = 12;
/** Share of races decided by a photo finish. */
const PHOTO_FINISH_CHANCE = 0.25;
const HAZARD_KINDS: HazardKind[] = ['whirlpool', 'current', 'lilypad'];

interface Profile {
  /** Speed at each knot; speed is interpolated linearly between knots. */
  speed: Float64Array;
  /** Distance covered up to each knot, in knot-interval units. */
  covered: Float64Array;
  /** Knots at which this duck meets a hazard. */
  events: { knot: number; kind: HazardKind }[];
}

function buildProfile(knots: number, stretchKnot: number, hazardChance: number): Profile {
  const events: Profile['events'] = [];
  const firstHazardKnot = Math.ceil(knots * 0.18);
  const speed = new Float64Array(knots + 1);
  const covered = new Float64Array(knots + 1);
  let hold = 0; // knots left to hold the current surge or fade
  let held = 1;
  for (let k = 0; k <= knots; k++) {
    let v: number;
    if (hold > 0) {
      v = held;
      hold--;
    } else if (hazardChance > 0 && k >= firstHazardKnot && k < knots - 2 && randFloat() < hazardChance) {
      const kind = HAZARD_KINDS[Math.floor(randFloat() * HAZARD_KINDS.length)];
      // A current flings the duck forward; a whirlpool or lily pad all but stops it.
      v = held = kind === 'current' ? 2 : 0.3;
      hold = 1;
      events.push({ knot: k, kind });
    } else {
      const surgeChance = k >= stretchKnot ? STRETCH_SURGE_CHANCE : SURGE_CHANCE;
      const roll = randFloat();
      if (roll < surgeChance) {
        // A surge builds, holds for a moment, then eases off: a strong kick, not a rocket.
        v = held = 1.45 + randFloat() * 0.45;
        hold = 1;
      } else if (roll < surgeChance + FADE_CHANCE) {
        v = held = 0.55 + randFloat() * 0.15;
        hold = 1;
      } else {
        v = 0.75 + randFloat() * 0.5;
      }
    }
    // Fraction of the track this duck is ahead of (or behind) an even pace.
    const ahead = k > 0 ? (covered[k - 1] - (k - 1) * MEAN_SPEED) / (knots * MEAN_SPEED) : 0;
    v *= Math.exp(-RUBBER_BAND * ahead);
    speed[k] = Math.min(2.4, Math.max(0.3, v));
    if (k > 0) covered[k] = covered[k - 1] + (speed[k - 1] + speed[k]) / 2;
  }
  return { speed, covered, events };
}

/**
 * The finishing order is drawn first with a fair shuffle. Each duck then gets
 * its own run of surges, fades and cruising, scaled so that it reaches the line
 * exactly at its finishing time. The race is unpredictable to watch, but the
 * result is exactly the shuffled order.
 */
export function createRace(count: number, duration: number, options: RaceOptions = {}): Race {
  const order = shuffle(Array.from({ length: count }, (_, i) => i));
  const spread = Math.min(8, Math.max(2, duration * 0.15));

  const finishTime = new Array<number>(count);
  // Most races have a clear winner; about a quarter go down to the wire.
  const photoFinish = count > 1 && randFloat() < PHOTO_FINISH_CHANCE;
  const margin = photoFinish ? 0.03 + randFloat() * 0.06 : 0.5 + randFloat() * 0.8;
  order.forEach((duck, place) => {
    if (place === 0) {
      finishTime[duck] = duration;
    } else {
      const frac = count > 2 ? (place - 1) / (count - 2) : 0;
      finishTime[duck] = duration + margin + spread * Math.pow(frac, 0.8);
    }
  });

  // A change of pace every few seconds, however long the race is.
  const interval = Math.min(3.5, Math.max(1.2, duration / 40));
  const knots = Math.max(6, Math.round(duration / interval));
  const stretch = Math.min(15, duration * 0.25);
  const stretchKnot = Math.floor(((duration - stretch) / duration) * knots);
  // Aim for a lively but not cluttered river, whatever the size of the field.
  const hazardTarget = Math.min(24, Math.max(6, count));
  const hazardChance = options.hazards ? hazardTarget / (count * knots) : 0;
  const profiles = Array.from({ length: count }, () => buildProfile(knots, stretchKnot, hazardChance));

  const locate = (i: number, t: number): { k: number; f: number } => {
    const x = (Math.max(0, t) / finishTime[i]) * knots;
    const k = Math.min(knots - 1, Math.floor(x));
    return { k, f: x - k };
  };

  const progress = (i: number, t: number): number => {
    const u = Math.max(0, t) / finishTime[i];
    if (u >= 1) return u;
    const { speed, covered } = profiles[i];
    const { k, f } = locate(i, t);
    const partial = speed[k] * f + ((speed[k + 1] - speed[k]) * f * f) / 2;
    return Math.min((covered[k] + partial) / covered[knots], 1 - 1e-9);
  };

  const pace = (i: number, t: number): number => {
    if (t <= 0 || t >= finishTime[i]) return 1;
    const { speed, covered } = profiles[i];
    const { k, f } = locate(i, t);
    return ((speed[k] + (speed[k + 1] - speed[k]) * f) * knots) / covered[knots];
  };

  const hazards: Hazard[] = [];
  const hazardsByDuck: Hazard[][] = profiles.map(() => []);
  profiles.forEach((profile, duck) => {
    const step = finishTime[duck] / knots;
    for (const { knot, kind } of profile.events) {
      const hazard = { duck, kind, at: progress(duck, (knot + 0.5) * step), from: (knot - 0.4) * step, to: (knot + 1.4) * step };
      hazards.push(hazard);
      hazardsByDuck[duck].push(hazard);
    }
  });

  const effect = (i: number, t: number): HazardKind | null => {
    for (const h of hazardsByDuck[i]) if (t >= h.from && t <= h.to) return h.kind;
    return null;
  };

  const ranking = (t: number): number[] => {
    const pos = Array.from({ length: count }, (_, i) => progress(i, t));
    return Array.from({ length: count }, (_, i) => i).sort((a, b) => pos[b] - pos[a]);
  };

  return {
    count,
    duration,
    order,
    finishTime,
    lastFinish: duration + (count > 1 ? margin + spread : 0),
    stretch,
    photoFinish,
    hazards,
    effect,
    progress,
    pace,
    ranking,
  };
}
