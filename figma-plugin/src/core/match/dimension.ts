import type { Token } from '../tokens/types';
import type { Classification } from './types';

export const DEFAULT_ROOT_FONT_SIZE = 16;

// Exact-match epsilon in px to absorb float noise (e.g. 0.5rem vs 8px).
const EXACT_EPSILON_PX = 0.01;

export interface DimensionMatchOptions {
  rootFontSize?: number;
}

// Used for spacing, fontSize, and radius. Exact match with rem↔px normalized at
// the root font size, so there is no near-match band: values are either an exact
// match or an orphan.
export function matchDimension(
  observed: string | number,
  tokens: Token[],
  options: DimensionMatchOptions = {},
): Classification {
  const rootFontSize = options.rootFontSize ?? DEFAULT_ROOT_FONT_SIZE;

  const observedPx = toPx(observed, rootFontSize);
  if (observedPx === null) {
    return { kind: 'orphan' };
  }

  let nearest: Token | undefined;
  let nearestAbs = Infinity;
  let nearestSigned = 0;
  for (const token of tokens) {
    const tokenPx = toPx(token.value, rootFontSize);
    if (tokenPx === null) continue;
    const signed = observedPx - tokenPx;
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
  if (nearestAbs <= EXACT_EPSILON_PX) {
    return { kind: 'match', token: nearest, distance: 0 };
  }
  return {
    kind: 'orphan',
    token: nearest,
    distance: nearestAbs,
    deltaLabel: formatPxDelta(nearestSigned),
  };
}

// Normalizes a dimension to px. Supports px, rem, and bare numbers (treated as
// px, including a unitless 0). Other units are not comparable and return null.
export function toPx(value: string | number, rootFontSize: number): number | null {
  if (typeof value === 'number') return value;
  const match = /^(-?\d*\.?\d+)(px|rem)?$/.exec(value.trim().toLowerCase());
  if (!match) return null;
  const amount = parseFloat(match[1]);
  return match[2] === 'rem' ? amount * rootFontSize : amount;
}

function formatPxDelta(signed: number): string {
  const rounded = Math.round(signed * 100) / 100;
  return `${rounded >= 0 ? '+' : ''}${rounded}px`;
}
