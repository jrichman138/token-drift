import type { Observation } from './audit/types';

// Side panel -> content script: please sample this page now.
export interface AuditRequest {
  type: 'audit:run';
}

// Content script -> side panel: the sampled page, or why it failed. `notices`
// carries non-fatal sampling notes (e.g. a large page was truncated) for the UI.
export type AuditResponse =
  | { ok: true; url: string; observations: Observation[]; notices?: string[] }
  | { ok: false; error: string };

export const AUDIT_REQUEST: AuditRequest = { type: 'audit:run' };

export function isAuditRequest(message: unknown): message is AuditRequest {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'audit:run'
  );
}

// Side panel -> content script: outline these elements on the page and scroll
// the first into view. Highlights persist until a clear request arrives.
export interface HighlightRequest {
  type: 'highlight:show';
  selectors: string[];
  label?: string;
}

// Side panel -> content script: remove any active highlights.
export interface ClearHighlightRequest {
  type: 'highlight:clear';
}

// Content script -> side panel: how many selectors actually resolved.
export type HighlightResponse =
  | { ok: true; found: number; missing: string[] }
  | { ok: false; error: string };

export const CLEAR_HIGHLIGHT: ClearHighlightRequest = { type: 'highlight:clear' };

export function highlightRequest(selectors: string[], label?: string): HighlightRequest {
  return { type: 'highlight:show', selectors, label };
}

export function isHighlightRequest(message: unknown): message is HighlightRequest {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'highlight:show'
  );
}

export function isClearHighlightRequest(message: unknown): message is ClearHighlightRequest {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'highlight:clear'
  );
}
