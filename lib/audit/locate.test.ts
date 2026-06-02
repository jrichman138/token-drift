import { describe, expect, it } from 'vitest';
import { resolveSelectors } from './locate';

// A tiny stand-in for a queried element.
type Node = { id: string };

function makeQuery(map: Record<string, Node[]>) {
  return (selector: string): Node[] => map[selector] ?? [];
}

describe('resolveSelectors', () => {
  it('collects every matched element across selectors', () => {
    const a = { id: 'a' };
    const b = { id: 'b' };
    const c = { id: 'c' };
    const query = makeQuery({ '.one': [a, b], '.two': [c] });
    const { found, missing } = resolveSelectors(['.one', '.two'], query);
    expect(found).toEqual([a, b, c]);
    expect(missing).toEqual([]);
  });

  it('de-duplicates elements that match more than one selector', () => {
    const a = { id: 'a' };
    const query = makeQuery({ '.x': [a], '.y': [a] });
    const { found } = resolveSelectors(['.x', '.y'], query);
    expect(found).toEqual([a]);
  });

  it('reports selectors that match nothing', () => {
    const a = { id: 'a' };
    const query = makeQuery({ '.hit': [a] });
    const { found, missing } = resolveSelectors(['.hit', '.gone'], query);
    expect(found).toEqual([a]);
    expect(missing).toEqual(['.gone']);
  });

  it('treats a malformed selector as missing instead of throwing', () => {
    const query = (selector: string): Node[] => {
      if (selector === 'bad>>') throw new Error('invalid selector');
      return [{ id: 'ok' }];
    };
    const { found, missing } = resolveSelectors(['bad>>', '.fine'], query);
    expect(found).toEqual([{ id: 'ok' }]);
    expect(missing).toEqual(['bad>>']);
  });
});
