// Figma represents paint/variable colors as { r, g, b } channels in the 0..1
// range (optionally with alpha). The matchers expect a CSS-parseable string, so
// we serialize to a 6-digit hex. Alpha is intentionally dropped for v1 — the
// color matchers compare opaque colors; opacity drift is a later concern.

export interface FigmaRGB {
  r: number;
  g: number;
  b: number;
}

function channel(value: number): string {
  const clamped = Math.max(0, Math.min(1, value));
  return Math.round(clamped * 255)
    .toString(16)
    .padStart(2, '0');
}

export function rgbToHex(color: FigmaRGB): string {
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}
