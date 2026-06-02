import { differenceCiede2000, parse, type Color } from 'culori';
import type { Token } from '../tokens/types';
import { DEFAULT_ROOT_FONT_SIZE, toPx } from './dimension';
import type { Classification } from './types';

const ciede2000 = differenceCiede2000();

export const DEFAULT_SHADOW_DIMENSION_TOLERANCE = 1; // px
export const DEFAULT_SHADOW_COLOR_TOLERANCE = 2; // ΔE

const DIMENSION_EXACT_EPSILON = 0.01;
const COLOR_EXACT_EPSILON = 0.1;

export interface ShadowMatchOptions {
  dimensionTolerance?: number;
  colorTolerance?: number;
  rootFontSize?: number;
}

// Component-wise match per the spec: ±1px on each dimension and ΔE 2.0 on color;
// any component out of tolerance makes it an orphan. Within all tolerances (but
// not exact) is a near-match. v1 handles single shadows; multi-shadow values
// (comma-separated) are treated as not comparable.
export function matchShadow(
  observed: string,
  tokens: Token[],
  options: ShadowMatchOptions = {},
): Classification {
  const dimensionTolerance = options.dimensionTolerance ?? DEFAULT_SHADOW_DIMENSION_TOLERANCE;
  const colorTolerance = options.colorTolerance ?? DEFAULT_SHADOW_COLOR_TOLERANCE;
  const rootFontSize = options.rootFontSize ?? DEFAULT_ROOT_FONT_SIZE;

  const observed_ = parseShadow(observed, rootFontSize);
  if (!observed_) {
    return { kind: 'orphan' };
  }

  let nearest: Token | undefined;
  let nearestCmp: Comparison | undefined;
  for (const token of tokens) {
    const parsed = parseShadow(String(token.value), rootFontSize);
    if (!parsed) continue;
    const cmp = compare(observed_, parsed);
    if (!cmp) continue; // not comparable (inset mismatch, color presence mismatch)
    if (!nearestCmp || cmp.score < nearestCmp.score) {
      nearestCmp = cmp;
      nearest = token;
    }
  }

  if (!nearest || !nearestCmp) {
    return { kind: 'orphan' };
  }

  const within =
    nearestCmp.maxDimensionDelta <= dimensionTolerance && nearestCmp.colorDelta <= colorTolerance;
  const exact =
    nearestCmp.maxDimensionDelta <= DIMENSION_EXACT_EPSILON &&
    nearestCmp.colorDelta <= COLOR_EXACT_EPSILON;

  if (exact) {
    return { kind: 'match', token: nearest, distance: 0 };
  }
  const deltaLabel = `Δ${round(nearestCmp.maxDimensionDelta)}px, ΔE ${nearestCmp.colorDelta.toFixed(1)}`;
  return {
    kind: within ? 'near' : 'orphan',
    token: nearest,
    distance: nearestCmp.score,
    deltaLabel,
  };
}

interface ParsedShadow {
  inset: boolean;
  lengths: number[]; // offsetX, offsetY, blur, spread (padded to 4 with 0)
  color: Color | null;
}

interface Comparison {
  maxDimensionDelta: number;
  colorDelta: number;
  score: number;
}

function compare(a: ParsedShadow, b: ParsedShadow): Comparison | null {
  if (a.inset !== b.inset) return null;

  let maxDimensionDelta = 0;
  for (let i = 0; i < 4; i++) {
    maxDimensionDelta = Math.max(maxDimensionDelta, Math.abs(a.lengths[i] - b.lengths[i]));
  }

  let colorDelta: number;
  if (a.color && b.color) {
    colorDelta = ciede2000(a.color, b.color);
  } else if (!a.color && !b.color) {
    colorDelta = 0;
  } else {
    return null; // one has a color, the other doesn't
  }

  return { maxDimensionDelta, colorDelta, score: maxDimensionDelta + colorDelta };
}

// Recognize both legacy and modern CSS color serializations. Current Chrome
// resolves computed colors (including shadow colors) to oklab()/lab()/lch() —
// not legacy rgb() — so the function list must stay broad or modern shadows
// fail to parse and orphan. The space-separated `rgb(r g b / a)` form is already
// covered by the `[^)]*` body.
const COLOR_PATTERN =
  /(?:rgba?|hsla?|hwb|(?:ok)?lab|(?:ok)?lch|color)\([^)]*\)|#[0-9a-f]{3,8}/i;

function parseShadow(value: string, rootFontSize: number): ParsedShadow | null {
  if (splitTopLevel(value).length !== 1) return null; // multi-shadow: not comparable in v1

  let rest = value.trim();
  const inset = /\binset\b/i.test(rest);
  rest = rest.replace(/\binset\b/i, ' ');

  let color: Color | null = null;
  const colorMatch = rest.match(COLOR_PATTERN);
  if (colorMatch) {
    color = parse(colorMatch[0]) ?? null;
    rest = rest.replace(colorMatch[0], ' ');
  }

  const lengths: number[] = [];
  for (const part of rest.split(/\s+/).filter(Boolean)) {
    const px = toPx(part, rootFontSize);
    if (px === null) {
      if (!color) {
        const named = parse(part); // a bare named color (e.g. "black")
        if (named) {
          color = named;
          continue;
        }
      }
      return null; // unrecognized component
    }
    lengths.push(px);
  }

  if (lengths.length < 2 || lengths.length > 4) return null; // need at least offset-x/y
  while (lengths.length < 4) lengths.push(0); // pad blur/spread
  return { inset, lengths, color };
}

function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
