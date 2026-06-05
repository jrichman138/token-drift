// Typography audit (binding-aware, parallel to color). A text node is on-system
// if it uses a text style OR binds its type properties to variables. Otherwise
// it's manual type, and we compare it to the file's text styles:
//
//   detached — manual type whose FULL identity (family, style, size, line-height,
//              letter-spacing) exactly matches a style. Applying the style is a
//              genuine no-op visually; it just re-links the token. One-click fix.
//   close    — matches a style on family/style/size but differs on line-height or
//              letter-spacing. Applying snaps those — a small visual change.
//   off      — no style matches even on family/style/size (off-token size, or a
//              font not in the system). Flagged, locate-only.
//   mixed    — multiple fonts/sizes within one layer. Locate-only.
//
// When several styles share a signature (e.g. Inter Semi Bold 14 exists in two
// collections), we prefer the style whose collection prefix is most-used in the
// audited scope — so Braun content gets a Braun style, not a look-alike.

export type TypeDriftStatus = 'detached' | 'close' | 'off' | 'mixed';

// Text node fields that can be bound to variables — any of these means the node
// is intentionally tokenized via variables rather than a text style.
const TYPE_VARIABLE_KEYS = [
  'fontSize',
  'fontFamily',
  'fontStyle',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'paragraphSpacing',
  'paragraphIndent',
] as const;

export interface TextObservation {
  nodeId: string;
  selector: string;
  usesStyle: boolean; // a text style is applied
  usesTypeVariable: boolean; // a type property is bound to a variable
  styleId: string | null; // the applied style id (for collision tie-breaking)
  family: string | null;
  style: string | null;
  fontSize: number | null;
  lhKey: string; // serialized line-height ('mixed' if the node mixes it)
  lsKey: string; // serialized letter-spacing
  coreMixed: boolean; // family/size/style mixed within the node
}

export interface TextExtractResult {
  observations: TextObservation[];
  referencedStyleIds: string[];
  textNodeCount: number;
}

export interface TextStyleToken {
  styleId: string;
  name: string;
  family: string;
  style: string;
  fontSize: number;
  lhKey: string;
  lsKey: string;
}

export interface TypeDriftGroup {
  key: string;
  status: TypeDriftStatus;
  label: string;
  instanceCount: number;
  nodeIds: string[];
  sampleSelectors: string[];
  styleId?: string; // present for detached/close — the style to apply
  styleName?: string;
  offFont?: boolean; // off-system font (family not in any text style) — swappable
}

export interface TypeStyleOption {
  styleId: string;
  name: string;
  family: string;
  fontSize: number;
}

export interface TypeAuditResult {
  coherence: number; // on-token ÷ total text nodes
  totals: { total: number; onToken: number; detached: number; close: number; off: number; mixed: number };
  styleTokenCount: number;
  systemFamilies: string[]; // font families the design system uses (swap targets)
  styleTokens: TypeStyleOption[]; // every text style, for the "apply a style" menu
  driftGroups: TypeDriftGroup[];
}

const MAX_NODES = 50_000;
const MAX_SAMPLE_SELECTORS = 6;
const STATUS_RANK: Record<TypeDriftStatus, number> = { detached: 0, close: 1, off: 2, mixed: 3 };

// ---- serialization helpers (shared by nodes and styles) --------------------

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

type LineHeightValue = TextNode['lineHeight'];
type LetterSpacingValue = TextNode['letterSpacing'];

function lhKeyOf(lh: LineHeightValue): string {
  if (lh === figma.mixed) return 'mixed';
  if (lh.unit === 'AUTO') return 'auto';
  return `${round(lh.value)}${lh.unit === 'PERCENT' ? '%' : 'px'}`;
}

function lsKeyOf(ls: LetterSpacingValue): string {
  if (ls === figma.mixed) return 'mixed';
  return `${round(ls.value)}${ls.unit === 'PERCENT' ? '%' : 'px'}`;
}

function coreSig(family: string, style: string, size: number): string {
  return `${family}|${style}|${size}`;
}
function fullSig(family: string, style: string, size: number, lhKey: string, lsKey: string): string {
  return `${coreSig(family, style, size)}|${lhKey}|${lsKey}`;
}
function prefixOf(name: string): string {
  const i = name.indexOf('/');
  return i >= 0 ? name.slice(0, i) : name;
}

// ---- extraction ------------------------------------------------------------

export function extractText(roots: readonly SceneNode[]): TextExtractResult {
  const observations: TextObservation[] = [];
  const referencedStyleIds = new Set<string>();
  let textNodeCount = 0;
  let count = 0;

  const visit = (node: SceneNode): void => {
    if (count >= MAX_NODES) return;
    count += 1;
    if (node.type === 'TEXT') {
      textNodeCount += 1;
      observations.push(readText(node, referencedStyleIds));
    }
    if ('children' in node) {
      for (const child of node.children) {
        if (count >= MAX_NODES) break;
        visit(child);
      }
    }
  };
  for (const root of roots) visit(root);

  return { observations, referencedStyleIds: [...referencedStyleIds], textNodeCount };
}

function readText(node: TextNode, referenced: Set<string>): TextObservation {
  const selector = node.name || 'Text';
  const styleId = node.textStyleId;
  const usesStyle = styleId !== figma.mixed && !!styleId;
  if (usesStyle) referenced.add(styleId as string);

  const bound = node.boundVariables ?? {};
  const usesTypeVariable = TYPE_VARIABLE_KEYS.some((k) => k in bound);

  const fontMixed = node.fontName === figma.mixed;
  const sizeMixed = node.fontSize === figma.mixed;
  const coreMixed = fontMixed || sizeMixed || styleId === figma.mixed;

  const fontName = fontMixed ? null : (node.fontName as FontName);
  return {
    nodeId: node.id,
    selector,
    usesStyle,
    usesTypeVariable,
    styleId: usesStyle ? (styleId as string) : null,
    family: fontName ? fontName.family : null,
    style: fontName ? fontName.style : null,
    fontSize: sizeMixed ? null : (node.fontSize as number),
    lhKey: lhKeyOf(node.lineHeight),
    lsKey: lsKeyOf(node.letterSpacing),
    coreMixed,
  };
}

// ---- token collection ------------------------------------------------------

export interface TextTokenBundle {
  tokens: TextStyleToken[];
  nameById: Map<string, string>;
  byFull: Map<string, TextStyleToken[]>; // full identity -> candidates
  byCore: Map<string, TextStyleToken[]>; // family/style/size -> candidates
  allowedFamilies: Set<string>;
}

export async function collectTextStyleTokens(referencedStyleIds: string[]): Promise<TextTokenBundle> {
  const byId = new Map<string, TextStyle>();
  for (const style of await figma.getLocalTextStylesAsync()) byId.set(style.id, style);
  for (const id of referencedStyleIds) {
    if (byId.has(id)) continue;
    const style = await figma.getStyleByIdAsync(id);
    if (style && style.type === 'TEXT') byId.set(style.id, style as TextStyle);
  }

  const tokens: TextStyleToken[] = [];
  const nameById = new Map<string, string>();
  const byFull = new Map<string, TextStyleToken[]>();
  const byCore = new Map<string, TextStyleToken[]>();
  const allowedFamilies = new Set<string>();

  const index = (map: Map<string, TextStyleToken[]>, key: string, token: TextStyleToken) => {
    const list = map.get(key);
    if (list) list.push(token);
    else map.set(key, [token]);
  };

  for (const style of byId.values()) {
    const fn = style.fontName;
    const token: TextStyleToken = {
      styleId: style.id,
      name: style.name,
      family: fn.family,
      style: fn.style,
      fontSize: style.fontSize,
      lhKey: lhKeyOf(style.lineHeight),
      lsKey: lsKeyOf(style.letterSpacing),
    };
    tokens.push(token);
    nameById.set(style.id, style.name);
    allowedFamilies.add(fn.family);
    index(byFull, fullSig(token.family, token.style, token.fontSize, token.lhKey, token.lsKey), token);
    index(byCore, coreSig(token.family, token.style, token.fontSize), token);
  }
  return { tokens, nameById, byFull, byCore, allowedFamilies };
}

// ---- audit -----------------------------------------------------------------

export function auditTypography(observations: TextObservation[], bundle: TextTokenBundle): TypeAuditResult {
  // Prefix popularity: how often each style-collection prefix (e.g. "Braun") is
  // actually used on on-style nodes in scope. Drives collision tie-breaking.
  const prefixUse = new Map<string, number>();
  for (const obs of observations) {
    if (!obs.usesStyle || !obs.styleId) continue;
    const name = bundle.nameById.get(obs.styleId);
    if (!name) continue;
    const p = prefixOf(name);
    prefixUse.set(p, (prefixUse.get(p) ?? 0) + 1);
  }
  const pickCandidate = (cands: TextStyleToken[]): TextStyleToken =>
    cands.reduce((best, c) =>
      (prefixUse.get(prefixOf(c.name)) ?? 0) > (prefixUse.get(prefixOf(best.name)) ?? 0) ? c : best,
    );

  const groups = new Map<string, TypeDriftGroup>();
  const push = (
    key: string,
    status: TypeDriftStatus,
    label: string,
    obs: TextObservation,
    styleId?: string,
    styleName?: string,
  ) => {
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
  let close = 0;
  let off = 0;
  let mixed = 0;

  for (const obs of observations) {
    if (obs.usesStyle || obs.usesTypeVariable) {
      onToken += 1;
      continue;
    }
    if (obs.coreMixed || obs.family === null || obs.style === null || obs.fontSize === null) {
      mixed += 1;
      push('mixed', 'mixed', 'Mixed fonts', obs);
      continue;
    }
    const full = bundle.byFull.get(fullSig(obs.family, obs.style, obs.fontSize, obs.lhKey, obs.lsKey));
    if (full) {
      const t = pickCandidate(full);
      detached += 1;
      push(`detached:${t.styleId}`, 'detached', `${obs.family} ${obs.style} · ${obs.fontSize}`, obs, t.styleId, t.name);
      continue;
    }
    const core = bundle.byCore.get(coreSig(obs.family, obs.style, obs.fontSize));
    if (core) {
      const t = pickCandidate(core);
      close += 1;
      push(`close:${t.styleId}`, 'close', `${obs.family} ${obs.style} · ${obs.fontSize}`, obs, t.styleId, t.name);
      continue;
    }
    off += 1;
    const offFont = !bundle.allowedFamilies.has(obs.family);
    const label = `${obs.family} ${obs.style} · ${obs.fontSize}${offFont ? '  (off-system font)' : ''}`;
    const offKey = `off:${coreSig(obs.family, obs.style, obs.fontSize)}`;
    push(offKey, 'off', label, obs);
    if (offFont) {
      const g = groups.get(offKey);
      if (g) g.offFont = true;
    }
  }

  const driftGroups = [...groups.values()].sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      b.instanceCount - a.instanceCount ||
      a.label.localeCompare(b.label),
  );

  const total = observations.length;
  const coherence = total === 0 ? 1 : onToken / total;
  return {
    coherence,
    totals: { total, onToken, detached, close, off, mixed },
    styleTokenCount: bundle.tokens.length,
    systemFamilies: [...bundle.allowedFamilies].sort(),
    styleTokens: bundle.tokens
      .map((t) => ({ styleId: t.styleId, name: t.name, family: t.family, fontSize: t.fontSize }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    driftGroups,
  };
}
