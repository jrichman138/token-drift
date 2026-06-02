import { describe, expect, it } from 'vitest';
import type { Token } from '../tokens/types';
import { matchLineHeight } from './line-height';

const lineHeights: Token[] = [
  { category: 'lineHeight', name: 'normal', value: 1.5 },
  { category: 'lineHeight', name: 'tight', value: 1.25 },
  { category: 'lineHeight', name: 'px24', value: '24px' },
];

describe('matchLineHeight', () => {
  it('matches an exact unitless value (number or numeric string)', () => {
    expect(matchLineHeight(1.5, lineHeights).kind).toBe('match');
    expect(matchLineHeight('1.5', lineHeights).token?.name).toBe('normal');
  });

  it('treats a unitless value within ±0.05 as a near-match', () => {
    const high = matchLineHeight(1.53, lineHeights);
    expect(high.kind).toBe('near');
    expect(high.token?.name).toBe('normal');
    expect(high.deltaLabel).toBe('+0.03');

    const low = matchLineHeight(1.45, lineHeights); // exactly 0.05 away
    expect(low.kind).toBe('near');
    expect(low.deltaLabel).toBe('-0.05');
  });

  it('orphans a unitless value beyond ±0.05', () => {
    const result = matchLineHeight(1.4, lineHeights);
    expect(result.kind).toBe('orphan');
    expect(result.token?.name).toBe('normal');
    expect(result.deltaLabel).toBe('-0.1');
  });

  it('matches px exactly but has no near band for px', () => {
    expect(matchLineHeight('24px', lineHeights).kind).toBe('match');
    const off = matchLineHeight('25px', lineHeights);
    expect(off.kind).toBe('orphan');
    expect(off.deltaLabel).toBe('+1px');
  });

  it('does not compare unitless against px', () => {
    const result = matchLineHeight('24px', [
      { category: 'lineHeight', name: 'normal', value: 1.5 },
    ]);
    expect(result.kind).toBe('orphan');
    expect(result.token).toBeUndefined();
  });

  it('returns an orphan with no token for "normal"', () => {
    const result = matchLineHeight('normal', lineHeights);
    expect(result.kind).toBe('orphan');
    expect(result.token).toBeUndefined();
  });

  // The browser reports line-height as px, so extract.ts emits a composite
  // "<px> / <ratio>" value. The matcher must compare both channels.
  describe('composite "px / ratio" observations (from the DOM)', () => {
    it('matches a unitless token via the derived ratio channel', () => {
      // This is the headline fix: a purely px observation used to orphan against
      // unitless tokens; the ratio channel now matches it.
      const result = matchLineHeight('24px / 1.5', [
        { category: 'lineHeight', name: 'normal', value: 1.5 },
      ]);
      expect(result.kind).toBe('match');
      expect(result.token?.name).toBe('normal');
    });

    it('matches a px token via the px channel', () => {
      const result = matchLineHeight('24px / 1.5', [
        { category: 'lineHeight', name: 'px24', value: '24px' },
      ]);
      expect(result.kind).toBe('match');
      expect(result.token?.name).toBe('px24');
    });

    it('matches when either token unit is present', () => {
      expect(matchLineHeight('24px / 1.5', lineHeights).kind).toBe('match');
    });

    it('near-matches on the ratio channel even when px is off', () => {
      // 25px ÷ ~16.3px = 1.53: px channel orphans (no near band), ratio near-matches.
      const result = matchLineHeight('25px / 1.53', lineHeights);
      expect(result.kind).toBe('near');
      expect(result.token?.name).toBe('normal');
      expect(result.deltaLabel).toBe('+0.03');
    });

    it('orphans when both channels are out of tolerance, still suggesting a token', () => {
      const result = matchLineHeight('30px / 1.875', lineHeights);
      expect(result.kind).toBe('orphan');
      expect(result.token).toBeDefined();
    });
  });
});
