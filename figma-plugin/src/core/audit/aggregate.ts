import { classify, type MatchKind, type MatchOptions } from '../match';
import type { Token, TokenCategory, TokenSet } from '../tokens/types';
import { TOKEN_CATEGORIES } from '../tokens/types';
import type { Observation } from './types';

// One place a value appears: which property, on which node.
export interface Instance {
  property: string;
  selector: string;
}

// A unique observed value and every place it appears.
export interface ValueGroup {
  category: TokenCategory;
  value: string;
  kind: MatchKind;
  instanceCount: number;
  instances: Instance[];
  token?: Token; // matched token, or closest suggestion for orphans
  distance?: number;
  deltaLabel?: string;
}

export interface CategorySummary {
  category: TokenCategory;
  instances: number;
  matched: number;
  near: number;
  orphan: number;
  uniqueValues: number;
  uniqueOrphans: number;
}

export interface AuditResult {
  // 0..1, instance-weighted with near-matches at half credit.
  coherence: number;
  totals: { instances: number; matched: number; near: number; orphan: number };
  // Orphan instance total — the actionable violation number.
  violations: number;
  // Distinct orphan values — the "how messy is this" signal.
  uniqueOrphans: number;
  // Every unique observed value, all kinds.
  groups: ValueGroup[];
  // Orphan groups only, sorted most-impactful first (the violations list).
  orphanGroups: ValueGroup[];
  // Tokens defined but never matched/near-matched.
  unusedTokens: Token[];
  byCategory: CategorySummary[];
}

const KEY_SEPARATOR = ' ';

export function aggregate(
  observations: Observation[],
  tokens: TokenSet,
  options: MatchOptions = {},
): AuditResult {
  const groups = new Map<string, ValueGroup>();

  for (const observation of observations) {
    const key = `${observation.category}${KEY_SEPARATOR}${observation.value}`;
    let group = groups.get(key);
    if (!group) {
      const result = classify(
        observation.category,
        observation.value,
        tokens[observation.category],
        options,
      );
      group = {
        category: observation.category,
        value: observation.value,
        kind: result.kind,
        instanceCount: 0,
        instances: [],
        token: result.token,
        distance: result.distance,
        deltaLabel: result.deltaLabel,
      };
      groups.set(key, group);
    }
    group.instances.push({ property: observation.property, selector: observation.selector });
    group.instanceCount += 1;
  }

  const allGroups = [...groups.values()];

  const totals = { instances: 0, matched: 0, near: 0, orphan: 0 };
  const usedTokens = new Set<string>();
  for (const group of allGroups) {
    totals.instances += group.instanceCount;
    if (group.kind === 'match') {
      totals.matched += group.instanceCount;
    } else if (group.kind === 'near') {
      totals.near += group.instanceCount;
    } else {
      totals.orphan += group.instanceCount;
    }
    if (group.token && (group.kind === 'match' || group.kind === 'near')) {
      usedTokens.add(tokenKey(group.token));
    }
  }

  const coherence =
    totals.instances === 0 ? 1 : (totals.matched + totals.near * 0.5) / totals.instances;

  const orphanGroups = allGroups.filter((g) => g.kind === 'orphan').sort(compareOrphans);

  return {
    coherence,
    totals,
    violations: totals.orphan,
    uniqueOrphans: orphanGroups.length,
    groups: allGroups,
    orphanGroups,
    unusedTokens: collectUnusedTokens(tokens, usedTokens),
    byCategory: summarizeByCategory(allGroups),
  };
}

function compareOrphans(a: ValueGroup, b: ValueGroup): number {
  if (b.instanceCount !== a.instanceCount) return b.instanceCount - a.instanceCount;
  const da = a.distance ?? Infinity;
  const db = b.distance ?? Infinity;
  if (da !== db) return da - db;
  return a.value.localeCompare(b.value);
}

function collectUnusedTokens(tokens: TokenSet, used: Set<string>): Token[] {
  const unused: Token[] = [];
  for (const category of TOKEN_CATEGORIES) {
    for (const token of tokens[category]) {
      if (!used.has(tokenKey(token))) unused.push(token);
    }
  }
  return unused;
}

function summarizeByCategory(groups: ValueGroup[]): CategorySummary[] {
  return TOKEN_CATEGORIES.map((category) => {
    const inCategory = groups.filter((g) => g.category === category);
    const summary: CategorySummary = {
      category,
      instances: 0,
      matched: 0,
      near: 0,
      orphan: 0,
      uniqueValues: inCategory.length,
      uniqueOrphans: inCategory.filter((g) => g.kind === 'orphan').length,
    };
    for (const group of inCategory) {
      summary.instances += group.instanceCount;
      if (group.kind === 'match') summary.matched += group.instanceCount;
      else if (group.kind === 'near') summary.near += group.instanceCount;
      else summary.orphan += group.instanceCount;
    }
    return summary;
  });
}

function tokenKey(token: Token): string {
  return `${token.category}${KEY_SEPARATOR}${token.name}`;
}
