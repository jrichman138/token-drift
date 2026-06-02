import { describe, expect, it } from 'vitest';
import type { Token } from '../tokens/types';
import { matchColor } from './color';

const tokens: Token[] = [
  { category: 'color', name: 'gray-500', value: '#6b7280' },
  { category: 'color', name: 'gray-400', value: '#9ca3af' },
  { category: 'color', name: 'red-500', value: '#ef4444' },
];

describe('matchColor', () => {
  it('treats an equivalent color (rgb vs hex) as an exact match', () => {
    const result = matchColor('rgb(107, 114, 128)', tokens);
    expect(result.kind).toBe('match');
    expect(result.token?.name).toBe('gray-500');
    expect(result.distance).toBeLessThan(0.1);
  });

  it('classifies a color within ΔE 2.0 as a near-match', () => {
    const result = matchColor('#6d7482', tokens); // ΔE ~0.79 to gray-500
    expect(result.kind).toBe('near');
    expect(result.token?.name).toBe('gray-500');
    expect(result.deltaLabel).toBe('ΔE 0.8');
  });

  it('classifies a color beyond ΔE 2.0 as an orphan and surfaces the closest token', () => {
    const result = matchColor('#717a8a', tokens); // ΔE ~3.23 to gray-500
    expect(result.kind).toBe('orphan');
    expect(result.token?.name).toBe('gray-500');
    expect(result.deltaLabel).toBe('ΔE 3.2');
  });

  it('picks the nearest token when several exist', () => {
    const result = matchColor('#ef4444', tokens);
    expect(result.kind).toBe('match');
    expect(result.token?.name).toBe('red-500');
  });

  it('honors a custom tolerance', () => {
    const strict = matchColor('#6d7482', tokens, { tolerance: 0.5 }); // 0.79 > 0.5
    expect(strict.kind).toBe('orphan');
    const loose = matchColor('#717a8a', tokens, { tolerance: 5 }); // 3.23 <= 5
    expect(loose.kind).toBe('near');
  });

  it('returns an orphan with no token for an unparseable color', () => {
    const result = matchColor('not-a-color', tokens);
    expect(result.kind).toBe('orphan');
    expect(result.token).toBeUndefined();
  });

  it('returns an orphan with no token when there are no color tokens', () => {
    const result = matchColor('#6b7280', []);
    expect(result.kind).toBe('orphan');
    expect(result.token).toBeUndefined();
  });
});
