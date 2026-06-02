// The internal token model. Every input format (JSON, Markdown, file upload,
// repo URL) is parsed into this single structure before auditing.

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

// A single token as authored by the designer. `value` is kept as the raw
// authored form (e.g. "#6b7280", "8px", 400, 1.5); category-specific
// normalization for matching happens later in the matching engine.
export interface Token {
  category: TokenCategory;
  name: string;
  value: string | number;
}

// The parsed token system: tokens grouped by category, preserving authored order.
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

// Result of parsing any input format into the internal model. Hard failures
// (unparseable input, wrong root shape) throw; recoverable issues (skipped
// entries, unknown categories) are collected as warnings so the UI can name
// them rather than hide them.
export interface ParseResult {
  tokens: TokenSet;
  warnings: string[];
}
