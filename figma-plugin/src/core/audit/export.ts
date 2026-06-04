import type { Token } from '../tokens/types';
import type { AuditResult, ValueGroup } from './aggregate';

// Plain-English verdict for a coherence score. Shared by the report UI and the
// text exports so the wording stays in one place. The `location` slot is the
// page/file name in the plugin (the extension passes the audited URL).
export function verdictLabel(coherence: number): string {
  if (coherence >= 0.95) return 'On system';
  if (coherence >= 0.8) return 'Mostly on system';
  if (coherence >= 0.6) return 'Drifting';
  return 'Drifting off system';
}

export function formatPercent(coherence: number): string {
  return `${Math.round(coherence * 100)}%`;
}

function tokenLabel(token: Token): string {
  return `${token.category}.${token.name}`;
}

function suggestion(group: ValueGroup): string {
  if (!group.token) return '';
  const delta = group.deltaLabel ? ` (${group.deltaLabel})` : '';
  return `${tokenLabel(group.token)}${delta}`;
}

// One-line summary suitable for pasting into a PR comment or Slack message.
export function toHeadline(result: AuditResult, location: string): string {
  const head = `Token Drift — ${formatPercent(result.coherence)} coherent (${verdictLabel(
    result.coherence,
  )}), ${result.violations} violation${result.violations === 1 ? '' : 's'} across ${
    result.uniqueOrphans
  } unique orphan value${result.uniqueOrphans === 1 ? '' : 's'}`;
  return location ? `${head} — ${location}` : head;
}

// Human-readable Markdown report.
export function toMarkdown(result: AuditResult, location: string): string {
  const lines: string[] = [];
  lines.push('# Token Drift');
  lines.push('');
  if (location) lines.push(`**Source:** ${location}`);
  lines.push(
    `**Coherence:** ${formatPercent(result.coherence)} (${verdictLabel(result.coherence)})`,
  );
  lines.push('');

  lines.push('## Totals');
  lines.push(`- Instances: ${result.totals.instances}`);
  lines.push(`- Matched: ${result.totals.matched}`);
  lines.push(`- Near: ${result.totals.near}`);
  lines.push(`- Orphan: ${result.totals.orphan}`);
  lines.push('');

  const active = result.byCategory.filter((c) => c.instances > 0);
  if (active.length > 0) {
    lines.push('## By category');
    lines.push('| Category | Instances | Matched | Near | Orphan |');
    lines.push('| --- | ---: | ---: | ---: | ---: |');
    for (const c of active) {
      lines.push(`| ${c.category} | ${c.instances} | ${c.matched} | ${c.near} | ${c.orphan} |`);
    }
    lines.push('');
  }

  lines.push(`## Violations (${result.violations})`);
  if (result.orphanGroups.length === 0) {
    lines.push('None — every sampled value maps to a token.');
  } else {
    for (const g of result.orphanGroups) {
      const closest = g.token ? ` — closest: ${suggestion(g)}` : '';
      const where = formatLocations(g);
      lines.push(`- \`${g.value}\` ×${g.instanceCount} (${g.category})${closest}${where}`);
    }
  }
  lines.push('');

  lines.push(`## Unused tokens (${result.unusedTokens.length})`);
  if (result.unusedTokens.length === 0) {
    lines.push('None — every token is in use.');
  } else {
    for (const t of result.unusedTokens) lines.push(`- ${tokenLabel(t)}`);
  }
  lines.push('');

  return lines.join('\n');
}

const MAX_LOCATIONS = 8;

function formatLocations(group: ValueGroup): string {
  const selectors = group.instances.map((i) => i.selector);
  if (selectors.length === 0) return '';
  const shown = selectors.slice(0, MAX_LOCATIONS);
  const extra = selectors.length - shown.length;
  const list = shown.map((s) => `\`${s}\``).join(', ');
  return ` — at ${list}${extra > 0 ? ` +${extra} more` : ''}`;
}

// Structured JSON export. Deterministic (no timestamp) so it is easy to diff.
export function toJson(result: AuditResult, location: string): string {
  const payload = {
    source: location,
    coherence: result.coherence,
    verdict: verdictLabel(result.coherence),
    totals: result.totals,
    violations: result.violations,
    uniqueOrphans: result.uniqueOrphans,
    byCategory: result.byCategory
      .filter((c) => c.instances > 0)
      .map((c) => ({
        category: c.category,
        instances: c.instances,
        matched: c.matched,
        near: c.near,
        orphan: c.orphan,
        uniqueValues: c.uniqueValues,
        uniqueOrphans: c.uniqueOrphans,
      })),
    orphans: result.orphanGroups.map((g) => ({
      category: g.category,
      value: g.value,
      instanceCount: g.instanceCount,
      suggestion: g.token ? tokenLabel(g.token) : null,
      delta: g.deltaLabel ?? null,
      locations: g.instances.map((i) => ({ property: i.property, selector: i.selector })),
    })),
    unusedTokens: result.unusedTokens.map((t) => ({
      category: t.category,
      name: t.name,
      value: t.value,
    })),
  };
  return JSON.stringify(payload, null, 2);
}
