// The internal token model. In the Figma plugin, tokens come from the file's
// own Variables and Styles (see src/figma/tokens.ts) rather than an uploaded
// file, but they are mapped into this same structure before auditing.
//
// COPIED VERBATIM from the Token Drift Chrome extension (lib/tokens/types.ts).
// Keep this in sync by re-copying when the extension's core changes — the two
// products intentionally duplicate this pure logic for isolation.

export const TOKEN_CATEGORIES = [
  'color',
  'spacing',
  'fontSize',
  'fontWeight',
  'fontFamily',
  'lineHeight',
  'radius',
  'shadow',
] as const;

export type TokenCategory = (typeof TOKEN_CATEGORIES)[number];

// A single token. `value` is kept as the raw authored form (e.g. "#6b7280",
// "8px", 400, 1.5); category-specific normalization for matching happens later
// in the matching engine.
export interface Token {
  category: TokenCategory;
  name: string;
  value: string | number;
}

// The token system: tokens grouped by category, preserving authored order.
export type TokenSet = Record<TokenCategory, Token[]>;

export function emptyTokenSet(): TokenSet {
  return {
    color: [],
    spacing: [],
    fontSize: [],
    fontWeight: [],
    fontFamily: [],
    lineHeight: [],
    radius: [],
    shadow: [],
  };
}

export function isTokenCategory(value: string): value is TokenCategory {
  return (TOKEN_CATEGORIES as readonly string[]).includes(value);
}

export interface ParseResult {
  tokens: TokenSet;
  warnings: string[];
}
