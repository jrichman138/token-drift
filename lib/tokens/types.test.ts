import { describe, expect, it } from 'vitest';
import { TOKEN_CATEGORIES, emptyTokenSet, isTokenCategory } from './types';

describe('token model', () => {
  it('emptyTokenSet has an array for every category', () => {
    const set = emptyTokenSet();
    for (const category of TOKEN_CATEGORIES) {
      expect(set[category]).toEqual([]);
    }
  });

  it('isTokenCategory recognizes known and rejects unknown categories', () => {
    expect(isTokenCategory('color')).toBe(true);
    expect(isTokenCategory('shadow')).toBe(true);
    expect(isTokenCategory('opacity')).toBe(false);
  });
});
