import type { Token, TokenCategory } from '../tokens/types';
import { matchColor } from './color';
import { matchDimension } from './dimension';
import { matchFontFamily } from './font-family';
import { matchFontWeight } from './font-weight';
import { matchLineHeight } from './line-height';
import { matchShadow } from './shadow';
import type { Classification } from './types';

export type { Classification, MatchKind } from './types';

// Tunable thresholds, all defaulted in the individual matchers per the spec's
// "all thresholds exposed in settings" requirement.
export interface MatchOptions {
  rootFontSize?: number;
  colorTolerance?: number;
  lineHeightTolerance?: number;
  shadowDimensionTolerance?: number;
  shadowColorTolerance?: number;
}

// Classifies an observed value for a given category against that category's
// tokens. `tokens` should already be filtered to the category.
export function classify(
  category: TokenCategory,
  observed: string | number,
  tokens: Token[],
  options: MatchOptions = {},
): Classification {
  switch (category) {
    case 'color':
      return matchColor(String(observed), tokens, { tolerance: options.colorTolerance });
    case 'spacing':
    case 'fontSize':
    case 'radius':
      return matchDimension(observed, tokens, { rootFontSize: options.rootFontSize });
    case 'fontWeight':
      return matchFontWeight(observed, tokens);
    case 'fontFamily':
      return matchFontFamily(String(observed), tokens);
    case 'lineHeight':
      return matchLineHeight(observed, tokens, { tolerance: options.lineHeightTolerance });
    case 'shadow':
      return matchShadow(String(observed), tokens, {
        dimensionTolerance: options.shadowDimensionTolerance,
        colorTolerance: options.shadowColorTolerance,
        rootFontSize: options.rootFontSize,
      });
  }
}
