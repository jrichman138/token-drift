// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditResult, ValueGroup } from '../../lib/audit/aggregate';
import type { Token } from '../../lib/tokens/types';
import { Report } from './Report';

// React's act() needs this flag set to behave as a test environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function renderReport(props: {
  result: AuditResult;
  warnings: string[];
  url: string;
  notices?: string[];
}) {
  act(() => {
    root.render(<Report {...props} />);
  });
}

beforeEach(() => {
  // Force "reduced motion" so the verdict score jumps straight to its final
  // value (no rAF count-up, no confetti) — keeps assertions deterministic.
  window.matchMedia = vi.fn().mockReturnValue({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  delete (globalThis as { browser?: unknown }).browser;
});

// ---- fixtures -------------------------------------------------------------

function token(category: Token['category'], name: string, value: string | number): Token {
  return { category, name, value };
}

function orphanGroup(overrides: Partial<ValueGroup> = {}): ValueGroup {
  return {
    category: 'color',
    value: '#ff00aa',
    kind: 'orphan',
    instanceCount: 1,
    instances: [{ property: 'color', selector: '#a' }],
    ...overrides,
  };
}

function makeResult(overrides: Partial<AuditResult> = {}): AuditResult {
  return {
    coherence: 0.86,
    totals: { instances: 100, matched: 80, near: 12, orphan: 8 },
    violations: 8,
    uniqueOrphans: 2,
    groups: [],
    orphanGroups: [],
    unusedTokens: [],
    byCategory: [
      {
        category: 'color',
        instances: 40,
        matched: 30,
        near: 6,
        orphan: 4,
        uniqueValues: 10,
        uniqueOrphans: 2,
      },
      // A zero-instance category should be filtered out of the table.
      {
        category: 'shadow',
        instances: 0,
        matched: 0,
        near: 0,
        orphan: 0,
        uniqueValues: 0,
        uniqueOrphans: 0,
      },
    ],
    ...overrides,
  };
}

const baseProps = { warnings: [], url: 'https://example.com/page' };

// ---- tests ----------------------------------------------------------------

describe('Report verdict card', () => {
  it('shows the rounded coherence percent and its plain-English label', () => {
    renderReport({ ...baseProps, result: makeResult({ coherence: 0.864 }) });

    const score = container.querySelector('.verdict__score');
    expect(score?.textContent).toBe('86%');
    expect(score?.getAttribute('aria-label')).toBe('86%');
    expect(container.querySelector('.verdict__label')?.textContent).toBe('Mostly on system');
  });

  it.each([
    [0.97, 'verdict--good'],
    [0.86, 'verdict--ok'],
    [0.72, 'verdict--warn'],
    [0.48, 'verdict--bad'],
  ])('maps coherence %f to the %s tone band', (coherence, cls) => {
    renderReport({ ...baseProps, result: makeResult({ coherence }) });
    expect(container.querySelector('.verdict')?.classList.contains(cls)).toBe(true);
  });

  it('renders the audited URL', () => {
    renderReport({ ...baseProps, result: makeResult() });
    expect(container.querySelector('.verdict__url')?.textContent).toBe('https://example.com/page');
  });
});

describe('Report drift table', () => {
  it('renders the four totals tiles', () => {
    renderReport({ ...baseProps, result: makeResult() });
    const values = [...container.querySelectorAll('.stat__value')].map((n) => n.textContent);
    expect(values).toEqual(['100', '80', '12', '8']);
  });

  it('omits categories with zero instances from the table', () => {
    renderReport({ ...baseProps, result: makeResult() });
    const rows = [...container.querySelectorAll('.health__table tbody tr')];
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector('th[scope="row"]')?.textContent).toBe('color');
  });
});

describe('Report violations', () => {
  it('shows the empty state when there are no orphan groups', () => {
    renderReport({ ...baseProps, result: makeResult({ orphanGroups: [] }) });
    expect(container.querySelector('.violations .empty')?.textContent).toContain('No orphan values');
  });

  it('lists each orphan value with its count and closest-token suggestion', () => {
    const result = makeResult({
      violations: 5,
      orphanGroups: [
        orphanGroup({
          value: '#ff00aa',
          instanceCount: 5,
          instances: [
            { property: 'color', selector: '#a' },
            { property: 'color', selector: '#b' },
          ],
          token: token('color', 'pink-500', '#ec4899'),
          deltaLabel: 'ΔE 3.1',
        }),
      ],
    });
    renderReport({ ...baseProps, result });

    expect(container.querySelector('.violations .count')?.textContent).toBe('5');
    expect(container.querySelector('.violation__value')?.textContent).toBe('#ff00aa');
    expect(container.querySelector('.violation__locate')?.textContent).toBe('Show on page ×5');
    expect(container.querySelector('.violation__suggest')?.textContent).toContain(
      'closest: color.pink-500',
    );
    expect(container.querySelector('.violation__suggest')?.textContent).toContain('ΔE 3.1');
  });

  it('caps selector chips at six and shows an overflow count', () => {
    const instances = Array.from({ length: 9 }, (_, i) => ({
      property: 'color',
      selector: `#sel-${i}`,
    }));
    const result = makeResult({
      orphanGroups: [orphanGroup({ instanceCount: 9, instances })],
    });
    renderReport({ ...baseProps, result });

    expect(container.querySelectorAll('.selector-chip')).toHaveLength(6);
    expect(container.querySelector('.violation__overflow')?.textContent).toBe('+3 more');
  });
});

describe('Report unused tokens', () => {
  it('shows the empty state when every token is used', () => {
    renderReport({ ...baseProps, result: makeResult({ unusedTokens: [] }) });
    expect(container.querySelector('.unused .empty')?.textContent).toContain('Every token is in use');
  });

  it('renders a chip per unused token', () => {
    const result = makeResult({
      unusedTokens: [token('color', 'gray-50', '#f9fafb'), token('spacing', 'lg', '24px')],
    });
    renderReport({ ...baseProps, result });
    const chips = [...container.querySelectorAll('.unused__list li')].map((n) => n.textContent);
    expect(chips).toEqual(['color.gray-50', 'spacing.lg']);
  });
});

describe('Report warnings', () => {
  it('hides the warnings section when there are none', () => {
    renderReport({ ...baseProps, result: makeResult() });
    expect(container.querySelector('.warnings')).toBeNull();
  });

  it('lists token warnings when present', () => {
    renderReport({
      ...baseProps,
      warnings: ['Skipped 2 malformed color tokens'],
      result: makeResult(),
    });
    const items = [...container.querySelectorAll('.warnings li')].map((n) => n.textContent);
    expect(items).toEqual(['Skipped 2 malformed color tokens']);
  });
});

describe('Report empty state', () => {
  it('shows "Nothing to audit" instead of a 100% verdict on a zero-instance page', () => {
    const result = makeResult({
      coherence: 1,
      totals: { instances: 0, matched: 0, near: 0, orphan: 0 },
      violations: 0,
      uniqueOrphans: 0,
      byCategory: [],
    });
    renderReport({ ...baseProps, result });

    expect(container.querySelector('.verdict__label')?.textContent).toBe('Nothing to audit');
    // No score, no confetti, no drift table.
    expect(container.querySelector('.verdict__score')).toBeNull();
    expect(container.querySelector('.confetti')).toBeNull();
    expect(container.querySelector('.health')).toBeNull();
  });

  it('still surfaces notices in the empty state', () => {
    const result = makeResult({
      totals: { instances: 0, matched: 0, near: 0, orphan: 0 },
      byCategory: [],
    });
    renderReport({ ...baseProps, notices: ['Large page: sampled the first 25,000 of 80,000.'], result });
    const items = [...container.querySelectorAll('.notices li')].map((n) => n.textContent);
    expect(items).toEqual(['Large page: sampled the first 25,000 of 80,000.']);
  });
});

describe('Report footnotes', () => {
  it('explains the near-match half-credit rule', () => {
    renderReport({ ...baseProps, result: makeResult() });
    expect(container.querySelector('.health__note')?.textContent).toContain('half credit');
  });

  it('flags multi-layer shadows as a known v1 limitation', () => {
    const single = makeResult({
      orphanGroups: [
        orphanGroup({ category: 'shadow', value: 'rgba(0, 0, 0, 0.05) 0px 1px 2px 0px' }),
      ],
    });
    renderReport({ ...baseProps, result: single });
    expect(container.querySelector('.violations__note')).toBeNull();

    const multi = makeResult({
      orphanGroups: [
        orphanGroup({
          category: 'shadow',
          value: 'rgba(0,0,0,0.1) 0px 1px 2px 0px, rgba(0,0,0,0.06) 0px 2px 4px 0px',
        }),
      ],
    });
    renderReport({ ...baseProps, result: multi });
    expect(container.querySelector('.violations__note')?.textContent).toContain('Multi-layer');
  });

  it('renders page notices in the main report', () => {
    renderReport({ ...baseProps, notices: ['Large page note'], result: makeResult() });
    const items = [...container.querySelectorAll('.notices li')].map((n) => n.textContent);
    expect(items).toEqual(['Large page note']);
  });
});

describe('Report highlight messaging', () => {
  it('messages the active tab and reports status when locating a violation', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, found: 2, missing: [] });
    const query = vi.fn().mockResolvedValue([{ id: 99 }]);
    (globalThis as { browser?: unknown }).browser = {
      tabs: { query, sendMessage },
    };

    const result = makeResult({
      orphanGroups: [
        orphanGroup({
          value: '#ff00aa',
          instanceCount: 2,
          instances: [
            { property: 'color', selector: '#a' },
            { property: 'color', selector: '#b' },
          ],
        }),
      ],
    });
    renderReport({ ...baseProps, result });

    const locate = container.querySelector<HTMLButtonElement>('.violation__locate')!;
    await act(async () => {
      locate.click();
    });
    // Flush the chained awaits inside the async click handler.
    await act(async () => {});

    expect(query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(sendMessage).toHaveBeenCalledWith(99, {
      type: 'highlight:show',
      selectors: ['#a', '#b'],
      label: 'color #ff00aa',
    });
    expect(container.querySelector('.violations__status')?.textContent).toBe(
      'Highlighted 2 on the page.',
    );
    // The clear-highlight control appears once a group is active.
    expect(container.querySelector('.violations__clear')).not.toBeNull();
  });
});
