import {initial, advance, pushUphill, gateDistance} from './physics.mjs';
import {doorScore} from './door-score.mjs';

export function replay(seed, events, elapsed) {
  if (!Array.isArray(events) || events.length > 30000 || !Number.isFinite(elapsed) || elapsed < 0) return null;
  const s = initial(null, seed);
  s.speed = 2.02;
  let steps = 0, pushesThisStep = 0;
  for (const pair of events) {
    if (s.over || !Array.isArray(pair) || pair.length !== 2) return null;
    const [op, n] = pair;
    if (!Number.isFinite(n)) return null;
    if (op === 'gap') {
      if (n <= 0 || n > s.timeLeft) return null;
      s.raceTicks += n;
      s.timeLeft -= n;
      s.over = s.timeLeft === 0;
    } else if (op === 'push') {
      if (++pushesThisStep > 10 || (n !== -1 && n !== 1) || !pushUphill(s, n)) return null;
    } else {
      if (![-1, 0, 1].includes(op) || !Number.isSafeInteger(n) || n < 1) return null;
      steps += n;
      if (steps > 108000 || s.raceTicks + n > elapsed * 60 + 8) return null;
      for (let j = 0; j < n; j++) {
        if (s.over) return null;
        advance(s, op);
        pushesThisStep = 0;
      }
    }
    if (s.raceTicks > elapsed * 60 + 8) return null;
  }
  return s.over ? doorScore(s, gateDistance) : null;
}
