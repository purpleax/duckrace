import type { Race } from './raceEngine';

const pick = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)];

/** Minimum time a call stays up before an ordinary call can replace it. */
const MIN_GAP_MS = 3500;
const FILLER_AFTER_MS = 6500;
const CHECK_EVERY_MS = 300;

/**
 * Watches a race and produces short race-caller lines: lead changes, runs from
 * the back, a tiring leader, and the halfway and final-stretch marks.
 */
export class RaceCaller {
  private leader = -1;
  private surging = new Set<number>();
  private leaderTiring = false;
  private caught = new Set<number>();
  private calledHalfway = false;
  private calledStretch = false;
  private lastCall = 0;
  private lastCheck = 0;

  /** Returns a new line to show, or null if there is nothing new to say. */
  update(race: Race, names: string[], t: number, now: number): string | null {
    if (now - this.lastCheck < CHECK_EVERY_MS || t < 3 || t >= race.duration) return null;
    this.lastCheck = now;

    const rank = race.ranking(t);
    const lead = rank[0];
    const name = (i: number): string => names[i];
    let line: string | null = null;
    let urgent = false;

    // Milestones always get called.
    if (!this.calledStretch && t >= race.duration - race.stretch) {
      this.calledStretch = true;
      this.calledHalfway = true;
      line = `Into the final stretch and it's ${name(lead)} in front!`;
      urgent = true;
    } else if (!this.calledHalfway && t >= race.duration / 2) {
      this.calledHalfway = true;
      line = rank.length > 1 ? `Halfway! ${name(lead)} leads from ${name(rank[1])}` : `Halfway!`;
      urgent = true;
    }

    // River hazards and boosts.
    for (const duck of rank) {
      const effect = race.effect(duck, t);
      if (!effect) {
        this.caught.delete(duck);
      } else if (!this.caught.has(duck)) {
        this.caught.add(duck);
        if (!line) {
          line =
            effect === 'whirlpool'
              ? `${name(duck)} is caught in a whirlpool!`
              : effect === 'lilypad'
                ? `${name(duck)} is stuck on a lily pad!`
                : `${name(duck)} catches the current!`;
        }
      }
    }

    // Lead changes.
    const previous = this.leader;
    if (lead !== previous) {
      this.leader = lead;
      this.leaderTiring = false;
      if (!line && previous !== -1) {
        line = pick([
          `${name(lead)} hits the front!`,
          `${name(lead)} takes the lead!`,
          `It's ${name(lead)} in front now!`,
          `${name(lead)} sweeps past ${name(previous)}!`,
        ]);
      }
    }

    // Runs from behind.
    rank.forEach((duck, place) => {
      const pace = race.pace(duck, t);
      if (pace > 1.35 && !this.surging.has(duck)) {
        this.surging.add(duck);
        if (line || place === 0) return;
        if (place >= Math.max(4, Math.floor(rank.length / 2))) {
          line = pick([
            `${name(duck)} is flying home from the back!`,
            `Here comes ${name(duck)} down the outside!`,
            `Look at ${name(duck)} go!`,
          ]);
        } else {
          line = pick([`${name(duck)} is closing on ${name(lead)}!`, `${name(duck)} is making a move!`]);
        }
      } else if (pace < 1.15) {
        this.surging.delete(duck);
      }
    });

    // A tiring leader.
    if (!line && !this.leaderTiring && rank.length > 1 && race.pace(lead, t) < 0.72) {
      this.leaderTiring = true;
      line = pick([`${name(lead)} is tiring, the pack is closing!`, `${name(lead)} is starting to paddle in treacle!`]);
    }

    // Something to say when it has gone quiet.
    if (!line && now - this.lastCall > FILLER_AFTER_MS && rank.length > 1) {
      const gap = race.progress(lead, t) - race.progress(rank[1], t);
      if (gap < 0.004) line = `${name(lead)} and ${name(rank[1])} are neck and neck!`;
      else if (rank.length > 2) line = `${name(lead)} leads from ${name(rank[1])} and ${name(rank[2])}`;
      else line = `${name(lead)} leads from ${name(rank[1])}`;
    }

    if (!line || (!urgent && now - this.lastCall < MIN_GAP_MS)) return null;
    this.lastCall = now;
    return line;
  }
}
