export function doorScore(s, gateAt) {
  const previous = s.course.previous;
  const start = previous ? gateAt({course: {current: previous}}) : 0;
  const fraction = (s.d - start) / (gateAt(s) - start);
  return {doors: s.gate - 1, progress: Math.max(0, Math.min(99, Math.floor(100 * fraction)))};
}
