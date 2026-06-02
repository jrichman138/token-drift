import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import type { AuditResult, CategorySummary, ValueGroup } from '@/lib/audit/aggregate';
import { formatPercent, toHeadline, toJson, toMarkdown, verdictLabel } from '@/lib/audit/export';
import {
  CLEAR_HIGHLIGHT,
  type HighlightResponse,
  highlightRequest,
} from '@/lib/messaging';
import type { Token, TokenCategory } from '@/lib/tokens/types';

// How many instance selectors to show as chips before collapsing the rest.
const MAX_SELECTOR_CHIPS = 6;

function tone(coherence: number): string {
  if (coherence >= 0.95) return 'good';
  if (coherence >= 0.8) return 'ok';
  if (coherence >= 0.6) return 'warn';
  return 'bad';
}

function tokenLabel(token: Token): string {
  return `${token.category}.${token.name}`;
}

type ViolationSort = 'impact' | 'closest' | 'value' | 'category';

const SORT_LABELS: Record<ViolationSort, string> = {
  impact: 'Most instances',
  closest: 'Closest token',
  value: 'Value (A–Z)',
  category: 'Category',
};

// Orders the violations list for display. `impact` mirrors the aggregate's
// default (most instances first); the others let the designer re-cut the list.
function sortGroups(groups: ValueGroup[], sort: ViolationSort): ValueGroup[] {
  const copy = [...groups];
  const dist = (g: ValueGroup) => g.distance ?? Number.POSITIVE_INFINITY;
  switch (sort) {
    case 'closest':
      return copy.sort((a, b) => dist(a) - dist(b) || a.value.localeCompare(b.value));
    case 'value':
      return copy.sort((a, b) => a.value.localeCompare(b.value));
    case 'category':
      return copy.sort(
        (a, b) => a.category.localeCompare(b.category) || b.instanceCount - a.instanceCount,
      );
    default:
      return copy.sort(
        (a, b) =>
          b.instanceCount - a.instanceCount ||
          dist(a) - dist(b) ||
          a.value.localeCompare(b.value),
      );
  }
}

// A shadow value with more than one top-level (comma-separated, outside parens)
// layer. v1 only matches single-layer shadows component-wise; multi-layer ones
// always land in the violations list, so the report says so rather than implying
// the designer's stacked shadow is "wrong".
function isMultiLayerShadow(value: string): boolean {
  let depth = 0;
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) return true;
  }
  return false;
}

async function sendHighlight(selectors: string[], label?: string): Promise<HighlightResponse> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { ok: false, error: 'No active tab to highlight.' };
  try {
    return (await browser.tabs.sendMessage(
      tab.id,
      highlightRequest(selectors, label),
    )) as HighlightResponse;
  } catch {
    return { ok: false, error: 'Could not reach the page. Reload the tab, then try again.' };
  }
}

async function sendClear(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await browser.tabs.sendMessage(tab.id, CLEAR_HIGHLIGHT);
  } catch {
    // Page is gone or unreachable; nothing to clear.
  }
}

function highlightStatus(res: HighlightResponse): string {
  if (!res.ok) return res.error;
  if (res.found === 0) return 'None of these elements are on the page anymore.';
  if (res.missing.length > 0) {
    return `Highlighted ${res.found}; ${res.missing.length} no longer on the page.`;
  }
  return `Highlighted ${res.found} on the page.`;
}

function download(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(href);
}

// Honour the OS "reduce motion" setting. Returns true when the user has asked
// for minimal animation; we then skip the count-up tween and the confetti.
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  );
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

// Tween an integer from 0 up to `target` over `durationMs` using ease-out-cubic.
// Jumps straight to the target when the user prefers reduced motion. Restarts
// whenever `target` changes (e.g. a fresh audit).
function useCountUp(target: number, reduced: boolean, durationMs = 700): number {
  const [value, setValue] = useState(reduced ? target : 0);
  useEffect(() => {
    if (reduced) {
      setValue(target);
      return;
    }
    let raf = 0;
    let start: number | null = null;
    const tick = (now: number) => {
      if (start === null) start = now;
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced, durationMs]);
  return value;
}

// Palette-tinted confetti burst for a perfect score. Purely decorative, so it's
// hidden from assistive tech. Pieces are positioned/animated entirely in CSS via
// per-piece custom properties.
const CONFETTI_COLORS = ['#1b607f', '#154c56', '#e9b872', '#c97b4a'];
const CONFETTI_PIECES = Array.from({ length: 18 }, (_, i) => i);

function Confetti() {
  return (
    <div className="confetti" aria-hidden="true">
      {CONFETTI_PIECES.map((i) => {
        const angle = (i / CONFETTI_PIECES.length) * Math.PI * 2;
        const spread = 60 + Math.random() * 40;
        const style = {
          '--tx': `${Math.cos(angle) * spread}px`,
          '--ty': `${Math.sin(angle) * spread - 30}px`,
          '--rot': `${Math.random() * 540 - 270}deg`,
          '--delay': `${Math.random() * 80}ms`,
          background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        } as CSSProperties;
        return <span key={i} className="confetti__piece" style={style} />;
      })}
    </div>
  );
}

// Notices and token warnings worth surfacing even when there's nothing to audit
// (e.g. a truncated page, or a token file that produced no usable tokens).
function Notices({ warnings, notices }: { warnings: string[]; notices: string[] }) {
  return (
    <>
      {notices.length > 0 && (
        <section className="notices">
          <h2>Notes</h2>
          <ul>
            {notices.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      )}
      {warnings.length > 0 && (
        <section className="warnings">
          <h2>Token Warnings</h2>
          <ul>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

export function Report({
  result,
  warnings,
  notices = [],
  url,
}: {
  result: AuditResult;
  warnings: string[];
  notices?: string[];
  url: string;
}) {
  // Nothing sampled means there's nothing to score — show an honest empty state
  // rather than a misleading 100% verdict (and certainly no confetti).
  if (result.totals.instances === 0) {
    return (
      <div className="report">
        <section className="verdict verdict--empty">
          <div className="verdict__meta">
            <div className="verdict__label">Nothing to audit</div>
            <div className="verdict__url" title={url}>
              {url}
            </div>
          </div>
          <p className="empty">
            No auditable styles were sampled on this page. Open a content page (not a
            <code>chrome://</code> or extension page), reload the tab, then run the audit
            again.
          </p>
        </section>
        <Notices warnings={warnings} notices={notices} />
      </div>
    );
  }

  // Which violation group is currently highlighted, plus the last status line.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // Transient "Copied" confirmation for the headline-copy button.
  const [copied, setCopied] = useState(false);

  // Violations list controls: how to order, and an optional category filter.
  const [sortBy, setSortBy] = useState<ViolationSort>('impact');
  const [filterCat, setFilterCat] = useState<'all' | TokenCategory>('all');

  const orphanCategories = useMemo(
    () => [...new Set(result.orphanGroups.map((g) => g.category))],
    [result],
  );
  const visibleGroups = useMemo(() => {
    const filtered =
      filterCat === 'all'
        ? result.orphanGroups
        : result.orphanGroups.filter((g) => g.category === filterCat);
    return sortGroups(filtered, sortBy);
  }, [result, sortBy, filterCat]);

  async function copyHeadline() {
    const text = toHeadline(result, url);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  // Verdict score: tween up to the rounded percentage on render, and fire a
  // confetti burst when the page is a perfect match. Both respect reduced motion.
  const reducedMotion = usePrefersReducedMotion();
  const targetScore = Math.round(result.coherence * 100);
  const displayScore = useCountUp(targetScore, reducedMotion);
  const [burstId, setBurstId] = useState(0);
  useEffect(() => {
    if (Math.round(result.coherence * 100) >= 100 && !reducedMotion) {
      setBurstId((id) => id + 1);
    }
  }, [result, reducedMotion]);
  const celebrate = targetScore >= 100 && burstId > 0 && !reducedMotion;

  async function showSelectors(key: string, selectors: string[], label: string) {
    setActiveKey(key);
    setStatus('Locating…');
    setStatus(highlightStatus(await sendHighlight(selectors, label)));
  }

  async function clearHighlight() {
    setActiveKey(null);
    setStatus(null);
    await sendClear();
  }

  return (
    <div className="report">
      <section className={`verdict verdict--${tone(result.coherence)}`}>
        {celebrate && <Confetti key={burstId} />}
        <div className="verdict__score" aria-label={formatPercent(result.coherence)}>
          <span aria-hidden="true">{displayScore}%</span>
        </div>
        <div className="verdict__meta">
          <div className="verdict__label">{verdictLabel(result.coherence)}</div>
          <div className="verdict__url" title={url}>
            {url}
          </div>
        </div>
      </section>

      <section className="exports">
        <h2>Download Report</h2>
        <div className="exports__buttons">
          <button
            onClick={() => download('token-audit.json', toJson(result, url), 'application/json')}
          >
            JSON
          </button>
          <button
            onClick={() => download('token-audit.md', toMarkdown(result, url), 'text/markdown')}
          >
            Markdown
          </button>
          <button className="exports__copy" onClick={copyHeadline} aria-live="polite">
            {copied ? 'Copied ✓' : 'Copy summary'}
          </button>
        </div>
      </section>

      <Notices warnings={warnings} notices={notices} />

      <section className="health">
        <h2>Drift Report</h2>
        <div className="health__totals">
          <Stat label="Instances" value={result.totals.instances} />
          <Stat label="Matched" value={result.totals.matched} />
          <Stat
            label="Near"
            value={result.totals.near}
            title="Near-matches count as half credit toward the coherence score."
          />
          <Stat label="Orphan" value={result.totals.orphan} />
        </div>
        <p className="health__note">
          Coherence counts each near-match as half credit; matches count in full and
          orphans not at all.
        </p>
        <table className="health__table">
          <caption className="sr-only">Per-category breakdown of matches, near-matches, and orphans</caption>
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col">Inst.</th>
              <th scope="col">Match</th>
              <th scope="col">Near</th>
              <th scope="col">Orphan</th>
            </tr>
          </thead>
          <tbody>
            {result.byCategory
              .filter((c) => c.instances > 0)
              .map((c: CategorySummary) => (
                <tr key={c.category}>
                  <th scope="row">{c.category}</th>
                  <td>{c.instances}</td>
                  <td>{c.matched}</td>
                  <td>{c.near}</td>
                  <td>{c.orphan}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </section>

      <section className="violations">
        <div className="violations__head">
          <h2>
            Violations <span className="count">{result.violations}</span>
          </h2>
          {activeKey && (
            <button type="button" className="violations__clear" onClick={clearHighlight}>
              Clear highlight
            </button>
          )}
        </div>
        {status && (
          <p className="violations__status" role="status" aria-live="polite">
            {status}
          </p>
        )}
        {result.orphanGroups.length > 1 && (
          <div className="violations__controls">
            <label className="violations__control">
              <span>Sort</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as ViolationSort)}
              >
                {(Object.keys(SORT_LABELS) as ViolationSort[]).map((s) => (
                  <option key={s} value={s}>
                    {SORT_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            {orphanCategories.length > 1 && (
              <label className="violations__control">
                <span>Category</span>
                <select
                  value={filterCat}
                  onChange={(e) => setFilterCat(e.target.value as 'all' | TokenCategory)}
                >
                  <option value="all">All ({result.orphanGroups.length})</option>
                  {orphanCategories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
        {result.orphanGroups.length === 0 ? (
          <p className="empty">No orphan values — every sampled value maps to a token.</p>
        ) : (
          <ul className="violations__list">
            {visibleGroups.map((g: ValueGroup) => {
              const key = `${g.category} ${g.value}`;
              const selectors = g.instances.map((i) => i.selector);
              const label = `${g.category} ${g.value}`;
              const shown = g.instances.slice(0, MAX_SELECTOR_CHIPS);
              const overflow = g.instances.length - shown.length;
              return (
                <li
                  key={key}
                  className={`violation${activeKey === key ? ' is-active' : ''}`}
                >
                  <div className="violation__head">
                    <span className="violation__value">{g.value}</span>
                    <button
                      type="button"
                      className="violation__locate"
                      onClick={() => showSelectors(key, selectors, label)}
                    >
                      Show on page ×{g.instanceCount}
                    </button>
                  </div>
                  <div className="violation__meta">
                    <span className="violation__cat">{g.category}</span>
                    {g.token && (
                      <span className="violation__suggest">
                        closest: {tokenLabel(g.token)}
                        {g.deltaLabel ? ` (${g.deltaLabel})` : ''}
                      </span>
                    )}
                  </div>
                  <ul className="violation__selectors">
                    {shown.map((inst, idx) => (
                      <li key={`${inst.selector}#${idx}`}>
                        <button
                          type="button"
                          className="selector-chip"
                          title={`${inst.property} — ${inst.selector}`}
                          onClick={() =>
                            showSelectors(`${key}@${idx}`, [inst.selector], label)
                          }
                        >
                          {inst.selector}
                        </button>
                      </li>
                    ))}
                    {overflow > 0 && (
                      <li className="violation__overflow">+{overflow} more</li>
                    )}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
        {result.orphanGroups.some(
          (g) => g.category === 'shadow' && isMultiLayerShadow(g.value),
        ) && (
          <p className="violations__note">
            Multi-layer shadows are listed as drift because v1 only matches
            single-layer shadows component-wise — a stacked shadow here isn't
            necessarily off-system.
          </p>
        )}
      </section>

      <section className="unused">
        <h2>
          Unused Tokens <span className="count">{result.unusedTokens.length}</span>
        </h2>
        {result.unusedTokens.length === 0 ? (
          <p className="empty">Every token is in use on this page.</p>
        ) : (
          <ul className="unused__list">
            {result.unusedTokens.map((t) => (
              <li key={tokenLabel(t)}>{tokenLabel(t)}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, title }: { label: string; value: number; title?: string }) {
  return (
    <div className="stat" title={title}>
      <div className="stat__value">{value}</div>
      <div className="stat__label">{label}</div>
    </div>
  );
}
