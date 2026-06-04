// Scale-consistency analysis — outlier detection WITHOUT tokens. The token audit
// (dimension.ts) needs variables to compare against; this needs nothing. It infers
// the de-facto numeric scale from the canvas itself and flags values that look like
// accidental deviations: a stray `9` where everything else is `8`, a `26` among
// `24`s. The fix isn't "bind to a token" — there is none — it's "normalize to N",
// a real value change that tightens an untokenized scale.
//
// Operates only on UNBOUND values (bound ones are governed by a variable already).
//
// A value V is an outlier when ALL hold:
//   - rare in absolute share: count(V) ≤ MAX_SHARE of the category's values, AND
//   - a near neighbor U dominates: |U−V| ≤ TOL and count(U) ≥ DOMINANCE·count(V).
// The share guard is what stops a deliberate second value (e.g. a 1.5px stroke used
// 18% of the time) from being mistaken for a one-off near a very popular neighbor.

import type { DimCategory, DimObservation, DimRef } from './dimension';

const TOL = 2; // px proximity to call two values "the same step"
const DOMINANCE = 4; // neighbor must be this many× more common
const MAX_SHARE = 0.12; // outlier must be ≤ this fraction of the category's values
const MAX_SCALE_VALUES = 16; // cap the displayed scale list

export interface ScaleValue {
  value: number;
  count: number;
}

export interface ScaleOutlier {
  value: number;
  count: number;
  refs: DimRef[];
  suggest: number;
  suggestCount: number;
}

export interface ScaleResult {
  category: DimCategory;
  total: number;
  distinctCount: number;
  scale: ScaleValue[]; // de-facto scale, most-used first (capped)
  outliers: ScaleOutlier[];
}

export interface ScaleResults {
  spacing: ScaleResult;
  radius: ScaleResult;
  stroke: ScaleResult;
}

function analyzeOne(category: DimCategory, observations: DimObservation[]): ScaleResult {
  const byValue = new Map<number, { count: number; refs: DimRef[] }>();
  for (const obs of observations) {
    const entry = byValue.get(obs.value);
    const ref: DimRef = { nodeId: obs.nodeId, field: obs.field };
    if (entry) {
      entry.count += 1;
      entry.refs.push(ref);
    } else {
      byValue.set(obs.value, { count: 1, refs: [ref] });
    }
  }

  const values = [...byValue.keys()];
  const total = observations.length;
  const scale: ScaleValue[] = values
    .map((value) => ({ value, count: byValue.get(value)!.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_SCALE_VALUES);

  const outliers: ScaleOutlier[] = [];
  for (const value of values) {
    const { count, refs } = byValue.get(value)!;
    if (count > total * MAX_SHARE) continue; // too common to be an accident
    let best: { value: number; count: number } | null = null;
    for (const other of values) {
      if (other === value || Math.abs(other - value) > TOL) continue;
      const otherCount = byValue.get(other)!.count;
      if (otherCount >= DOMINANCE * count && (!best || otherCount > best.count)) {
        best = { value: other, count: otherCount };
      }
    }
    if (best) {
      outliers.push({ value, count, refs, suggest: best.value, suggestCount: best.count });
    }
  }
  outliers.sort((a, b) => b.count - a.count || a.value - b.value);

  return { category, total, distinctCount: values.length, scale, outliers };
}

export function analyzeScales(observations: DimObservation[]): ScaleResults {
  // Only unbound values — bound ones are already governed by a variable.
  const unbound = observations.filter((o) => o.boundVariableId === null);
  return {
    spacing: analyzeOne('spacing', unbound.filter((o) => o.category === 'spacing')),
    radius: analyzeOne('radius', unbound.filter((o) => o.category === 'radius')),
    stroke: analyzeOne('stroke', unbound.filter((o) => o.category === 'stroke')),
  };
}
