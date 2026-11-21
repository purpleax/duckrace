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
/** Until this far through the race the field runs as a pack; after it the back markers drop away. */
const STRING_OUT_FROM = 0.4;
/** The most extra ground a back marker gives up by the time the winner finishes, as a share of the track. */
const MAX_GAP = 0.2;
/** How many places it takes to open most of that gap: big fields string out, small ones barely change. */
const GAP_PLACES = 18;
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

  // Outside a photo finish the field strings out from part-way through, so the
  // run to the line is not a scrum. A photo finish keeps everyone bunched.
  const splitTime = duration * STRING_OUT_FROM;
  const finishTime = new Array<number>(count);
  /** When each duck would finish if the field stayed bunched; sets its pace until the string-out. */
  const packTime = new Array<number>(count);
  /** The rate each duck's clock has slowed to by the time the winner finishes (0 = it never slows). */
  const lateRate = new Array<number>(count).fill(0);
  // Most races have a clear winner; about a quarter go down to the wire.
  const photoFinish = count > 1 && randFloat() < PHOTO_FINISH_CHANCE;
  const margin = photoFinish ? 0.03 + randFloat() * 0.06 : 0.5 + randFloat() * 0.8;

  // Each duck's run is laid out on its own clock, 0 at the start and 1 at the
  // line. The clock runs at the pack's rate until the string-out, eases down
  // until the winner is home, then holds that rate to the line.
  const clock = (i: number, t: number): number => {
    const pack = packTime[i];
    const late = lateRate[i];
    if (t <= splitTime || late === 0) return Math.max(0, t) / pack;
    const span = duration - splitTime;
    const dt = Math.min(t, duration) - splitTime;
    const u = splitTime / pack + dt / pack + ((late - 1 / pack) * dt * dt) / (2 * span);
    return t <= duration ? u : u + late * (t - duration);
  };
  /** How fast duck i's clock is running, relative to its pace in the pack. */
  const clockRate = (i: number, t: number): number => {
    const pack = packTime[i];
    const late = lateRate[i];
    if (t <= splitTime || late === 0) return 1;
    if (t >= duration) return late * pack;
    return 1 + ((late * pack - 1) * (t - splitTime)) / (duration - splitTime);
  };

  order.forEach((duck, place) => {
    if (place === 0) {
      finishTime[duck] = packTime[duck] = duration;
      return;
    }
    const frac = count > 2 ? (place - 1) / (count - 2) : 0;
    // In a photo finish the first two duel for the line with the rest of the field a clear step behind.
    const duel = photoFinish && place >= 2 ? Math.min(2.5, Math.max(1, duration * 0.04)) : 0;
    const pack = duration + margin + duel + spread * Math.pow(frac, 0.8);
    finishTime[duck] = packTime[duck] = pack;
    if (photoFinish) return;
    // Extra ground this duck gives up by the time the winner finishes, on top of
    // what the pack already costs it. Built so that a duck drawn further back is
    // always both further behind and slower, which keeps the finishing order.
    const extra = Math.min(MAX_GAP * (1 - Math.exp(-place / GAP_PLACES)), (0.24 * duration) / pack);
    const late = 1 / pack - (2 * extra) / (duration - splitTime);
    lateRate[duck] = late;
    finishTime[duck] = duration + (1 - duration / pack + extra) / late;
  });

  /** The race time at which duck i's clock reads u. */
  const timeAt = (i: number, u: number): number => {
    let lo = 0;
    let hi = finishTime[i];
    for (let n = 0; n < 40; n++) {
      const mid = (lo + hi) / 2;
      if (clock(i, mid) < u) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };

  // A change of pace every few seconds, however long the race is.
  const interval = Math.min(3.5, Math.max(1.2, duration / 40));
  const knots = Math.max(6, Math.round(duration / interval));
  const stretch = Math.min(15, duration * 0.25);
  const stretchKnot = Math.floor(((duration - stretch) / duration) * knots);
  // Aim for a lively but not cluttered river, whatever the size of the field.
  const hazardTarget = Math.min(24, Math.max(6, count));
  const hazardChance = options.hazards ? hazardTarget / (count * knots) : 0;
  let profiles = Array.from({ length: count }, () => buildProfile(knots, stretchKnot, hazardChance));

  const locate = (i: number, t: number): { k: number; f: number } => {
    const x = clock(i, t) * knots;
    const k = Math.min(knots - 1, Math.floor(x));
    return { k, f: x - k };
  };

  const progress = (i: number, t: number): number => {
    // Past the line every duck drifts on at its own average speed, which keeps the finishing order.
    if (t >= finishTime[i]) return t / finishTime[i];
    const { speed, covered } = profiles[i];
    const { k, f } = locate(i, t);
    const partial = speed[k] * f + ((speed[k + 1] - speed[k]) * f * f) / 2;
    return Math.min((covered[k] + partial) / covered[knots], 1 - 1e-9);
  };

  const pace = (i: number, t: number): number => {
    if (t <= 0 || t >= finishTime[i]) return 1;
    const { speed, covered } = profiles[i];
    const { k, f } = locate(i, t);
    return (((speed[k] + (speed[k + 1] - speed[k]) * f) * knots) / covered[knots]) * clockRate(i, t);
  };

  if (photoFinish) {
    // A photo finish has to look like one: the first two swim the closing
    // seconds stroke for stroke, level and in front of everyone else. Runs are
    // redrawn until that holds; the finishing order was fixed before any of this.
    const [first, second] = order;
    const shared = Math.min(knots - 1, Math.max(2, Math.ceil(4 / (duration / knots))));
    const watchFrom = duration - Math.min(2, duration * 0.3);
    const isDuel = (): boolean => {
      for (let t = watchFrom; t < duration; t += 0.1) {
        const a = progress(first, t);
        const b = progress(second, t);
        for (let i = 0; i < count; i++) {
          if (i !== first && i !== second && progress(i, t) >= Math.min(a, b)) return false;
        }
      }
      return true;
    };
    for (let tries = 0; tries < 60; tries++) {
      if (tries > 0) profiles = Array.from({ length: count }, () => buildProfile(knots, stretchKnot, hazardChance));
      const lead = profiles[first];
      const chase = profiles[second];
      for (let k = knots - shared; k <= knots; k++) {
        chase.speed[k] = lead.speed[k];
        chase.covered[k] = chase.covered[k - 1] + (chase.speed[k - 1] + chase.speed[k]) / 2;
      }
      chase.events = chase.events.filter((e) => e.knot < knots - shared - 1);
      if (isDuel()) break;
    }
  }

  const hazards: Hazard[] = [];
  const hazardsByDuck: Hazard[][] = profiles.map(() => []);
  profiles.forEach((profile, duck) => {
    const at = (k: number): number => timeAt(duck, k / knots);
    for (const { knot, kind } of profile.events) {
      const hazard = { duck, kind, at: progress(duck, at(knot + 0.5)), from: at(knot - 0.4), to: at(knot + 1.4) };
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
    lastFinish: Math.max(...finishTime),
    stretch,
    photoFinish,
    hazards,
    effect,
    progress,
    pace,
    ranking,
  };
}
