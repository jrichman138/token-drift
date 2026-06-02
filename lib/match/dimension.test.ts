import { describe, expect, it } from 'vitest';
import type { Token } from '../tokens/types';
import { matchDimension, toPx } from './dimension';

const spacing: Token[] = [
  { category: 'spacing', name: '1', value: '4px' },
  { category: 'spacing', name: '2', value: '8px' },
  { category: 'spacing', name: '4', value: '1rem' },
];

describe('toPx', () => {
  it('parses px, rem, and bare numbers', () => {
    expect(toPx('8px', 16)).toBe(8);
    expect(toPx('1rem', 16)).toBe(16);
    expect(toPx('0.5rem', 16)).toBe(8);
    expect(toPx('0', 16)).toBe(0);
    expect(toPx('12', 16)).toBe(12);
    expect(toPx(10, 16)).toBe(10);
  });

  it('respects a custom root font size for rem', () => {
    expect(toPx('1rem', 10)).toBe(10);
  });

  it('returns null for unsupported units', () => {
    expect(toPx('2em', 16)).toBeNull();
    expect(toPx('50%', 16)).toBeNull();
    expect(toPx('auto', 16)).toBeNull();
  });
});

describe('matchDimension', () => {
  it('matches an exact px value', () => {
    const result = matchDimension('8px', spacing);
    expect(result.kind).toBe('match');
    expect(result.token?.name).toBe('2');
  });

  it('matches across rem↔px normalization', () => {
    expect(matchDimension('16px', spacing).token?.name).toBe('4'); // 1rem == 16px
    expect(matchDimension('1rem', spacing).kind).toBe('match');
  });

  it('has no near band: a 1px miss is an orphan with the closest token', () => {
    const result = matchDimension('9px', spacing);
    expect(result.kind).toBe('orphan');
    expect(result.token?.name).toBe('2'); // 8px is closest
    expect(result.deltaLabel).toBe('+1px');
  });

  it('shows a negative delta when the value is below the closest token', () => {
    const result = matchDimension('3px', spacing);
    expect(result.kind).toBe('orphan');
    expect(result.token?.name).toBe('1'); // 4px is closest
    expect(result.deltaLabel).toBe('-1px');
  });

  it('returns an orphan with no token for an unparseable dimension', () => {
    const result = matchDimension('auto', spacing);
    expect(result.kind).toBe('orphan');
    expect(result.token).toBeUndefined();
  });
});
