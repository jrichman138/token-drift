// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Highlighter, OVERLAY_ID } from './highlight';

let highlighter: Highlighter;

beforeEach(() => {
  document.documentElement.innerHTML = '<head></head><body></body>';
  highlighter = new Highlighter();
});

afterEach(() => {
  highlighter.clear();
});

function targets(n: number): Element[] {
  document.body.innerHTML = Array.from({ length: n }, (_, i) => `<div id="t${i}">x</div>`).join('');
  return [...document.body.querySelectorAll('div')];
}

const overlay = () => document.getElementById(OVERLAY_ID);

describe('Highlighter', () => {
  it('mounts an overlay with one box per target plus a badge', () => {
    highlighter.show(targets(3), 'color #ff00aa');

    expect(highlighter.active).toBe(true);
    const root = overlay();
    expect(root).not.toBeNull();
    // 3 boxes + 1 badge div.
    expect(root?.querySelectorAll('div').length).toBe(4);
    expect(root?.textContent).toContain('color #ff00aa');
    expect(root?.textContent).toContain('3 highlighted');
  });

  it('does nothing when there are no targets', () => {
    highlighter.show([]);
    expect(highlighter.active).toBe(false);
    expect(overlay()).toBeNull();
  });

  it('replaces a previous overlay rather than stacking them', () => {
    highlighter.show(targets(2));
    highlighter.show(targets(1));
    expect(document.querySelectorAll(`#${OVERLAY_ID}`).length).toBe(1);
  });

  it('clear() removes the overlay and deactivates', () => {
    highlighter.show(targets(2));
    highlighter.clear();
    expect(highlighter.active).toBe(false);
    expect(overlay()).toBeNull();
  });

  it('the badge Clear button tears the overlay down', () => {
    highlighter.show(targets(2));
    const button = overlay()?.querySelector('button');
    expect(button).not.toBeNull();
    button?.dispatchEvent(new Event('click'));
    expect(overlay()).toBeNull();
  });

  it('omits the label prefix when none is given', () => {
    highlighter.show(targets(1));
    expect(overlay()?.textContent).toContain('· 1 highlighted');
  });
});
