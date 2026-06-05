// Elevation audit (binding-aware, mirrors typography). A node with effects is
// on-system if it uses an effect style OR binds its effects to variables;
// otherwise its effects are manual. We compare a manual effect stack to the
// file's effect styles by an exact signature (type, color+alpha, offset, blur,
// spread, blend mode of every visible effect):
//
//   detached — manual effects exactly match an effect style → applying the style
//              is a visual no-op; one-click "Use Elevation/md".
//   off      — no effect style matches → flagged, locate-only.
//
// Exact-match-or-off is deliberate: fuzzy per-component shadow matching (what the
// web extension does) is approximate for multi-layer shadows, so we don't claim
// "detached / zero-change" unless the whole stack is identical.

export type EffectDriftStatus = 'detached' | 'off';

export interface EffectObservation {
  nodeId: string;
  selector: string;
  usesStyle: boolean;
  usesVariable: boolean;
  sig: string;
  label: string;
}

export interface EffectExtractResult {
  observations: EffectObservation[];
  referencedStyleIds: string[];
  effectNodeCount: number;
}

export interface EffectStyleToken {
  styleId: string;
  name: string;
  sig: string;
}

export interface EffectDriftGroup {
  key: string;
  status: EffectDriftStatus;
  label: string;
  instanceCount: number;
  nodeIds: string[];
  sampleSelectors: string[];
  styleId?: string;
  styleName?: string;
}

export interface EffectStyleOption {
  styleId: string;
  name: string;
}

export interface EffectAuditResult {
  coherence: number; // on-token ÷ nodes-with-effects
  totals: { total: number; onToken: number; detached: number; off: number };
  styleTokenCount: number;
  styleTokens: EffectStyleOption[]; // every effect style, for the "apply a style" menu
  driftGroups: EffectDriftGroup[];
}

const MAX_NODES = 50_000;
const MAX_SAMPLE_SELECTORS = 6;

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
function hex(c: RGBA | RGB): string {
  const ch = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${ch(c.r)}${ch(c.g)}${ch(c.b)}`;
}

// Some effect types (Noise/Texture/Glass) have no radius — read it defensively.
function radiusOf(e: Effect): number | null {
  return 'radius' in e && typeof e.radius === 'number' ? e.radius : null;
}

// Exact, order-sensitive signature of a node's (or style's) visible effects.
function effectSig(effects: readonly Effect[]): string {
  return effects
    .filter((e) => e.visible !== false)
    .map((e) => {
      if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
        return `${e.type} ${hex(e.color)} a${round(e.color.a)} o(${round(e.offset.x)},${round(e.offset.y)}) r${round(e.radius)} s${round(e.spread ?? 0)} ${e.blendMode}`;
      }
      const r = radiusOf(e);
      return r === null ? e.type : `${e.type} r${round(r)}`;
    })
    .join(' + ');
}

function effectLabel(effects: readonly Effect[]): string {
  const visible = effects.filter((e) => e.visible !== false);
  const first = visible[0];
  if (!first) return 'effect';
  const extra = visible.length > 1 ? ` (+${visible.length - 1})` : '';
  if (first.type === 'DROP_SHADOW') return `Drop shadow · y${round(first.offset.y)} blur${round(first.radius)}${extra}`;
  if (first.type === 'INNER_SHADOW') return `Inner shadow · blur${round(first.radius)}${extra}`;
  if (first.type === 'LAYER_BLUR') return `Layer blur ${round(radiusOf(first) ?? 0)}${extra}`;
  if (first.type === 'BACKGROUND_BLUR') return `Background blur ${round(radiusOf(first) ?? 0)}${extra}`;
  return `${first.type}${extra}`;
}

// ---- extraction ------------------------------------------------------------

export function extractEffects(roots: readonly SceneNode[]): EffectExtractResult {
  const observations: EffectObservation[] = [];
  const referencedStyleIds = new Set<string>();
  let effectNodeCount = 0;
  let count = 0;

  const visit = (node: SceneNode): void => {
    if (count >= MAX_NODES) return;
    count += 1;
    if ('effects' in node && node.effects.some((e) => e.visible !== false)) {
      effectNodeCount += 1;
      const styleId = node.effectStyleId;
      const usesStyle = typeof styleId === 'string' && styleId !== '';
      if (usesStyle) referencedStyleIds.add(styleId);
      const usesVariable = node.effects.some(
        (e) => 'boundVariables' in e && e.boundVariables && Object.keys(e.boundVariables).length > 0,
      );
      observations.push({
        nodeId: node.id,
        selector: node.name || node.type,
        usesStyle,
        usesVariable,
        sig: effectSig(node.effects),
        label: effectLabel(node.effects),
      });
    }
    if ('children' in node) {
      for (const child of node.children) {
        if (count >= MAX_NODES) break;
        visit(child);
      }
    }
  };
  for (const root of roots) visit(root);

  return { observations, referencedStyleIds: [...referencedStyleIds], effectNodeCount };
}

// ---- token collection ------------------------------------------------------

export interface EffectTokenBundle {
  tokens: EffectStyleToken[];
  bySig: Map<string, EffectStyleToken>;
}

export async function collectEffectStyleTokens(referencedStyleIds: string[]): Promise<EffectTokenBundle> {
  const byId = new Map<string, EffectStyle>();
  for (const style of await figma.getLocalEffectStylesAsync()) byId.set(style.id, style);
  for (const id of referencedStyleIds) {
    if (byId.has(id)) continue;
    const style = await figma.getStyleByIdAsync(id);
    if (style && style.type === 'EFFECT') byId.set(style.id, style as EffectStyle);
  }

  const tokens: EffectStyleToken[] = [];
  const bySig = new Map<string, EffectStyleToken>();
  for (const style of byId.values()) {
    const sig = effectSig(style.effects);
    if (!sig) continue; // a style with no visible effects can't match a drift node
    const token: EffectStyleToken = { styleId: style.id, name: style.name, sig };
    tokens.push(token);
    if (!bySig.has(sig)) bySig.set(sig, token);
  }
  return { tokens, bySig };
}

// ---- audit -----------------------------------------------------------------

export function auditEffects(observations: EffectObservation[], bundle: EffectTokenBundle): EffectAuditResult {
  const groups = new Map<string, EffectDriftGroup>();
  const push = (key: string, status: EffectDriftStatus, label: string, obs: EffectObservation, styleId?: string, styleName?: string) => {
    let g = groups.get(key);
    if (!g) {
      g = { key, status, label, instanceCount: 0, nodeIds: [], sampleSelectors: [], styleId, styleName };
      groups.set(key, g);
    }
    g.instanceCount += 1;
    g.nodeIds.push(obs.nodeId);
    if (g.sampleSelectors.length < MAX_SAMPLE_SELECTORS && !g.sampleSelectors.includes(obs.selector)) {
      g.sampleSelectors.push(obs.selector);
    }
  };

  let onToken = 0;
  let detached = 0;
  let off = 0;
  for (const obs of observations) {
    if (obs.usesStyle || obs.usesVariable) {
      onToken += 1;
      continue;
    }
    const match = bundle.bySig.get(obs.sig);
    if (match) {
      detached += 1;
      push(`detached:${match.styleId}`, 'detached', obs.label, obs, match.styleId, match.name);
    } else {
      off += 1;
      push(`off:${obs.sig}`, 'off', obs.label, obs);
    }
  }

  const driftGroups = [...groups.values()].sort(
    (a, b) =>
      (a.status === b.status ? 0 : a.status === 'detached' ? -1 : 1) ||
      b.instanceCount - a.instanceCount ||
      a.label.localeCompare(b.label),
  );

  const total = observations.length;
  return {
    coherence: total === 0 ? 1 : onToken / total,
    totals: { total, onToken, detached, off },
    styleTokenCount: bundle.tokens.length,
    styleTokens: bundle.tokens
      .map((t) => ({ styleId: t.styleId, name: t.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    driftGroups,
  };
}
