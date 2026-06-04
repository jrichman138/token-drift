import type { TokenCategory } from '../tokens/types';

// A single observed style value — one occurrence of one property on one node.
// In the Figma plugin these come from src/figma/extract.ts (canvas nodes); the
// shape matches the extension's so the aggregation engine is shared unchanged.
export interface Observation {
  category: TokenCategory;
  // The source property, e.g. 'fill', 'stroke', 'cornerRadius'. Kept for the
  // report's context, not used for matching.
  property: string;
  // The value in the same string form the matchers expect (e.g. '#6b7280').
  value: string;
  // A human-readable locator for the node (its name / path on the canvas).
  selector: string;
}
