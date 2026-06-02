import type { TokenCategory } from '../tokens/types';

// A single observed style value on the page — one occurrence of one property on
// one element. The aggregation step groups these into per-value instances.
export interface Observation {
  category: TokenCategory;
  // The CSS property the value came from, e.g. 'background-color', 'padding-top'.
  // Kept for the report's location/context, not used for matching.
  property: string;
  // The computed value as the browser reports it (e.g. 'rgb(107, 114, 128)').
  value: string;
  // A CSS selector locating the element, for the violations list.
  selector: string;
}
