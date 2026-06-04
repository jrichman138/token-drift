import type { Token } from '../tokens/types';
import type { Classification } from './types';

const KEYWORD_WEIGHTS: Record<string, number> = { normal: 400, bold: 700 };

// Exact match. Relative keywords (lighter/bolder) can't be resolved without
// context and are treated as not comparable.
export function matchFontWeight(observed: string | number, tokens: Token[]): Classification {
  const observedWeight = toWeight(observed);
  if (observedWeight === null) {
    return { kind: 'orphan' };
  }

  let nearest: Token | undefined;
  let nearestAbs = Infinity;
  let nearestSigned = 0;
  for (const token of tokens) {
    const tokenWeight = toWeight(token.value);
    if (tokenWeight === null) continue;
    const signed = observedWeight - tokenWeight;
    const abs = Math.abs(signed);
    if (abs < nearestAbs) {
      nearestAbs = abs;
      nearestSigned = signed;
      nearest = token;
    }
  }

  if (!nearest) {
    return { kind: 'orphan' };
  }
  if (nearestAbs === 0) {
    return { kind: 'match', token: nearest, distance: 0 };
  }
  return {
    kind: 'orphan',
    token: nearest,
    distance: nearestAbs,
    deltaLabel: `${nearestSigned >= 0 ? '+' : ''}${nearestSigned}`,
  };
}

function toWeight(value: string | number): number | null {
  if (typeof value === 'number') return value;
  const trimmed = value.trim().toLowerCase();
  if (trimmed in KEYWORD_WEIGHTS) return KEYWORD_WEIGHTS[trimmed];
  const num = Number(trimmed);
  return Number.isFinite(num) && trimmed !== '' ? num : null;
}
