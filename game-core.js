// Shared game rules. The browser uses this to play, and the server uses the
// exact same code to replay a game and work out the real score.
// Everything here must be deterministic: no Math.random, no Date, no Math.sin.

export const W = 420, H = 680;
export const TICK = 1 / 60;            // fixed 60 steps per second
export const MAX_STEP = 15;            // max truck movement per tick (900 px/s)
export const MIN_X = 45, MAX_X = W - 45;
export const TRUCK_Y = H - 95;
export const LEVEL_SECS = 20;
export const MAX_TICKS = 60 * 60 * 45; // 45 minutes, far beyond any real game

export const KINDS = [
  { e: '📦', pts: 10 },
  { e: '🎁', pts: 25 },
  { e: '⭐', pts: 50 },
  { e: '☕', cocoa: true },
  { e: '❤️', life: true },
  { e: '💥', bad: true },
];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newGame(seed) {
  return {
    rand: rng(seed), x: W / 2, score: 0, lives: 3, caught: 0, missed: 0,
    time: 0, ticks: 0, level: 1, items: [], spawn: 1, combo: 0, best: 0,
    slow: 0, over: false, nextId: 1,
  };
}

function weights(s) {
  return [50, 22, 6, 4, s.lives < 5 ? 2 : 0, 10 + s.level * 4];
}
function pickKind(s) {
  const w = weights(s);
  let r = s.rand() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < w.length; i++) if ((r -= w[i]) < 0) return i;
  return 0;
}

export function clampX(prev, want) {
  let x = Math.round(want);
  if (x > prev + MAX_STEP) x = prev + MAX_STEP;
  if (x < prev - MAX_STEP) x = prev - MAX_STEP;
  return Math.max(MIN_X, Math.min(MAX_X, x));
}

// Advance one tick. wantX = where the player wants the truck.
// Returns a list of events for the renderer (sounds, pop-ups, shake).
export function step(s, wantX) {
  const ev = [];
  if (s.over) return ev;
  s.ticks++;
  const f = s.slow > 0 ? 0.45 : 1;
  s.slow = Math.max(0, s.slow - TICK);
  const dt = TICK * f;
  s.time += dt;

  const lv = 1 + Math.floor(s.time / LEVEL_SECS);
  if (lv > s.level) { s.level = lv; ev.push({ type: 'level', level: lv }); }

  s.x = clampX(s.x, wantX);

  s.spawn -= dt;
  if (s.spawn <= 0) {
    const gap = Math.max(0.28, 0.9 - s.time * 0.006);
    s.spawn = gap * (0.6 + s.rand() * 0.8);
    const speed = Math.min(620, 150 + s.time * 3.2);
    const n = s.level >= 5 && s.rand() < Math.min(0.5, (s.level - 4) * 0.12) ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const kind = pickKind(s);
      const drift = s.level >= 3 ? (s.rand() - 0.5) * Math.min(140, (s.level - 2) * 30) : 0;
      s.items.push({
        id: s.nextId++, kind, x: 30 + s.rand() * (W - 60), y: 40 - i * 60,
        v: speed * (0.85 + s.rand() * 0.3), dx: drift,
      });
    }
  }

  for (const it of s.items) {
    it.y += it.v * dt; it.x += it.dx * dt;
    if (it.x < 20 || it.x > W - 20) it.dx = -it.dx;
    const k = KINDS[it.kind];
    if (!it.done && it.y > TRUCK_Y - 10 && it.y < TRUCK_Y + 25 && Math.abs(it.x - s.x) < 50) {
      it.done = true;
      if (k.bad) { s.lives--; s.combo = 0; ev.push({ type: 'bad', x: it.x, y: it.y }); }
      else if (k.cocoa) { s.slow = 5; ev.push({ type: 'cocoa', x: it.x, y: it.y }); }
      else if (k.life) { s.lives = Math.min(5, s.lives + 1); ev.push({ type: 'life', x: it.x, y: it.y }); }
      else {
        s.combo++; s.best = Math.max(s.best, s.combo);
        const m = 1 + Math.floor(s.combo / 10), g = k.pts * m;
        s.score += g; s.caught++;
        ev.push({ type: 'catch', x: it.x, y: it.y, pts: g, mult: m });
      }
    }
    if (!it.done && it.y > H - 40) {
      it.done = true;
      if (k.pts) { s.missed++; s.lives--; s.combo = 0; ev.push({ type: 'drop', x: it.x, y: H - 60 }); }
    }
  }
  s.items = s.items.filter(i => !i.done);
  if (s.lives <= 0) { s.over = true; ev.push({ type: 'over' }); }
  return ev;
}

// Replay compression: truck positions stored as [change, howManyTicks] pairs.
export function encodeMoves(xs) {
  const out = []; let prev = W / 2;
  for (const x of xs) {
    const d = x - prev; prev = x;
    const last = out.length - 2;
    if (last >= 0 && out[last] === d) out[last + 1]++;
    else out.push(d, 1);
  }
  return out;
}
export function decodeMoves(pairs) {
  const xs = []; let x = W / 2;
  for (let i = 0; i < pairs.length; i += 2) {
    const d = pairs[i], n = pairs[i + 1];
    if (!Number.isInteger(d) || !Number.isInteger(n) || n < 1) return null;
    if (xs.length + n > MAX_TICKS) return null;
    for (let j = 0; j < n; j++) { x += d; xs.push(x); }
  }
  return xs;
}

// Server side: replay the whole game and return the true result, or null if the
// replay is impossible (truck teleporting, game not finished, and so on).
export function verify(seed, pairs) {
  const xs = decodeMoves(pairs);
  if (!xs || !xs.length) return null;
  const s = newGame(seed);
  for (let i = 0; i < xs.length; i++) {
    if (s.over) return null;                   // moves after the game ended
    const before = s.x;
    step(s, xs[i]);
    if (s.x !== xs[i]) return null;            // moved faster than allowed
    if (Math.abs(xs[i] - before) > MAX_STEP) return null;
  }
  if (!s.over) return null;                    // game never actually ended
  return { score: s.score, level: s.level, ticks: s.ticks, caught: s.caught, best: s.best };
}
