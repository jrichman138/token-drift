import {
  type ParseResult,
  type Token,
  type TokenCategory,
  emptyTokenSet,
  isTokenCategory,
} from './types';

// Parses the canonical JSON token format (simplified W3C Design Tokens) into
// the internal model.
//
// Shape:
//   { "<category>": { "<name>": { "value": <v>, "type": "<t>" }, ... }, ... }
//
// Tolerances for real-world files:
//   - DTCG `$value` / `$type` keys are accepted alongside plain `value` / `type`.
//   - A token may be given as a bare primitive shorthand: "gray-500": "#6b7280".
//   - Nested groups are flattened: a category may hold sub-groups (as real
//     Tokens Studio / Style Dictionary exports do), and a token nested at
//     `color.gray.500` becomes a token named "gray.500".
//   - Alias references (`"{color.gray.500}"`) are skipped with a warning — v1
//     does not resolve references (see the spec).
//
// Hard failures (invalid JSON, non-object root) throw. Recoverable issues
// (unknown categories, malformed entries, duplicates, aliases) are collected as
// warnings.
export function parseJsonTokens(input: string | unknown): ParseResult {
  const root = typeof input === 'string' ? parseJsonString(input) : input;

  if (!isPlainObject(root)) {
    throw new Error('Token JSON must be an object with category keys at the top level.');
  }

  const tokens = emptyTokenSet();
  const warnings: string[] = [];

  for (const [categoryKey, categoryValue] of Object.entries(root)) {
    if (!isTokenCategory(categoryKey)) {
      warnings.push(`Ignored unknown category "${categoryKey}".`);
      continue;
    }
    if (!isPlainObject(categoryValue)) {
      warnings.push(`Ignored category "${categoryKey}": expected an object of tokens.`);
      continue;
    }

    const seen = new Set<string>();
    collectTokens(categoryKey, categoryValue, '', { tokens, warnings, seen });
  }

  return { tokens, warnings };
}

interface CollectCtx {
  tokens: ReturnType<typeof emptyTokenSet>;
  warnings: string[];
  seen: Set<string>;
}

// Recursively walks a category subtree, flattening nested groups into dotted
// token names. An object that carries token metadata (value/$value/type/$type)
// is treated as a leaf; any other object is a group and is descended into.
function collectTokens(
  category: TokenCategory,
  node: Record<string, unknown>,
  prefix: string,
  ctx: CollectCtx,
): void {
  for (const [key, entry] of Object.entries(node)) {
    const name = prefix ? `${prefix}.${key}` : key;

    if (isPlainObject(entry) && !looksLikeToken(entry)) {
      collectTokens(category, entry, name, ctx); // a group — descend
      continue;
    }

    const value = extractValue(entry);
    if (value === undefined) {
      ctx.warnings.push(`Skipped "${category}.${name}": no usable value.`);
      continue;
    }
    if (typeof value === 'string' && isAlias(value)) {
      ctx.warnings.push(
        `Skipped "${category}.${name}": token references (${value}) are not resolved in v1.`,
      );
      continue;
    }
    if (ctx.seen.has(name)) {
      ctx.warnings.push(
        `Skipped duplicate token "${category}.${name}"; kept the first definition.`,
      );
      continue;
    }
    ctx.seen.add(name);
    ctx.tokens[category].push(makeToken(category, name, value));
  }
}

// Whether an object is a token leaf rather than a group of nested tokens. A leaf
// declares a value or a type (in either plain or DTCG `$`-prefixed form); a bare
// group object has neither.
function looksLikeToken(entry: Record<string, unknown>): boolean {
  return 'value' in entry || '$value' in entry || 'type' in entry || '$type' in entry;
}

// A DTCG alias reference, e.g. "{color.gray.500}". Not resolved in v1.
function isAlias(value: string): boolean {
  return /^\{.+\}$/.test(value.trim());
}

function parseJsonString(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON: ${detail}`);
  }
}

// Resolves a token entry to its raw value. Accepts the object form
// ({ value } / { $value }) and the bare-primitive shorthand.
function extractValue(entry: unknown): string | number | undefined {
  if (typeof entry === 'string' || typeof entry === 'number') {
    return entry;
  }
  if (isPlainObject(entry)) {
    const raw = 'value' in entry ? entry.value : entry.$value;
    if (typeof raw === 'string' || typeof raw === 'number') {
      return raw;
    }
  }
  return undefined;
}

function makeToken(category: TokenCategory, name: string, value: string | number): Token {
  return { category, name, value };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
