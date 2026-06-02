import {
  type ParseResult,
  type TokenCategory,
  emptyTokenSet,
} from './types';

// Parses the friendly Markdown token format into the internal model.
//
//   # Colors
//   - gray-500: #6b7280
//
// H1 headers map to categories; list items are `name: value`. Headers are
// matched leniently (casing, spacing, and singular/plural ignored) so designers
// can write natural headings like "Font Size" or "Colors" as well as the JSON
// key forms ("fontSize", "color").
//
// Numeric values are coerced to numbers (e.g. `400`, `1.5`) for parity with the
// JSON parser. Recoverable issues surface as warnings.
export function parseMarkdownTokens(input: string): ParseResult {
  const tokens = emptyTokenSet();
  const warnings: string[] = [];
  const seen = new Map<TokenCategory, Set<string>>();

  let current: TokenCategory | null = null;

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;

    const headerMatch = /^#\s+(.+)$/.exec(line);
    if (headerMatch) {
      const headerText = headerMatch[1].trim();
      const category = HEADER_ALIASES[normalizeHeader(headerText)];
      if (!category) {
        warnings.push(`Ignored unknown category header "${headerText}".`);
        current = null;
        continue;
      }
      current = category;
      continue;
    }

    const bulletMatch = /^[-*+]\s+(.+)$/.exec(line);
    if (!bulletMatch) continue; // prose / other markdown — ignored

    const itemText = bulletMatch[1].trim();
    if (current === null) {
      warnings.push(`Skipped "${itemText}": not under a recognized category.`);
      continue;
    }

    const colonIdx = itemText.indexOf(':');
    const name = colonIdx === -1 ? '' : itemText.slice(0, colonIdx).trim();
    const valueText = colonIdx === -1 ? '' : itemText.slice(colonIdx + 1).trim();
    if (name === '' || valueText === '') {
      warnings.push(`Skipped malformed item "${itemText}": expected "name: value".`);
      continue;
    }

    let categorySeen = seen.get(current);
    if (!categorySeen) {
      categorySeen = new Set();
      seen.set(current, categorySeen);
    }
    if (categorySeen.has(name)) {
      warnings.push(`Skipped duplicate token "${current}.${name}"; kept the first definition.`);
      continue;
    }
    categorySeen.add(name);
    tokens[current].push({ category: current, name, value: coerceValue(valueText) });
  }

  return { tokens, warnings };
}

const HEADER_ALIASES: Record<string, TokenCategory> = {
  color: 'color',
  colors: 'color',
  spacing: 'spacing',
  fontsize: 'fontSize',
  fontweight: 'fontWeight',
  fontfamily: 'fontFamily',
  lineheight: 'lineHeight',
  radius: 'radius',
  borderradius: 'radius',
  shadow: 'shadow',
  shadows: 'shadow',
};

function normalizeHeader(text: string): string {
  return text.toLowerCase().replace(/[\s\-_]/g, '');
}

function coerceValue(text: string): string | number {
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : text;
}
