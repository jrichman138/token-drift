import { describe, expect, it } from 'vitest';
import { emptyTokenSet, type Token, type TokenCategory } from '../tokens/types';
import { aggregate } from './aggregate';
import type { Observation } from './types';

function tokenSet() {
  const tokens = emptyTokenSet();
  tokens.color = [
    { category: 'color', name: 'gray-500', value: '#6b7280' },
    { category: 'color', name: 'white', value: '#ffffff' },
  ];
  tokens.spacing = [
    { category: 'spacing', name: '2', value: '8px' },
    { category: 'spacing', name: '4', value: '16px' },
  ];
  tokens.fontWeight = [{ category: 'fontWeight', name: 'regular', value: 400 }];
  return tokens;
}

function obs(
  category: TokenCategory,
  property: string,
  value: string,
  selector: string,
): Observation {
  return { category, property, value, selector };
}

// 7 matched, 4 orphan, 11 total instances across color/spacing/fontWeight.
const observations: Observation[] = [
  obs('color', 'color', 'rgb(107, 114, 128)', 'a'),
  obs('color', 'color', 'rgb(107, 114, 128)', 'b'),
  obs('color', 'background-color', 'rgb(107, 114, 128)', 'c'),
  obs('color', 'background-color', 'rgb(255, 255, 255)', 'd'),
  obs('color', 'color', 'rgb(1, 2, 3)', 'e'),
  obs('color', 'color', 'rgb(1, 2, 3)', 'f'),
  obs('spacing', 'padding-top', '8px', 'g'),
  obs('spacing', 'margin-top', '8px', 'h'),
  obs('spacing', 'padding-left', '9px', 'i'),
  obs('fontWeight', 'font-weight', '400', 'j'),
  obs('fontWeight', 'font-weight', '600', 'k'),
];

describe('aggregate', () => {
  it('computes instance-weighted coherence and supporting numbers', () => {
    const result = aggregate(observations, tokenSet());
    expect(result.totals).toEqual({ instances: 11, matched: 7, near: 0, orphan: 4 });
    expect(result.coherence).toBeCloseTo(7 / 11, 6);
    expect(result.violations).toBe(4);
    expect(result.uniqueOrphans).toBe(3);
  });

  it('groups identical values and preserves every instance location', () => {
    const result = aggregate(observations, tokenSet());
    const gray = result.groups.find(
      (g) => g.category === 'color' && g.value === 'rgb(107, 114, 128)',
    );
    expect(gray?.kind).toBe('match');
    expect(gray?.token?.name).toBe('gray-500');
    expect(gray?.instanceCount).toBe(3);
    expect(gray?.instances.map((i) => i.selector)).toEqual(['a', 'b', 'c']);
  });

  it('lists orphans most-impactful first, with the closest token surfaced', () => {
    const result = aggregate(observations, tokenSet());
    expect(result.orphanGroups).toHaveLength(3);
    expect(result.orphanGroups[0].value).toBe('rgb(1, 2, 3)'); // 2 instances, the rest have 1
    expect(result.orphanGroups[0].token).toBeDefined();
  });

  it('reports tokens that never matched as unused', () => {
    const result = aggregate(observations, tokenSet());
    expect(result.unusedTokens.map((t) => `${t.category}.${t.name}`)).toEqual(['spacing.4']);
  });

  it('summarizes per category', () => {
    const result = aggregate(observations, tokenSet());
    const color = result.byCategory.find((c) => c.category === 'color');
    expect(color).toMatchObject({
      instances: 6,
      matched: 4,
      near: 0,
      orphan: 2,
      uniqueValues: 3,
      uniqueOrphans: 1,
    });
  });

  it('counts near-matches at half credit', () => {
    const tokens = emptyTokenSet();
    tokens.color = [{ category: 'color', name: 'gray-500', value: '#6b7280' }];
    const result = aggregate(
      [
        obs('color', 'color', 'rgb(107, 114, 128)', 'a'), // exact
        obs('color', 'color', 'rgb(107, 114, 128)', 'b'), // exact
        obs('color', 'color', '#6d7482', 'c'), // ΔE ~0.79 -> near
        obs('color', 'color', '#6d7482', 'd'), // near
      ],
      tokens,
    );
    expect(result.totals).toEqual({ instances: 4, matched: 2, near: 2, orphan: 0 });
    expect(result.coherence).toBeCloseTo(0.75, 6); // (2 + 2*0.5) / 4
    expect(result.violations).toBe(0);
  });

  it('treats an empty page as fully coherent with all tokens unused', () => {
    const tokens = tokenSet();
    const result = aggregate([], tokens);
    expect(result.coherence).toBe(1);
    expect(result.violations).toBe(0);
    expect(result.unusedTokens).toHaveLength(5);
  });
});
