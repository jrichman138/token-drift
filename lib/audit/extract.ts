import type { TokenCategory } from '../tokens/types';
import type { Observation } from './types';

// The computed-style context for one element. `read` abstracts over a real
// CSSStyleDeclaration (getPropertyValue) so the sampling rules below can be unit
// tested with a plain value map instead of a live DOM.
export interface ElementContext {
  selector: string;
  hasText: boolean;
  read: (property: string) => string;
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const;

// The sampling rules: given one element's computed styles, decide which values
// are real token usages worth auditing. "Absence" values (transparent, zero,
// none, normal) are skipped so they don't flood the audit. Typography and
// foreground color are only sampled where text actually renders.
export function collectFromStyles(ctx: ElementContext): Observation[] {
  const { selector, hasText, read } = ctx;
  const out: Observation[] = [];
  const add = (category: TokenCategory, property: string, value: string) =>
    out.push({ category, property, value: value.trim(), selector });

  if (hasText) {
    const color = read('color');
    if (color.trim()) add('color', 'color', color);
  }

  const background = read('background-color');
  if (!isTransparent(background)) add('color', 'background-color', background);

  for (const side of SIDES) {
    if (hasVisibleBorder(read, side)) {
      const color = read(`border-${side}-color`);
      if (color.trim()) add('color', `border-${side}-color`, color);
    }
  }

  const shadow = read('box-shadow');
  if (shadow.trim() && shadow.trim() !== 'none') add('shadow', 'box-shadow', shadow);

  for (const side of SIDES) {
    const padding = read(`padding-${side}`);
    if (!isZeroLength(padding)) add('spacing', `padding-${side}`, padding);
    const margin = read(`margin-${side}`);
    if (!isZeroLength(margin)) add('spacing', `margin-${side}`, margin);
  }

  if (isFlexOrGrid(read('display'))) {
    for (const axis of ['row-gap', 'column-gap'] as const) {
      const gap = read(axis);
      if (!isZeroLength(gap) && gap.trim() !== 'normal') add('spacing', axis, gap);
    }
  }

  for (const corner of CORNERS) {
    const radius = read(`border-${corner}-radius`);
    if (!isZeroLength(radius)) add('radius', `border-${corner}-radius`, radius);
  }

  if (hasText) {
    const fontSize = read('font-size');
    if (fontSize.trim()) add('fontSize', 'font-size', fontSize);
    const fontWeight = read('font-weight');
    if (fontWeight.trim()) add('fontWeight', 'font-weight', fontWeight);
    const fontFamily = read('font-family');
    if (fontFamily.trim()) add('fontFamily', 'font-family', fontFamily);
    const lineHeight = formatLineHeight(read('line-height'), fontSize);
    if (lineHeight) add('lineHeight', 'line-height', lineHeight);
  }

  return out;
}

// getComputedStyle always resolves line-height to px (or "normal"), so the DOM
// never tells us whether the author wrote a unitless ratio or an absolute px
// value. To stay matchable against either token style we emit BOTH forms in one
// value — the rendered px and the derived ratio (px ÷ font-size) — e.g.
// "24px / 1.5". The matcher compares px against px tokens and the ratio against
// unitless tokens. Falls back to whichever form is available.
function formatLineHeight(lineHeight: string, fontSize: string): string | null {
  const lh = lineHeight.trim().toLowerCase();
  if (lh === '' || lh === 'normal') return null;

  const px = parsePx(lh);
  const fontPx = parsePx(fontSize);
  if (px !== null && fontPx !== null && fontPx > 0) {
    return `${formatNum(px)}px / ${formatNum(round(px / fontPx, 3))}`;
  }
  if (px !== null) return `${formatNum(px)}px`;
  if (/^-?\d*\.?\d+$/.test(lh)) return lh; // already unitless (rare from a live DOM)
  return lineHeight.trim();
}

function parsePx(value: string): number | null {
  const match = /^(-?\d*\.?\d+)px$/.exec(value.trim().toLowerCase());
  return match ? parseFloat(match[1]) : null;
}

function round(n: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
}

function formatNum(n: number): string {
  return String(round(n, 3));
}

function hasVisibleBorder(read: (p: string) => string, side: (typeof SIDES)[number]): boolean {
  const style = read(`border-${side}-style`).trim();
  if (style === '' || style === 'none' || style === 'hidden') return false;
  return !isZeroLength(read(`border-${side}-width`));
}

function isZeroLength(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === '' || trimmed === '0' || trimmed === '0px';
}

function isTransparent(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === '' || trimmed === 'transparent' || trimmed === 'rgba(0, 0, 0, 0)';
}

function isFlexOrGrid(display: string): boolean {
  return /\b(flex|grid)\b/.test(display);
}
