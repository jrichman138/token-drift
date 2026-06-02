import { describe, expect, it } from 'vitest';
import type { Token } from '../tokens/types';
import { matchShadow } from './shadow';

const shadows: Token[] = [
  { category: 'shadow', name: 'sm', value: '0 1px 2px rgba(0,0,0,0.05)' },
  { category: 'shadow', name: 'md', value: '0 4px 6px rgba(0,0,0,0.1)' },
];

describe('matchShadow', () => {
  it('matches a shadow written in the browser computed format (color first, with spread)', () => {
    const result = matchShadow('rgba(0, 0, 0, 0.05) 0px 1px 2px 0px', shadows);
    expect(result.kind).toBe('match');
    expect(result.token?.name).toBe('sm');
  });

  it('matches an equivalent shadow regardless of component order/spacing', () => {
    expect(matchShadow('0px 1px 2px rgba(0,0,0,0.05)', shadows).kind).toBe('match');
  });

  it('treats a ≤1px dimension drift as a near-match', () => {
    const result = matchShadow('0px 1px 3px rgba(0,0,0,0.05)', shadows); // blur +1
    expect(result.kind).toBe('near');
    expect(result.token?.name).toBe('sm');
  });

  it('orphans a >1px dimension drift', () => {
    const result = matchShadow('0px 1px 4px rgba(0,0,0,0.05)', shadows); // blur +2
    expect(result.kind).toBe('orphan');
    expect(result.token?.name).toBe('sm');
  });

  it('treats a color within ΔE 2.0 as a near-match', () => {
    const result = matchShadow('0px 1px 2px rgba(10,10,10,0.05)', shadows); // ΔE ~1.59
    expect(result.kind).toBe('near');
    expect(result.token?.name).toBe('sm');
  });

  it('orphans a color beyond ΔE 2.0', () => {
    const result = matchShadow('0px 1px 2px rgba(40,40,40,0.05)', shadows); // ΔE ~9.9
    expect(result.kind).toBe('orphan');
  });

  it('does not compare inset against non-inset shadows', () => {
    const result = matchShadow('inset 0px 1px 2px rgba(0,0,0,0.05)', shadows);
    expect(result.kind).toBe('orphan');
    expect(result.token).toBeUndefined();
  });

  it('treats multi-shadow values as not comparable in v1', () => {
    const result = matchShadow('0 1px 2px #000, 0 2px 4px #111', shadows);
    expect(result.kind).toBe('orphan');
    expect(result.token).toBeUndefined();
  });

  it('parses a modern oklab() shadow color (Chrome computed serialization)', () => {
    // oklab roughly equal to rgba(0,0,0,0.05); should still match the `sm` token.
    const result = matchShadow('oklab(0 0 0 / 0.05) 0px 1px 2px 0px', shadows);
    expect(result.kind).toBe('match');
    expect(result.token?.name).toBe('sm');
  });

  it('parses an lch() shadow color rather than orphaning it', () => {
    const result = matchShadow('lch(0% 0 0 / 0.05) 0px 1px 2px 0px', shadows);
    expect(result.kind).toBe('match');
    expect(result.token?.name).toBe('sm');
  });

  it('returns an orphan with no token for "none"', () => {
    const result = matchShadow('none', shadows);
    expect(result.kind).toBe('orphan');
    expect(result.token).toBeUndefined();
  });
});
