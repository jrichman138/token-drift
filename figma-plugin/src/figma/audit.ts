// Binding-aware color audit. Unlike the web extension's value-only model, here a
// paint can be *bound* to a variable or not — and that distinction is the whole
// point. A fill whose color equals a token but isn't bound to it is "detached"
// drift: visually right, but not governed by the design system. We surface those
// (and near/orphan colors) with the exact node refs needed to fix them in place.
//
// We reuse the core color matcher (CIEDE2000 ΔE) to find the nearest token and
// how close it is; the binding state comes from extraction.

import { matchColor } from '../core/match/color';
import type { TokenSet } from '../core/tokens/types';
import type { ColorObservation, PaintProperty } from './extract';
import { tokenKey } from './tokens';

export type DriftStatus = 'detached' | 'near' | 'orphan';

// Everything the sandbox needs to act on a paint: select it and rebind it.
export interface NodeRef {
  nodeId: string;
  paintIndex: number;
  property: PaintProperty;
}

export interface DriftGroup {
  value: string; // hex
  status: DriftStatus;
  instanceCount: number;
  refs: NodeRef[]; // every unbound paint with this value
  sampleSelectors: string[]; // a few node names for display
  suggestionName?: string; // closest token name
  suggestionValue?: string; // closest token hex
  suggestionVariableId?: string; // present only if the token is a variable (bindable)
  deltaLabel?: string; // e.g. "ΔE 1.4"
}

// A color token the user can bind a paint to (variable-backed only — paint
// styles can't be bound). Powers the "pick a token" override on near/off rows.
export interface BindableToken {
  name: string;
  value: string; // hex
  variableId: string;
}

export interface ColorAuditResult {
  coherence: number; // bound / total
  totals: { total: number; bound: number; detached: number; near: number; orphan: number };
  driftGroups: DriftGroup[]; // unbound paints, grouped by value, sorted by fixability
  bindableTokens: BindableToken[]; // every variable-backed color token, for the picker
}

const MAX_SAMPLE_SELECTORS = 6;
const STATUS_RANK: Record<DriftStatus, number> = { detached: 0, near: 1, orphan: 2 };

export function auditColors(
  observations: ColorObservation[],
  tokens: TokenSet,
  variableIdByToken: Map<string, string>,
): ColorAuditResult {
  let bound = 0;
  const unboundByValue = new Map<string, ColorObservation[]>();
  for (const obs of observations) {
    if (obs.boundVariableId) {
      bound += 1;
      continue;
    }
    const list = unboundByValue.get(obs.value);
    if (list) list.push(obs);
    else unboundByValue.set(obs.value, [obs]);
  }

  let detached = 0;
  let near = 0;
  let orphan = 0;
  const driftGroups: DriftGroup[] = [];

  for (const [value, group] of unboundByValue) {
    const classification = matchColor(value, tokens.color);
    // matchColor: 'match' (ΔE ~0) → detached, 'near' (within tolerance) → near, else orphan.
    const status: DriftStatus =
      classification.kind === 'match' ? 'detached' : classification.kind === 'near' ? 'near' : 'orphan';

    const count = group.length;
    if (status === 'detached') detached += count;
    else if (status === 'near') near += count;
    else orphan += count;

    const token = classification.token;
    const suggestionVariableId = token
      ? variableIdByToken.get(tokenKey(token.name, token.value))
      : undefined;

    driftGroups.push({
      value,
      status,
      instanceCount: count,
      refs: group.map((o) => ({ nodeId: o.nodeId, paintIndex: o.paintIndex, property: o.property })),
      sampleSelectors: [...new Set(group.map((o) => o.selector))].slice(0, MAX_SAMPLE_SELECTORS),
      suggestionName: token?.name,
      suggestionValue: token ? String(token.value) : undefined,
      suggestionVariableId,
      deltaLabel: classification.deltaLabel,
    });
  }

  // Fixability order: detached (one-click, no visual change) first, then near,
  // then orphan; within a status, most instances first.
  driftGroups.sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      b.instanceCount - a.instanceCount ||
      a.value.localeCompare(b.value),
  );

  // Every variable-backed color token, for the "pick a token" override.
  const seenVar = new Set<string>();
  const bindableTokens: BindableToken[] = [];
  for (const t of tokens.color) {
    const variableId = variableIdByToken.get(tokenKey(t.name, t.value));
    if (variableId && !seenVar.has(variableId)) {
      seenVar.add(variableId);
      bindableTokens.push({ name: t.name, value: String(t.value), variableId });
    }
  }

  const total = observations.length;
  const coherence = total === 0 ? 1 : bound / total;
  return {
    coherence,
    totals: { total, bound, detached, near, orphan },
    driftGroups,
    bindableTokens,
  };
}
