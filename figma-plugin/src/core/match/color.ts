import { differenceCiede2000, parse } from 'culori';
import type { Token } from '../tokens/types';
import type { Classification } from './types';

// Perceptual color difference (CIEDE2000). The metric is fixed; the threshold
// is tunable. ΔE 2.0 is a perceptual just-noticeable-difference tolerance.
const ciede2000 = differenceCiede2000();

// ΔE below this counts as an exact match, absorbing float/rounding noise.
const EXACT_EPSILON = 0.1;

export const DEFAULT_COLOR_TOLERANCE = 2.0;

export interface ColorMatchOptions {
  tolerance?: number;
}

export function matchColor(
  observed: string,
  tokens: Token[],
  options: ColorMatchOptions = {},
): Classification {
  const tolerance = options.tolerance ?? DEFAULT_COLOR_TOLERANCE;

  const observedColor = parse(observed);
  if (!observedColor) {
    return { kind: 'orphan' };
  }

  let nearest: Token | undefined;
  let nearestDistance = Infinity;
  for (const token of tokens) {
    const tokenColor = parse(String(token.value));
    if (!tokenColor) continue;
    const distance = ciede2000(observedColor, tokenColor);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = token;
    }
  }

  if (!nearest) {
    return { kind: 'orphan' };
  }

  if (nearestDistance <= EXACT_EPSILON) {
    return { kind: 'match', token: nearest, distance: nearestDistance };
  }

  const deltaLabel = `ΔE ${nearestDistance.toFixed(1)}`;
  const kind = nearestDistance <= tolerance ? 'near' : 'orphan';
  return { kind, token: nearest, distance: nearestDistance, deltaLabel };
}
