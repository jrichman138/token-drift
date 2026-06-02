import { describe, expect, it } from 'vitest';
import type { Token } from '../tokens/types';
import { matchFontFamily } from './font-family';

const families: Token[] = [
  { category: 'fontFamily', name: 'sans', value: 'Inter, system-ui, sans-serif' },
  { category: 'fontFamily', name: 'serif', value: 'Georgia, serif' },
  { category: 'fontFamily', name: 'mono', value: "'JetBrains Mono', monospace" },
];

describe('matchFontFamily', () => {
  it('matches when the primary family is in a token stack (quotes normalized)', () => {
    const result = matchFontFamily('"Inter", system-ui, sans-serif', families);
    expect(result.kind).toBe('match');
    expect(result.token?.name).toBe('sans');
  });

  it('matches a single primary family against a token stack', () => {
    expect(matchFontFamily('Inter', families).token?.name).toBe('sans');
    expect(matchFontFamily('Georgia', families).token?.name).toBe('serif');
  });

  it('matches a quoted family with spaces', () => {
    const result = matchFontFamily("'JetBrains Mono', monospace", families);
    expect(result.kind).toBe('match');
    expect(result.token?.name).toBe('mono');
  });

  it('orphans an unknown primary, suggesting the token with the most overlap', () => {
    const result = matchFontFamily('Arial, sans-serif', families);
    expect(result.kind).toBe('orphan');
    expect(result.token?.name).toBe('sans'); // shares sans-serif
    expect(result.deltaLabel).toBe('uses "Arial"');
  });

  it('orphans with the first token when there is no overlap at all', () => {
    const result = matchFontFamily('Comic Sans MS', families);
    expect(result.kind).toBe('orphan');
    expect(result.token?.name).toBe('sans');
  });

  it('returns an orphan with no token for an empty family', () => {
    const result = matchFontFamily('', families);
    expect(result.kind).toBe('orphan');
    expect(result.token).toBeUndefined();
  });
});
