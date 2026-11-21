import './style.css';
import { beep, fanfare, horn, quack, setMuted, tick } from './audio';
import { RaceCaller } from './commentary';
import { burst, clearConfetti, drawConfetti } from './confetti';
import { createRace, type Race } from './raceEngine';
import { randFloat, randInt, shuffle } from './random';
import { drawRace, drawWheel, duckPortrait, PHOTO_FINISH_LEAD } from './scene';
import { clamp, getEntrants, MAX_DURATION, MAX_ENTRANTS, MIN_DURATION, parseNames, save, state } from './store';

type Phase = 'idle' | 'countdown' | 'racing' | 'finished' | 'spinning' | 'spun';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const stage = $('stage');
const canvas = $<HTMLCanvasElement>('scene');
const confettiCanvas = $<HTMLCanvasElement>('confetti');
const ctx = canvas.getContext('2d')!;
const confettiCtx = confettiCanvas.getContext('2d')!;

const hud = $('hud');
const timerEl = $('timer');
const leadersEl = $('leaders');
const countdownEl = $('countdown');
const startEl = $('start');
const goBtn = $<HTMLButtonElement>('go');
const hintEl = $('hint');
const resultsEl = $('results');
const winnerEl = $('winner');
const placingsEl = $('placings');
const podiumEl = $('podium');
const callerEl = $('caller');
const bannerEl = $('banner');
const flashEl = $('flash');
const againBtn = $<HTMLButtonElement>('again');
const editBtn = $<HTMLButtonElement>('edit');
const pauseBtn = $<HTMLButtonElement>('pause');
const clearBtn = $<HTMLButtonElement>('clear');
const clearResultBtn = $<HTMLButtonElement>('clear-result');
const muteBtn = $<HTMLButtonElement>('mute');
const fullscreenBtn = $<HTMLButtonElement>('fullscreen');
const namesEl = $<HTMLTextAreaElement>('names');
const namesNote = $('names-note');
const durationEl = $<HTMLInputElement>('duration');
const hazardsEl = $<HTMLInputElement>('hazards');
const commentaryEl = $<HTMLInputElement>('commentary');
const countEl = $('count');
const listNameEl = $<HTMLInputElement>('list-name');
const savedEl = $('saved');
const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.tabs button'));
const presetBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('#presets button'));

let W = 0;
let H = 0;
let phase: Phase = 'idle';
let entrants = getEntrants();

// Race state.
let race: Race | null = null;
let raceNames: string[] = [];
let lanes: number[] = [];
/** Race clock in seconds; it runs slow through the photo finish. */
let raceT = 0;
let lastFrame = 0;
let caller = new RaceCaller();
let callerUntil = 0;
let inStretch = false;
let inSlowMo = false;
/** Each duck's place a couple of seconds ago, for the leaderboard arrows. */
let placeBefore: number[] = [];
let placeSnapshotAt = 0;
let nextQuack = 0;
let lastHud = 0;
let runId = 0;
let paused = false;

// Wheel state.
let wheelRot = 0;
let wheelNames: string[] = [];
let spin: { from: number; to: number; start: number; dur: number; winner: number } | null = null;
let lastSlice = -1;
let lastTick = 0;

const busy = (): boolean => phase === 'countdown' || phase === 'racing' || phase === 'spinning';

function resize(): void {
  const rect = stage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = Math.max(1, rect.width);
  H = Math.max(1, rect.height);
  for (const c of [canvas, confettiCanvas]) {
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  confettiCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}

/** Reflects the current phase, view and settings in the DOM. */
function render(): void {
  const isRace = state.view === 'race';
  stage.dataset.view = state.view;
  // Once a race or spin starts, the stage takes over the whole screen.
  document.body.classList.toggle('immersive', phase !== 'idle');
  for (const t of tabs) {
    t.setAttribute('aria-selected', String(t.dataset.view === state.view));
    t.disabled = busy();
  }
  for (const b of presetBtns) b.classList.toggle('on', Number(b.dataset.seconds) === state.duration);
  $('time-card').hidden = !isRace;

  const n = entrants.length;
  countEl.textContent = `${n} name${n === 1 ? '' : 's'}`;
  const typed = parseNames(state.names).length;
  namesNote.textContent = typed > MAX_ENTRANTS ? `Only the first ${MAX_ENTRANTS} names are used.` : '';

  startEl.hidden = phase !== 'idle';
  goBtn.textContent = isRace ? 'Start race' : 'Spin the wheel';
  goBtn.disabled = n < 2;
  hintEl.textContent = n < 2 ? 'Add at least 2 names to play.' : '';
  hud.hidden = !isRace;
  pauseBtn.hidden = phase !== 'racing';
  pauseBtn.textContent = paused ? 'Continue' : 'Pause';
  clearBtn.hidden = !(phase === 'countdown' || phase === 'racing' || phase === 'finished');
  resultsEl.hidden = !(phase === 'finished' || phase === 'spun') || !resultsEl.dataset.ready;
  againBtn.textContent = isRace ? 'Race again' : 'Spin again';
  muteBtn.textContent = state.muted ? '🔇' : '🔊';
  canvas.style.cursor = !isRace && phase === 'idle' && n >= 2 ? 'pointer' : 'default';

  if (phase === 'idle' && isRace) timerEl.textContent = formatTime(state.duration);
}

function renderSaved(): void {
  savedEl.replaceChildren(
    ...state.saved.map((list, index) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      const load = document.createElement('button');
      load.type = 'button';
      load.textContent = list.name;
      load.title = `Load "${list.name}"`;
      load.addEventListener('click', () => {
        state.names = list.names;
        namesEl.value = list.names;
        listNameEl.value = list.name;
        entrantsChanged();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '✕';
      remove.setAttribute('aria-label', `Delete saved list ${list.name}`);
      remove.addEventListener('click', () => {
        state.saved.splice(index, 1);
        save();
        renderSaved();
      });
      chip.append(load, remove);
      return chip;
    }),
  );
}

function reset(): void {
  runId++;
  phase = 'idle';
  race = null;
  spin = null;
  paused = false;
  raceT = 0;
  inStretch = false;
  inSlowMo = false;
  caller = new RaceCaller();
  placeBefore = [];
  callerEl.hidden = true;
  bannerEl.hidden = true;
  stage.classList.remove('stretch');
  leadersEl.replaceChildren();
  delete resultsEl.dataset.ready;
  countdownEl.hidden = true;
  clearConfetti();
}

function entrantsChanged(): void {
  entrants = getEntrants();
  save();
  if (!busy()) reset();
  render();
}

/** Shows a caller line. The winner's call is always shown; the rest only with commentary on. */
function say(line: string, now: number, always = false): void {
  if (!always && !state.commentary) return;
  callerEl.textContent = line;
  callerEl.hidden = false;
  callerEl.classList.remove('pop');
  void callerEl.offsetWidth;
  callerEl.classList.add('pop');
  callerUntil = now + 4500;
}

function showBanner(text: string, ms: number): void {
  const id = runId;
  bannerEl.textContent = text;
  bannerEl.hidden = false;
  bannerEl.classList.remove('pop');
  void bannerEl.offsetWidth;
  bannerEl.classList.add('pop');
  setTimeout(() => {
    if (id === runId && bannerEl.textContent === text) bannerEl.hidden = true;
  }, ms);
}

/** First, second and third on a podium, drawn with each duck's own look. */
function renderPodium(ducks: number[] | null): void {
  podiumEl.hidden = !ducks;
  if (!ducks) return;
  const steps = [1, 0, 2].filter((place) => place < ducks.length);
  podiumEl.replaceChildren(
    ...steps.map((place) => {
      const col = document.createElement('div');
      col.className = `step place-${place + 1}`;
      const name = document.createElement('div');
      name.className = 'step-name';
      name.textContent = raceNames[ducks[place]];
      const block = document.createElement('div');
      block.className = 'step-block';
      block.textContent = ['1st', '2nd', '3rd'][place];
      col.append(duckPortrait(ducks[place], place === 0 ? 46 : 38), name, block);
      return col;
    }),
  );
}

function showResults(winner: string, placings: string[] | null, podium: number[] | null = null): void {
  renderPodium(podium);
  winnerEl.textContent = winner;
  placingsEl.hidden = !placings;
  placingsEl.replaceChildren(
    ...(placings ?? []).map((name) => {
      const li = document.createElement('li');
      li.textContent = name;
      return li;
    }),
  );
  resultsEl.dataset.ready = '1';
  render();
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function startRace(): Promise<void> {
  if (busy() || entrants.length < 2) return;
  reset();
  const id = runId;
  raceNames = entrants.slice();
  lanes = shuffle(raceNames.map((_, i) => i));
  race = createRace(raceNames.length, state.duration, { hazards: state.hazards });
  phase = 'countdown';
  timerEl.textContent = formatTime(state.duration);
  leadersEl.replaceChildren();
  render();

  for (const label of ['3', '2', '1']) {
    countdownEl.textContent = label;
    countdownEl.hidden = false;
    countdownEl.classList.remove('pop');
    void countdownEl.offsetWidth;
    countdownEl.classList.add('pop');
    beep();
    await sleep(800);
    if (id !== runId) return;
  }
  countdownEl.textContent = 'GO!';
  countdownEl.classList.remove('pop');
  void countdownEl.offsetWidth;
  countdownEl.classList.add('pop');
  horn();
  quack();
  raceT = 0;
  nextQuack = performance.now() + 700;
  phase = 'racing';
  render();
  await sleep(700);
  if (id === runId) countdownEl.hidden = true;
}

function finishRace(): void {
  if (!race) return;
  const id = runId;
  const order = race.order.map((i) => raceNames[i]);
  const podium = race.order.slice(0, 3);
  phase = 'finished';
  fanfare();
  burst(W, H);
  flashEl.classList.remove('go');
  void flashEl.offsetWidth;
  flashEl.classList.add('go');
  say(race.photoFinish ? `${order[0]} WINS by a beak!` : `${order[0]} WINS!`, performance.now(), true);
  callerUntil = Infinity;
  render();
  setTimeout(() => {
    if (id !== runId) return;
    callerEl.hidden = true;
    showResults(order[0], order, podium);
  }, 3200);
}

function startSpin(): void {
  if (busy() || entrants.length < 2) return;
  reset();
  wheelNames = entrants.slice();
  const n = wheelNames.length;
  const arc = (Math.PI * 2) / n;
  const winner = randInt(n);
  // The pointer sits at angle 0, so the wheel must stop with the winner's slice there.
  const target = -(winner + 0.12 + randFloat() * 0.76) * arc;
  const turn = Math.PI * 2;
  const delta = ((((target - wheelRot) % turn) + turn) % turn) + turn * (6 + randInt(3));
  spin = { from: wheelRot, to: wheelRot + delta, start: performance.now(), dur: 6500, winner };
  lastSlice = -1;
  phase = 'spinning';
  render();
}

function finishSpin(): void {
  if (!spin) return;
  const id = runId;
  const name = wheelNames[spin.winner];
  wheelRot = spin.to % (Math.PI * 2);
  spin = null;
  phase = 'spun';
  fanfare();
  burst(W, H);
  render();
  setTimeout(() => {
    if (id === runId) showResults(name, null);
  }, 900);
}

function updateHud(t: number, now: number): void {
  if (!race || now - lastHud < 150) return;
  lastHud = now;
  timerEl.textContent = formatTime(race.duration - t);
  const rank = race.ranking(t);
  const top = rank.slice(0, Math.min(5, race.count));
  while (leadersEl.children.length < top.length) {
    const li = document.createElement('li');
    li.append(document.createElement('span'), document.createElement('b'));
    leadersEl.append(li);
  }
  top.forEach((duck, place) => {
    const [nameEl, arrowEl] = leadersEl.children[place].children;
    if (nameEl.textContent !== raceNames[duck]) nameEl.textContent = raceNames[duck];
    // Arrow shows whether this duck has moved up or down in the last couple of seconds.
    const before = placeBefore[duck] ?? place;
    const arrow = before > place ? '▲' : before < place ? '▼' : '';
    if (arrowEl.textContent !== arrow) {
      arrowEl.textContent = arrow;
      arrowEl.className = before > place ? 'up' : 'down';
    }
  });
  if (now - placeSnapshotAt > 2500) {
    placeSnapshotAt = now;
    rank.forEach((duck, place) => (placeBefore[duck] = place));
  }
}

function frame(now: number): void {
  const time = now / 1000;
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (state.view === 'race') {
    let t = 0;
    if (race && (phase === 'racing' || phase === 'finished')) {
      if (!paused) {
        // Slow motion as the leaders reach the line.
        const slow = race.photoFinish && raceT > race.duration - PHOTO_FINISH_LEAD && raceT < race.duration + 0.45;
        raceT += dt * (slow ? 0.3 : 1);
        if (slow && !inSlowMo) {
          inSlowMo = true;
          showBanner('PHOTO FINISH!', 2600);
        }
      }
      t = Math.min(raceT, race.lastFinish + 4);
      if (phase === 'racing' && !inStretch && t >= race.duration - race.stretch) {
        inStretch = true;
        stage.classList.add('stretch');
        showBanner('FINAL STRETCH!', 2400);
        beep(true);
      }
      if (phase === 'racing' && !paused) {
        const line = caller.update(race, raceNames, t, now);
        if (line) say(line, now);
      }
      if (now > callerUntil) callerEl.hidden = true;
      if (phase === 'racing' && t >= race.duration) finishRace();
      if (phase === 'racing' && !paused && now > nextQuack) {
        quack();
        nextQuack = now + 700 + Math.random() * 2200;
      }
      updateHud(t, now);
    }
    const idle = phase === 'idle';
    drawRace(ctx, W, H, {
      time,
      t,
      race: idle ? null : race,
      names: idle ? entrants : raceNames,
      lanes: idle ? entrants.map((_, i) => i) : lanes,
      duration: state.duration,
      moving: (phase === 'racing' && !paused) || (phase === 'finished' && !!race && t < race.lastFinish + 4),
    });
  } else {
    const names = phase === 'idle' ? entrants : wheelNames;
    if (spin) {
      const k = Math.min(1, (now - spin.start) / spin.dur);
      wheelRot = spin.from + (spin.to - spin.from) * (1 - Math.pow(1 - k, 4));
      const turn = Math.PI * 2;
      const slice = Math.floor(((((-wheelRot % turn) + turn) % turn) / turn) * names.length);
      if (slice !== lastSlice && now - lastTick > 35) {
        tick();
        lastTick = now;
      }
      lastSlice = slice;
      if (k >= 1) finishSpin();
    }
    drawWheel(ctx, W, H, names, wheelRot, time);
  }
  drawConfetti(confettiCtx, W, H, now);
  requestAnimationFrame(frame);
}

function go(): void {
  if (state.view === 'race') void startRace();
  else startSpin();
}

function togglePause(): void {
  if (phase !== 'racing') return;
  paused = !paused;
  render();
}

/** Back to the start line with the same names, ready to go again. */
function clearRace(): void {
  reset();
  render();
}

// Wiring.
pauseBtn.addEventListener('click', togglePause);
clearBtn.addEventListener('click', clearRace);
clearResultBtn.addEventListener('click', clearRace);
for (const t of tabs) {
  t.addEventListener('click', () => {
    if (busy() || t.dataset.view === state.view) return;
    state.view = t.dataset.view === 'wheel' ? 'wheel' : 'race';
    save();
    reset();
    render();
  });
}

namesEl.addEventListener('input', () => {
  state.names = namesEl.value;
  entrantsChanged();
});


function setDuration(seconds: number): void {
  state.duration = clamp(Math.round(seconds), MIN_DURATION, MAX_DURATION);
  save();
  render();
}
for (const b of presetBtns) {
  b.addEventListener('click', () => {
    setDuration(Number(b.dataset.seconds));
    durationEl.value = String(state.duration);
  });
}
durationEl.addEventListener('input', () => {
  const v = Number(durationEl.value);
  if (Number.isFinite(v) && v >= MIN_DURATION) setDuration(v);
});
hazardsEl.addEventListener('change', () => {
  state.hazards = hazardsEl.checked;
  save();
});
commentaryEl.addEventListener('change', () => {
  state.commentary = commentaryEl.checked;
  if (!state.commentary && phase !== 'finished') callerEl.hidden = true;
  save();
});

durationEl.addEventListener('change', () => {
  durationEl.value = String(state.duration);
});

$('save-list').addEventListener('click', () => {
  const name = listNameEl.value.trim();
  if (!name || !parseNames(state.names).length) {
    listNameEl.focus();
    return;
  }
  const existing = state.saved.find((l) => l.name === name);
  if (existing) existing.names = state.names;
  else state.saved.push({ name, names: state.names });
  save();
  renderSaved();
});

goBtn.addEventListener('click', go);
againBtn.addEventListener('click', go);
canvas.addEventListener('click', () => {
  if (state.view === 'wheel' && phase === 'idle') startSpin();
});

editBtn.addEventListener('click', () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  reset();
  render();
  namesEl.focus();
});

muteBtn.addEventListener('click', () => {
  state.muted = !state.muted;
  setMuted(state.muted);
  save();
  render();
});

fullscreenBtn.addEventListener('click', () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void stage.requestFullscreen?.();
});

new ResizeObserver(resize).observe(stage);

// Initial paint.
setMuted(state.muted);
namesEl.value = state.names;
durationEl.value = String(state.duration);
hazardsEl.checked = state.hazards;
commentaryEl.checked = state.commentary;
resize();
renderSaved();
render();
requestAnimationFrame(frame);
