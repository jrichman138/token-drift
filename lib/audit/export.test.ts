import { describe, expect, it } from 'vitest';
import { emptyTokenSet } from '../tokens/types';
import { aggregate } from './aggregate';
import { formatPercent, toHeadline, toJson, toMarkdown, verdictLabel } from './export';
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

function obs(category: any, property: string, value: string, selector: string): Observation {
  return { category, property, value, selector };
}

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

const URL = 'https://example.com/page';

describe('verdictLabel', () => {
  it('maps coherence bands to wording', () => {
    expect(verdictLabel(1)).toBe('On system');
    expect(verdictLabel(0.85)).toBe('Mostly on system');
    expect(verdictLabel(0.7)).toBe('Drifting');
    expect(verdictLabel(0.3)).toBe('Drifting off system');
  });
});

describe('toHeadline', () => {
  it('summarizes score, verdict, and violation counts in one line', () => {
    const result = aggregate(observations, tokenSet());
    expect(toHeadline(result, URL)).toBe(
      `Token Drift — ${formatPercent(result.coherence)} coherent (Drifting), 4 violations across 3 unique orphan values — ${URL}`,
    );
  });

  it('singularizes a lone violation and omits a missing url', () => {
    const tokens = emptyTokenSet();
    tokens.spacing = [{ category: 'spacing', name: '2', value: '8px' }];
    const result = aggregate([obs('spacing', 'padding-top', '9px', 'a')], tokens);
    expect(toHeadline(result, '')).toBe(
      'Token Drift — 0% coherent (Drifting off system), 1 violation across 1 unique orphan value',
    );
  });
});

describe('toMarkdown', () => {
  it('renders a readable report with totals, violations, and unused tokens', () => {
    const result = aggregate(observations, tokenSet());
    const md = toMarkdown(result, URL);
    expect(md).toContain('# Token Drift');
    expect(md).toContain(`**URL:** ${URL}`);
    expect(md).toContain('## Violations (4)');
    expect(md).toContain('`rgb(1, 2, 3)` ×2 (color)');
    expect(md).toContain('— at `e`, `f`');
    expect(md).toContain('## Unused tokens (1)');
    expect(md).toContain('- spacing.4');
  });

  it('caps orphan locations and notes the overflow', () => {
    const tokens = emptyTokenSet();
    tokens.spacing = [{ category: 'spacing', name: '2', value: '8px' }];
    const many = Array.from({ length: 10 }, (_, i) =>
      obs('spacing', 'padding-top', '9px', `s${i}`),
    );
    const md = toMarkdown(aggregate(many, tokens), URL);
    expect(md).toContain('+2 more');
  });
});

describe('toJson', () => {
  it('produces structured, parseable output with orphan locations', () => {
    const result = aggregate(observations, tokenSet());
    const parsed = JSON.parse(toJson(result, URL));
    expect(parsed.url).toBe(URL);
    expect(parsed.verdict).toBe('Drifting');
    expect(parsed.totals).toEqual({ instances: 11, matched: 7, near: 0, orphan: 4 });
    expect(parsed.orphans[0]).toMatchObject({
      value: 'rgb(1, 2, 3)',
      instanceCount: 2,
    });
    expect(parsed.orphans[0].locations).toEqual([
      { property: 'color', selector: 'e' },
      { property: 'color', selector: 'f' },
    ]);
    expect(parsed.unusedTokens).toEqual([
      { category: 'spacing', name: '4', value: '16px' },
    ]);
  });
});
