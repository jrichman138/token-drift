import { describe, expect, it } from 'vitest';
import { collectFromStyles, type ElementContext } from './extract';
import type { Observation } from './types';

const SIDES = ['top', 'right', 'bottom', 'left'];
const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];

// An all-"absence" computed-style map: transparent, zero, none, normal.
function baseStyles(): Record<string, string> {
  const styles: Record<string, string> = {
    color: '',
    'background-color': 'rgba(0, 0, 0, 0)',
    'box-shadow': 'none',
    display: 'block',
    'row-gap': 'normal',
    'column-gap': 'normal',
    'font-size': '',
    'font-weight': '',
    'font-family': '',
    'line-height': '',
  };
  for (const side of SIDES) {
    styles[`padding-${side}`] = '0px';
    styles[`margin-${side}`] = '0px';
    styles[`border-${side}-width`] = '0px';
    styles[`border-${side}-style`] = 'none';
    styles[`border-${side}-color`] = 'rgb(0, 0, 0)';
  }
  for (const corner of CORNERS) styles[`border-${corner}-radius`] = '0px';
  return styles;
}

function collect(overrides: Record<string, string>, hasText = false): Observation[] {
  const styles = { ...baseStyles(), ...overrides };
  const ctx: ElementContext = {
    selector: 'div',
    hasText,
    read: (property) => styles[property] ?? '',
  };
  return collectFromStyles(ctx);
}

function byCategory(obs: Observation[], category: string) {
  return obs.filter((o) => o.category === category);
}

describe('collectFromStyles', () => {
  it('emits nothing for a bare layout element with no real styles', () => {
    expect(collect({})).toEqual([]);
  });

  it('samples foreground color and typography only where text renders', () => {
    const overrides = {
      color: 'rgb(17, 24, 39)',
      'font-size': '16px',
      'font-weight': '400',
      'font-family': 'Inter, sans-serif',
      'line-height': '24px',
    };
    expect(collect(overrides, false)).toEqual([]); // no direct text -> skipped

    const withText = collect(overrides, true);
    expect(byCategory(withText, 'color').map((o) => o.property)).toEqual(['color']);
    expect(withText.map((o) => o.category)).toEqual(
      expect.arrayContaining(['color', 'fontSize', 'fontWeight', 'fontFamily', 'lineHeight']),
    );
  });

  it('skips line-height: normal', () => {
    const obs = collect({ 'font-size': '16px', 'line-height': 'normal' }, true);
    expect(obs.find((o) => o.category === 'lineHeight')).toBeUndefined();
  });

  it('emits line-height as a composite px + derived ratio', () => {
    // The browser resolves line-height to px; we attach the ratio (px ÷ font-size)
    // so the value stays matchable against both px and unitless tokens.
    const obs = collect({ 'font-size': '16px', 'line-height': '24px' }, true);
    expect(obs.find((o) => o.category === 'lineHeight')?.value).toBe('24px / 1.5');
  });

  it('falls back to px-only line-height when font-size is unavailable', () => {
    const obs = collect({ 'font-size': '', 'line-height': '24px' }, true);
    expect(obs.find((o) => o.category === 'lineHeight')?.value).toBe('24px');
  });

  it('records background only when not transparent', () => {
    expect(collect({ 'background-color': 'rgba(0, 0, 0, 0)' })).toEqual([]);
    const obs = collect({ 'background-color': 'rgb(255, 255, 255)' });
    expect(obs).toEqual([
      { category: 'color', property: 'background-color', value: 'rgb(255, 255, 255)', selector: 'div' },
    ]);
  });

  it('records a border color only on sides with a visible border', () => {
    const obs = collect({
      'border-top-width': '1px',
      'border-top-style': 'solid',
      'border-top-color': 'rgb(229, 231, 235)',
      // left has width but no style -> not visible
      'border-left-width': '1px',
      'border-left-style': 'none',
    });
    expect(obs).toEqual([
      { category: 'color', property: 'border-top-color', value: 'rgb(229, 231, 235)', selector: 'div' },
    ]);
  });

  it('records non-zero padding and margin, skipping zeros', () => {
    const obs = collect({ 'padding-top': '8px', 'margin-left': '-4px' });
    expect(byCategory(obs, 'spacing')).toEqual([
      { category: 'spacing', property: 'padding-top', value: '8px', selector: 'div' },
      { category: 'spacing', property: 'margin-left', value: '-4px', selector: 'div' },
    ]);
  });

  it('records gap only on flex/grid containers', () => {
    expect(collect({ display: 'block', 'row-gap': '16px' })).toEqual([]);
    const flex = collect({ display: 'flex', 'row-gap': '16px', 'column-gap': '8px' });
    expect(flex.map((o) => o.property)).toEqual(['row-gap', 'column-gap']);
  });

  it('records non-zero corner radii', () => {
    const obs = collect({ 'border-top-left-radius': '6px', 'border-bottom-right-radius': '6px' });
    expect(byCategory(obs, 'radius').map((o) => o.value)).toEqual(['6px', '6px']);
  });

  it('records a box-shadow only when not none', () => {
    expect(collect({ 'box-shadow': 'none' })).toEqual([]);
    const obs = collect({ 'box-shadow': 'rgba(0, 0, 0, 0.05) 0px 1px 2px 0px' });
    expect(obs).toEqual([
      {
        category: 'shadow',
        property: 'box-shadow',
        value: 'rgba(0, 0, 0, 0.05) 0px 1px 2px 0px',
        selector: 'div',
      },
    ]);
  });
});
