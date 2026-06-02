// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { buildSelector, extractObservations, extractPage } from './dom';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('buildSelector', () => {
  it('returns an id selector when the element has an id', () => {
    document.body.innerHTML = '<div id="target">x</div>';
    expect(buildSelector(document.getElementById('target')!)).toBe('#target');
  });

  it('stops at the nearest ancestor with an id', () => {
    document.body.innerHTML = '<div id="root"><span>x</span></div>';
    const span = document.querySelector('span')!;
    expect(buildSelector(span)).toBe('#root > span');
  });

  it('uses :nth-of-type to disambiguate same-tag siblings', () => {
    document.body.innerHTML = '<section><p>one</p><p>two</p></section>';
    const second = document.querySelectorAll('p')[1]!;
    expect(buildSelector(second)).toBe('body > section > p:nth-of-type(2)');
  });
});

describe('extractObservations', () => {
  it('samples styled elements and skips script/style/hidden ones', () => {
    document.body.innerHTML = `
      <style>.x{color:red}</style>
      <script>var a = 1;</script>
      <p id="text" style="color: rgb(0, 0, 0); font-size: 16px; font-weight: 700; font-family: Inter, sans-serif; line-height: 24px;">Hello</p>
      <div id="hidden" style="display: none; background-color: rgb(255, 255, 255);"></div>
      <div id="box" style="background-color: rgb(255, 255, 255); padding-top: 8px;">box</div>
    `;

    const observations = extractObservations();

    // Typography + color sampled from the text paragraph.
    const fontSize = observations.find((o) => o.property === 'font-size');
    expect(fontSize).toMatchObject({ category: 'fontSize', value: '16px', selector: '#text' });
    expect(observations.some((o) => o.property === 'color' && o.selector === '#text')).toBe(true);

    // Only the visible box contributes a background; the hidden div is skipped.
    const backgrounds = observations.filter((o) => o.property === 'background-color');
    expect(backgrounds).toHaveLength(1);
    expect(backgrounds[0].selector).toBe('#box');

    // The padding on the visible box is captured.
    expect(observations.some((o) => o.property === 'padding-top' && o.value === '8px')).toBe(true);

    // Nothing leaks from <script>/<style> text.
    expect(observations.every((o) => o.selector !== 'style' && o.selector !== 'script')).toBe(true);
  });

  it('caps how many elements it samples', () => {
    document.body.innerHTML = Array.from(
      { length: 6 },
      (_, i) => `<div style="background-color: rgb(255, 255, 255);">${i}</div>`,
    ).join('');

    const backgrounds = (obs: { property: string }[]) =>
      obs.filter((o) => o.property === 'background-color').length;

    // Each div contributes one explicit background; the cap limits how many we reach.
    expect(backgrounds(extractObservations(document.body, 100))).toBe(6);
    expect(backgrounds(extractObservations(document.body, 2))).toBeLessThanOrEqual(2);
  });
});

describe('extractPage', () => {
  it('reports truncation when the page exceeds the element cap', () => {
    document.body.innerHTML = Array.from(
      { length: 5 },
      () => '<div style="background-color: rgb(255, 255, 255);">x</div>',
    ).join('');

    const sample = extractPage(document.body, 3);
    expect(sample.truncated).toBe(true);
    expect(sample.elementCount).toBe(5);
    expect(sample.sampledElements).toBe(3);

    const whole = extractPage(document.body, 100);
    expect(whole.truncated).toBe(false);
    expect(whole.sampledElements).toBe(5);
  });
});
