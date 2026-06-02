import { describe, expect, it } from 'vitest';
import { parseJsonTokens } from './parse-json';

describe('parseJsonTokens', () => {
  it('parses the canonical spec example across all 8 categories', () => {
    const json = JSON.stringify({
      color: { 'gray-500': { value: '#6b7280', type: 'color' } },
      spacing: { '2': { value: '8px', type: 'dimension' } },
      fontSize: { base: { value: '16px', type: 'dimension' } },
      fontWeight: { regular: { value: 400, type: 'fontWeight' } },
      fontFamily: { sans: { value: 'Inter, system-ui, sans-serif', type: 'fontFamily' } },
      lineHeight: { normal: { value: 1.5, type: 'number' } },
      radius: { md: { value: '6px', type: 'dimension' } },
      shadow: { sm: { value: '0 1px 2px rgba(0,0,0,0.05)', type: 'shadow' } },
    });

    const { tokens, warnings } = parseJsonTokens(json);

    expect(warnings).toEqual([]);
    expect(tokens.color).toEqual([{ category: 'color', name: 'gray-500', value: '#6b7280' }]);
    expect(tokens.spacing).toEqual([{ category: 'spacing', name: '2', value: '8px' }]);
    expect(tokens.fontWeight).toEqual([{ category: 'fontWeight', name: 'regular', value: 400 }]);
    expect(tokens.lineHeight).toEqual([{ category: 'lineHeight', name: 'normal', value: 1.5 }]);
    expect(tokens.shadow[0].value).toBe('0 1px 2px rgba(0,0,0,0.05)');
  });

  it('preserves numeric values without coercing to strings', () => {
    const { tokens } = parseJsonTokens({
      fontWeight: { bold: { value: 700, type: 'fontWeight' } },
      lineHeight: { tight: { value: 1.25, type: 'number' } },
    });
    expect(tokens.fontWeight[0].value).toBe(700);
    expect(tokens.lineHeight[0].value).toBe(1.25);
  });

  it('accepts DTCG $value / $type keys', () => {
    const { tokens, warnings } = parseJsonTokens({
      color: { brand: { $value: '#3b82f6', $type: 'color' } },
    });
    expect(warnings).toEqual([]);
    expect(tokens.color[0]).toEqual({ category: 'color', name: 'brand', value: '#3b82f6' });
  });

  it('accepts bare-primitive shorthand values', () => {
    const { tokens } = parseJsonTokens({
      color: { 'gray-500': '#6b7280' },
      fontWeight: { regular: 400 },
    });
    expect(tokens.color[0].value).toBe('#6b7280');
    expect(tokens.fontWeight[0].value).toBe(400);
  });

  it('accepts an already-parsed object, not just a string', () => {
    const { tokens } = parseJsonTokens({ radius: { md: { value: '6px' } } });
    expect(tokens.radius[0].value).toBe('6px');
  });

  it('warns and skips unknown categories', () => {
    const { tokens, warnings } = parseJsonTokens({
      opacity: { 50: { value: 0.5 } },
      color: { brand: '#000' },
    });
    expect(tokens.color).toHaveLength(1);
    expect(warnings).toContain('Ignored unknown category "opacity".');
  });

  it('warns when a category is not an object', () => {
    const { warnings } = parseJsonTokens({ color: '#6b7280' });
    expect(warnings).toContain('Ignored category "color": expected an object of tokens.');
  });

  it('warns and skips entries with no usable value', () => {
    const { tokens, warnings } = parseJsonTokens({
      color: {
        good: { value: '#fff' },
        bad: { type: 'color' },
        alsoBad: { value: { nested: true } },
      },
    });
    expect(tokens.color).toHaveLength(1);
    expect(warnings).toContain('Skipped "color.bad": no usable value.');
    expect(warnings).toContain('Skipped "color.alsoBad": no usable value.');
  });

  it('flattens nested groups into dotted token names', () => {
    // The shape real Tokens Studio / Style Dictionary exports use: a category
    // holds sub-groups (a color scale) rather than a flat name->token map.
    const { tokens, warnings } = parseJsonTokens({
      color: {
        gray: {
          500: { $value: '#6b7280', $type: 'color' },
          700: { $value: '#374151', $type: 'color' },
        },
        brand: { primary: { $value: '#3b82f6', $type: 'color' } },
      },
      spacing: { scale: { 2: { $value: '8px', $type: 'dimension' } } },
    });

    expect(warnings).toEqual([]);
    expect(tokens.color).toEqual([
      { category: 'color', name: 'gray.500', value: '#6b7280' },
      { category: 'color', name: 'gray.700', value: '#374151' },
      { category: 'color', name: 'brand.primary', value: '#3b82f6' },
    ]);
    expect(tokens.spacing).toEqual([{ category: 'spacing', name: 'scale.2', value: '8px' }]);
  });

  it('skips alias references with a warning instead of storing the literal', () => {
    const { tokens, warnings } = parseJsonTokens({
      color: {
        base: { $value: '#3b82f6', $type: 'color' },
        alias: { $value: '{color.base}', $type: 'color' },
      },
    });
    expect(tokens.color).toEqual([{ category: 'color', name: 'base', value: '#3b82f6' }]);
    expect(warnings).toContain(
      'Skipped "color.alias": token references ({color.base}) are not resolved in v1.',
    );
  });

  it('warns on composite ($value object) tokens it cannot split', () => {
    // DTCG typography/shadow composite tokens carry an object $value; v1 audits
    // split categories, so these are skipped (not silently mis-parsed).
    const { tokens, warnings } = parseJsonTokens({
      fontSize: {
        heading: { $value: { fontSize: '24px', fontWeight: 700 }, $type: 'typography' },
        base: { $value: '16px', $type: 'dimension' },
      },
    });
    expect(tokens.fontSize).toEqual([{ category: 'fontSize', name: 'base', value: '16px' }]);
    expect(warnings).toContain('Skipped "fontSize.heading": no usable value.');
  });

  it('throws on invalid JSON strings', () => {
    expect(() => parseJsonTokens('{ not valid')).toThrow(/Invalid JSON/);
  });

  it('throws when the root is not an object', () => {
    expect(() => parseJsonTokens('[]')).toThrow(/must be an object/);
    expect(() => parseJsonTokens('"hello"')).toThrow(/must be an object/);
    expect(() => parseJsonTokens('null')).toThrow(/must be an object/);
  });

  it('produces an empty-but-complete token set for {}', () => {
    const { tokens, warnings } = parseJsonTokens('{}');
    expect(warnings).toEqual([]);
    expect(tokens.color).toEqual([]);
    expect(tokens.shadow).toEqual([]);
  });
});
