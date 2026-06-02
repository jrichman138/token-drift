import { describe, expect, it } from 'vitest';
import type { Token } from '../tokens/types';
import { classify } from './index';

const tokens: Record<string, Token[]> = {
  color: [{ category: 'color', name: 'gray-500', value: '#6b7280' }],
  spacing: [{ category: 'spacing', name: '2', value: '8px' }],
  fontSize: [{ category: 'fontSize', name: 'base', value: '16px' }],
  radius: [{ category: 'radius', name: 'md', value: '6px' }],
  fontWeight: [{ category: 'fontWeight', name: 'regular', value: 400 }],
  fontFamily: [{ category: 'fontFamily', name: 'sans', value: 'Inter, sans-serif' }],
  lineHeight: [{ category: 'lineHeight', name: 'normal', value: 1.5 }],
  shadow: [{ category: 'shadow', name: 'sm', value: '0 1px 2px rgba(0,0,0,0.05)' }],
};

describe('classify dispatcher', () => {
  it('routes each category to its matcher (exact-match cases)', () => {
    expect(classify('color', 'rgb(107, 114, 128)', tokens.color).kind).toBe('match');
    expect(classify('spacing', '8px', tokens.spacing).kind).toBe('match');
    expect(classify('fontSize', '16px', tokens.fontSize).kind).toBe('match');
    expect(classify('radius', '6px', tokens.radius).kind).toBe('match');
    expect(classify('fontWeight', '400', tokens.fontWeight).kind).toBe('match');
    expect(classify('fontFamily', 'Inter', tokens.fontFamily).kind).toBe('match');
    expect(classify('lineHeight', 1.5, tokens.lineHeight).kind).toBe('match');
    expect(classify('shadow', '0px 1px 2px rgba(0,0,0,0.05)', tokens.shadow).kind).toBe('match');
  });

  it('threads tolerance options through to the matcher', () => {
    // #717a8a is ΔE ~3.23 from gray-500: orphan by default, near with a wider tolerance.
    expect(classify('color', '#717a8a', tokens.color).kind).toBe('orphan');
    expect(classify('color', '#717a8a', tokens.color, { colorTolerance: 5 }).kind).toBe('near');
  });
});
