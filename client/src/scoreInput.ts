/**
 * Validate a typed gross score before it goes anywhere near the queue.
 *
 * Returns the strokes to store (null = clear the cell), or a message saying
 * why the input is refused. Nothing is clamped into a different score: a 0 is
 * not a 1, 2.5 is not a 2, 23 is not a 20. A player who didn't hole out uses
 * the explicit Pickup control instead.
 */
export type TypedScore = { ok: true; strokes: number | null } | { ok: false; message: string };

export function parseTypedScore(raw: string): TypedScore {
  const text = raw.trim();
  if (text === '') return { ok: true, strokes: null };
  if (!/^\d+$/.test(text)) {
    return { ok: false, message: 'Scores are whole numbers. If you didn’t hole out, use Pickup.' };
  }
  const n = Number(text);
  if (n === 0) {
    return { ok: false, message: '0 isn’t a score — tap Pickup if you didn’t hole out, or ✕ to clear.' };
  }
  if (n > 20) {
    return { ok: false, message: 'Scores go up to 20. Use Pickup for a hole you didn’t finish.' };
  }
  return { ok: true, strokes: n };
}
