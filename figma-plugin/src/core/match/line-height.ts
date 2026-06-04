import type { Token } from '../tokens/types';
import type { Classification } from './types';

export const DEFAULT_LINE_HEIGHT_TOLERANCE = 0.05;

const UNITLESS_EXACT_EPSILON = 1e-6;
const PX_EXACT_EPSILON = 0.01;

export interface LineHeightMatchOptions {
  tolerance?: number;
}

// ±0.05 near-match band for unitless line heights, exact match for px. An
// observation may carry both a px value and a derived ratio ("<px>px / <ratio>");
// we match each form against tokens of its own unit and return the best result.
export function matchLineHeight(
  observed: string | number,
  tokens: Token[],
  options: LineHeightMatchOptions = {},
): Classification {
  const tolerance = options.tolerance ?? DEFAULT_LINE_HEIGHT_TOLERANCE;

  const observed_ = parseObserved(observed);
  if (!observed_) {
    return { kind: 'orphan' };
  }

  const candidates: Classification[] = [];
  if (observed_.px !== undefined) {
    candidates.push(matchChannel(observed_.px, 'px', tokens, tolerance));
  }
  if (observed_.ratio !== undefined) {
    candidates.push(matchChannel(observed_.ratio, 'unitless', tokens, tolerance));
  }
  return bestOf(candidates);
}

const KIND_RANK: Record<Classification['kind'], number> = { match: 0, near: 1, orphan: 2 };

function bestOf(candidates: Classification[]): Classification {
  if (candidates.length === 0) return { kind: 'orphan' };
  return candidates.reduce((best, c) => {
    if (KIND_RANK[c.kind] !== KIND_RANK[best.kind]) {
      return KIND_RANK[c.kind] < KIND_RANK[best.kind] ? c : best;
    }
    if (!!c.token !== !!best.token) return c.token ? c : best;
    return best;
  });
}

function matchChannel(
  amount: number,
  unit: 'px' | 'unitless',
  tokens: Token[],
  tolerance: number,
): Classification {
  let nearest: Token | undefined;
  let nearestAbs = Infinity;
  let nearestSigned = 0;
  for (const token of tokens) {
    const parsed = parseLineHeight(token.value);
    if (!parsed || parsed.unit !== unit) continue; // compare like with like
    const signed = amount - parsed.amount;
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

  const exactEpsilon = unit === 'px' ? PX_EXACT_EPSILON : UNITLESS_EXACT_EPSILON;
  if (nearestAbs <= exactEpsilon) {
    return { kind: 'match', token: nearest, distance: 0 };
  }

  if (unit === 'unitless' && nearestAbs <= tolerance + 1e-9) {
    return {
      kind: 'near',
      token: nearest,
      distance: nearestAbs,
      deltaLabel: formatDelta(nearestSigned, 'unitless'),
    };
  }
  return {
    kind: 'orphan',
    token: nearest,
    distance: nearestAbs,
    deltaLabel: formatDelta(nearestSigned, unit),
  };
}

interface LineHeight {
  unit: 'unitless' | 'px';
  amount: number;
}

interface ObservedLineHeight {
  px?: number;
  ratio?: number;
}

function parseObserved(value: string | number): ObservedLineHeight | null {
  if (typeof value === 'number') return { ratio: value };
  const trimmed = value.trim().toLowerCase();
  if (trimmed === '' || trimmed === 'normal') return null;

  const composite = /^(-?\d*\.?\d+)px\s*\/\s*(-?\d*\.?\d+)$/.exec(trimmed);
  if (composite) return { px: parseFloat(composite[1]), ratio: parseFloat(composite[2]) };

  const px = /^(-?\d*\.?\d+)px$/.exec(trimmed);
  if (px) return { px: parseFloat(px[1]) };
  if (/^-?\d*\.?\d+$/.test(trimmed)) return { ratio: parseFloat(trimmed) };
  return null;
}

function parseLineHeight(value: string | number): LineHeight | null {
  if (typeof value === 'number') return { unit: 'unitless', amount: value };
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'normal') return null;
  const px = /^(-?\d*\.?\d+)px$/.exec(trimmed);
  if (px) return { unit: 'px', amount: parseFloat(px[1]) };
  if (/^-?\d*\.?\d+$/.test(trimmed)) return { unit: 'unitless', amount: parseFloat(trimmed) };
  return null;
}

function formatDelta(signed: number, unit: 'unitless' | 'px'): string {
  const rounded = Math.round(signed * 1000) / 1000;
  const suffix = unit === 'px' ? 'px' : '';
  return `${rounded >= 0 ? '+' : ''}${rounded}${suffix}`;
}
