import { collectFromStyles, type ElementContext } from './extract';
import type { Observation } from './types';

// Tags that never carry auditable visual style.
const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'META',
  'LINK',
  'HEAD',
  'TITLE',
  'NOSCRIPT',
  'TEMPLATE',
  'BR',
  'WBR',
]);

// Hard ceiling on how many elements we sample in one audit. getComputedStyle is
// the expensive per-element call; on pathological pages (tens of thousands of
// nodes) an uncapped walk can lock the tab for seconds. We sample the first N in
// document order and let the caller surface that the page was truncated — see
// `extractPage`, which reports the total so the UI can say what was covered.
export const MAX_AUDIT_ELEMENTS = 25_000;

// What an audit sampled, plus how much of the page it covered. `truncated` is
// true when the page had more elements than `MAX_AUDIT_ELEMENTS`, so the side
// panel can tell the designer the report reflects only the top of the page.
export interface PageSample {
  observations: Observation[];
  elementCount: number;
  sampledElements: number;
  truncated: boolean;
}

// Walks the visible elements under `root`, reading computed styles and applying
// the sampling rules. This is the only browser-dependent part of the auditor;
// the rules it delegates to (collectFromStyles) are pure and unit tested.
export function extractObservations(
  root: ParentNode = document.body,
  maxElements: number = MAX_AUDIT_ELEMENTS,
): Observation[] {
  const out: Observation[] = [];
  const elements = root.querySelectorAll('*');
  const limit = Math.min(elements.length, maxElements);
  for (let i = 0; i < limit; i++) {
    const element = elements[i];
    if (!(element instanceof HTMLElement)) continue;
    if (SKIP_TAGS.has(element.tagName)) continue;

    const computed = getComputedStyle(element);
    if (!isVisible(element, computed)) continue;

    const ctx: ElementContext = {
      selector: buildSelector(element),
      hasText: hasDirectText(element),
      read: (property) => computed.getPropertyValue(property),
    };
    out.push(...collectFromStyles(ctx));
  }
  return out;
}

// Samples the page and reports how much of it was covered. The content script
// uses this (rather than extractObservations directly) so the report can warn
// when a huge page was truncated.
export function extractPage(
  root: ParentNode = document.body,
  maxElements: number = MAX_AUDIT_ELEMENTS,
): PageSample {
  const elementCount = root.querySelectorAll('*').length;
  const sampledElements = Math.min(elementCount, maxElements);
  return {
    observations: extractObservations(root, maxElements),
    elementCount,
    sampledElements,
    truncated: elementCount > maxElements,
  };
}

function isVisible(element: HTMLElement, computed: CSSStyleDeclaration): boolean {
  if (element.hidden) return false;
  if (computed.display === 'none') return false;
  if (computed.visibility === 'hidden' || computed.visibility === 'collapse') return false;
  return true;
}

function hasDirectText(element: Element): boolean {
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === 3 && (node.textContent ?? '').trim() !== '') return true;
  }
  return false;
}

// Builds a reasonably specific CSS selector path. Stops at the nearest ancestor
// with an id (which makes the path unique); otherwise uses :nth-of-type to
// disambiguate siblings.
export function buildSelector(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current.nodeType === 1 && current.tagName !== 'HTML') {
    if (current instanceof HTMLElement && current.id) {
      parts.unshift(`#${escapeId(current.id)}`);
      break;
    }
    let part = current.tagName.toLowerCase();
    const index = nthOfType(current);
    if (index > 0) part += `:nth-of-type(${index})`;
    parts.unshift(part);
    current = current.parentElement;
  }
  return parts.join(' > ');
}

function nthOfType(element: Element): number {
  const parent = element.parentElement;
  if (!parent) return 0;
  const sameTag = Array.from(parent.children).filter((c) => c.tagName === element.tagName);
  if (sameTag.length < 2) return 0;
  return sameTag.indexOf(element) + 1;
}

function escapeId(id: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(id);
  return id.replace(/([^\w-])/g, '\\$1');
}
