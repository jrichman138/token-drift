import type { Token } from '../tokens/types';

export type MatchKind = 'match' | 'near' | 'orphan';

// The classification of a single observed value against a category's tokens.
export interface Classification {
  kind: MatchKind;
  // The matched token (match/near) or the closest suggestion (orphan).
  // Undefined only when nothing comparable exists (no tokens, or the observed
  // value couldn't be interpreted).
  token?: Token;
  // Numeric distance to `token` on the category's own scale (e.g. ΔE for color,
  // px for dimensions). Used for sorting violations. ~0 for exact matches.
  distance?: number;
  // Human-readable distance for the report, e.g. "ΔE 1.4" or "+2px".
  deltaLabel?: string;
}
