export interface SavedList {
  name: string;
  names: string;
}

export interface State {
  view: 'race' | 'wheel';
  /** One name per line; shared by the duck race and the wheel. */
  names: string;
  /** Race length in seconds. */
  duration: number;
  muted: boolean;
  /** Whirlpools, lily pads and fast currents on the river. */
  hazards: boolean;
  /** The race caller's running commentary along the bottom of the race. */
  commentary: boolean;
  saved: SavedList[];
}

export const MAX_ENTRANTS = 200;
export const MIN_DURATION = 5;
export const MAX_DURATION = 600;

const KEY = 'pond-dash:v1';

const defaults: State = {
  view: 'race',
  names: ['Ava', 'Ben', 'Chloe', 'Dev', 'Ella', 'Finn', 'Grace', 'Hugo'].join('\n'),
  duration: 60,
  muted: false,
  hazards: false,
  commentary: false,
  saved: [],
};

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function load(): State {
  const s: State = { ...defaults };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (raw && typeof raw === 'object') {
      if (raw.view === 'race' || raw.view === 'wheel') s.view = raw.view;
      if (typeof raw.names === 'string') s.names = raw.names;
      if (Number.isFinite(raw.duration)) s.duration = clamp(Math.round(raw.duration), MIN_DURATION, MAX_DURATION);
      if (typeof raw.muted === 'boolean') s.muted = raw.muted;
      if (typeof raw.hazards === 'boolean') s.hazards = raw.hazards;
      if (typeof raw.commentary === 'boolean') s.commentary = raw.commentary;
      if (Array.isArray(raw.saved)) {
        s.saved = raw.saved.filter(
          (l: unknown): l is SavedList =>
            !!l && typeof (l as SavedList).name === 'string' && typeof (l as SavedList).names === 'string',
        );
      }
    }
  } catch {
    // Storage unavailable or corrupt: fall back to defaults.
  }
  return s;
}

export const state: State = load();

export function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Nothing to do: the game still works without persistence.
  }
}

export function parseNames(text: string): string[] {
  return text
    .split('\n')
    .map((n) => n.trim())
    .filter(Boolean);
}

/** The entrants used by both the duck race and the wheel. */
export function getEntrants(): string[] {
  return parseNames(state.names).slice(0, MAX_ENTRANTS);
}
