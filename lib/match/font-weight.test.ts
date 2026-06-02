import { describe, expect, it } from 'vitest';
import type { Token } from '../tokens/types';
import { matchFontWeight } from './font-weight';

const weights: Token[] = [
  { category: 'fontWeight', name: 'regular', value: 400 },
  { category: 'fontWeight', name: 'medium', value: 500 },
  { category: 'fontWeight', name: 'bold', value: 700 },
];

describe('matchFontWeight', () => {
  it('matches an exact numeric weight', () => {
    const result = matchFontWeight('500', weights);
    expect(result.kind).toBe('match');
    expect(result.token?.name).toBe('medium');
  });

  it('resolves the normal/bold keywords', () => {
    expect(matchFontWeight('normal', weights).token?.name).toBe('regular');
    expect(matchFontWeight('bold', weights).token?.name).toBe('bold');
  });

  it('treats a non-token weight as an orphan with the closest token and signed delta', () => {
    const result = matchFontWeight('600', weights);
    expect(result.kind).toBe('orphan');
    expect(['medium', 'bold']).toContain(result.token?.name);
    expect(result.deltaLabel).toMatch(/^[+-]100$/);
  });

  it('returns an orphan with no token for unresolvable relative keywords', () => {
    const result = matchFontWeight('bolder', weights);
    expect(result.kind).toBe('orphan');
    expect(result.token).toBeUndefined();
  });
});
