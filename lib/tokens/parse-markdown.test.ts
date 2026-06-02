import { describe, expect, it } from 'vitest';
import { parseMarkdownTokens } from './parse-markdown';

const SPEC_EXAMPLE = `# Colors
- gray-500: #6b7280

# Spacing
- 2: 8px

# Font Size
- base: 16px

# Font Weight
- regular: 400

# Font Family
- sans: Inter, system-ui, sans-serif

# Line Height
- normal: 1.5

# Radius
- md: 6px

# Shadow
- sm: 0 1px 2px rgba(0,0,0,0.05)
`;

describe('parseMarkdownTokens', () => {
  it('parses the friendly spec example across all 8 categories', () => {
    const { tokens, warnings } = parseMarkdownTokens(SPEC_EXAMPLE);

    expect(warnings).toEqual([]);
    expect(tokens.color).toEqual([{ category: 'color', name: 'gray-500', value: '#6b7280' }]);
    expect(tokens.spacing).toEqual([{ category: 'spacing', name: '2', value: '8px' }]);
    expect(tokens.fontSize).toEqual([{ category: 'fontSize', name: 'base', value: '16px' }]);
    expect(tokens.radius).toEqual([{ category: 'radius', name: 'md', value: '6px' }]);
  });

  it('coerces numeric values to numbers for parity with JSON', () => {
    const { tokens } = parseMarkdownTokens(SPEC_EXAMPLE);
    expect(tokens.fontWeight[0].value).toBe(400);
    expect(tokens.lineHeight[0].value).toBe(1.5);
  });

  it('keeps values containing commas/spaces/colons intact', () => {
    const { tokens } = parseMarkdownTokens(
      '# Font Family\n- sans: Inter, system-ui, sans-serif\n# Shadow\n- sm: 0 1px 2px rgba(0,0,0,0.05)',
    );
    expect(tokens.fontFamily[0].value).toBe('Inter, system-ui, sans-serif');
    expect(tokens.shadow[0].value).toBe('0 1px 2px rgba(0,0,0,0.05)');
  });

  it('accepts JSON-key header forms as well as friendly ones', () => {
    const { tokens, warnings } = parseMarkdownTokens('# fontSize\n- base: 16px\n# color\n- brand: #000');
    expect(warnings).toEqual([]);
    expect(tokens.fontSize[0].name).toBe('base');
    expect(tokens.color[0].name).toBe('brand');
  });

  it('accepts "Border Radius" and "Shadows" header variants', () => {
    const { tokens, warnings } = parseMarkdownTokens('# Border Radius\n- md: 6px\n# Shadows\n- sm: 0 1px 2px #000');
    expect(warnings).toEqual([]);
    expect(tokens.radius[0].value).toBe('6px');
    expect(tokens.shadow[0].name).toBe('sm');
  });

  it('accepts *, +, and - as bullet markers', () => {
    const { tokens } = parseMarkdownTokens('# Color\n- a: #001\n* b: #002\n+ c: #003');
    expect(tokens.color.map((t) => t.name)).toEqual(['a', 'b', 'c']);
  });

  it('does not treat H2+ as category headers', () => {
    const { warnings, tokens } = parseMarkdownTokens('## Color\n- a: #000');
    expect(tokens.color).toHaveLength(0);
    expect(warnings).toContain('Skipped "a: #000": not under a recognized category.');
  });

  it('warns on unknown headers and skips their items', () => {
    const { tokens, warnings } = parseMarkdownTokens('# Opacity\n- 50: 0.5\n# Color\n- brand: #000');
    expect(tokens.color).toHaveLength(1);
    expect(warnings).toContain('Ignored unknown category header "Opacity".');
    expect(warnings).toContain('Skipped "50: 0.5": not under a recognized category.');
  });

  it('warns on list items before any header', () => {
    const { warnings } = parseMarkdownTokens('- orphan: #000\n# Color\n- brand: #000');
    expect(warnings).toContain('Skipped "orphan: #000": not under a recognized category.');
  });

  it('warns on malformed items missing a value', () => {
    const { tokens, warnings } = parseMarkdownTokens('# Color\n- gray-500\n- good: #fff');
    expect(tokens.color).toHaveLength(1);
    expect(warnings).toContain('Skipped malformed item "gray-500": expected "name: value".');
  });

  it('warns and keeps the first of duplicate tokens, even across repeated headers', () => {
    const { tokens, warnings } = parseMarkdownTokens('# Color\n- brand: #111\n# Color\n- brand: #222');
    expect(tokens.color).toEqual([{ category: 'color', name: 'brand', value: '#111' }]);
    expect(warnings).toContain('Skipped duplicate token "color.brand"; kept the first definition.');
  });

  it('ignores prose and blank lines', () => {
    const { tokens, warnings } = parseMarkdownTokens(
      'Some intro text.\n\n# Color\n\nThese are our brand colors.\n- brand: #000\n',
    );
    expect(warnings).toEqual([]);
    expect(tokens.color).toHaveLength(1);
  });
});
