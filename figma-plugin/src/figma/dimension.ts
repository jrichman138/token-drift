// Binding-aware spacing & radius audit (parallel to color). Auto-layout gap/
// padding and corner radii can each be bound to a FLOAT (number) variable. A
// property bound to a variable is on-system; a raw number is drift. As with
// color, a raw value that exactly equals a token but isn't bound is "detached"
// (bind it, no visual change); a value with no matching token is "off-system".
//
// Token source: FLOAT variables — those bound on the canvas (reliable for
// library systems) plus local FLOAT variables, classified into spacing vs radius
// by their variable scopes.

export type DimCategory = 'spacing' | 'radius' | 'stroke';
export type DimStatus = 'detached' | 'off';

// Fields we read per category (only present/relevant on the right node types).
const SPACING_FIELDS = [
  'itemSpacing',
  'counterAxisSpacing',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'paddingBottom',
] as const;
const RADIUS_FIELDS = ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius'] as const;
const STROKE_FIELDS = ['strokeWeight'] as const;

export interface DimRef {
  nodeId: string;
  field: string;
}

export interface DimObservation {
  category: DimCategory;
  field: string;
  value: number;
  nodeId: string;
  selector: string;
  boundVariableId: string | null;
}

export interface DimExtractResult {
  observations: DimObservation[];
  boundVariableIds: string[];
  nodeCount: number;
  truncated: boolean;
}

export interface DimToken {
  name: string;
  value: number;
  variableId: string;
}

export interface DimDriftGroup {
  key: string;
  status: DimStatus;
  value: number;
  instanceCount: number;
  refs: DimRef[];
  sampleSelectors: string[];
  suggestionName?: string;
  suggestionValue?: number;
  suggestionVariableId?: string;
  deltaLabel?: string;
}

export interface DimAuditResult {
  category: DimCategory;
  coherence: number;
  totals: { total: number; bound: number; detached: number; off: number };
  tokenCount: number;
  driftGroups: DimDriftGroup[];
}

const MAX_NODES = 50_000;
const MAX_SAMPLE_SELECTORS = 6;
const EXACT_EPSILON = 0.01;

// ---- extraction ------------------------------------------------------------

// Binding uniform `strokeWeight` actually stores the alias under the four
// per-side keys, so detect a bound stroke by checking any of them.
const STROKE_WEIGHT_KEYS = [
  'strokeWeight',
  'strokeTopWeight',
  'strokeRightWeight',
  'strokeBottomWeight',
  'strokeLeftWeight',
];

function boundId(node: SceneNode, field: string): string | null {
  const bound = (node as { boundVariables?: Record<string, VariableAlias | undefined> }).boundVariables;
  if (!bound) return null;
  if (field === 'strokeWeight') {
    for (const k of STROKE_WEIGHT_KEYS) {
      const id = bound[k]?.id;
      if (id) return id;
    }
    return null;
  }
  return bound[field]?.id ?? null;
}

export function extractDimensions(roots: readonly SceneNode[]): DimExtractResult {
  const observations: DimObservation[] = [];
  const boundVariableIds = new Set<string>();
  let nodeCount = 0;
  let truncated = false;

  const read = (node: SceneNode, fields: readonly string[], category: DimCategory) => {
    const selector = node.name || node.type;
    for (const field of fields) {
      if (!(field in node)) continue;
      const value = (node as unknown as Record<string, unknown>)[field];
      if (typeof value !== 'number' || value === 0) continue; // 0 gap/padding/radius isn't a token
      const variableId = boundId(node, field);
      if (variableId) boundVariableIds.add(variableId);
      observations.push({ category, field, value, nodeId: node.id, selector, boundVariableId: variableId });
    }
  };

  const visit = (node: SceneNode): void => {
    if (nodeCount >= MAX_NODES) {
      truncated = true;
      return;
    }
    nodeCount += 1;
    if ('layoutMode' in node && node.layoutMode !== 'NONE') read(node, SPACING_FIELDS, 'spacing');
    if ('topLeftRadius' in node) read(node, RADIUS_FIELDS, 'radius');
    // Stroke weight only matters where there's a visible stroke.
    if (
      'strokes' in node &&
      Array.isArray(node.strokes) &&
      node.strokes.some((p) => p.visible !== false)
    ) {
      read(node, STROKE_FIELDS, 'stroke');
    }
    if ('children' in node) {
      for (const child of node.children) {
        if (nodeCount >= MAX_NODES) {
          truncated = true;
          break;
        }
        visit(child);
      }
    }
  };
  for (const root of roots) visit(root);

  return { observations, boundVariableIds: [...boundVariableIds], nodeCount, truncated };
}

// ---- token collection ------------------------------------------------------

function isAlias(value: VariableValue): value is VariableAlias {
  return typeof value === 'object' && value !== null && (value as VariableAlias).type === 'VARIABLE_ALIAS';
}

async function resolveFloat(value: VariableValue, depth = 0): Promise<number | null> {
  if (depth > 8) return null;
  if (isAlias(value)) {
    const ref = await figma.variables.getVariableByIdAsync(value.id);
    if (!ref || ref.resolvedType !== 'FLOAT') return null;
    const col = await figma.variables.getVariableCollectionByIdAsync(ref.variableCollectionId);
    const modeId = col?.defaultModeId;
    if (!modeId) return null;
    return resolveFloat(ref.valuesByMode[modeId], depth + 1);
  }
  return typeof value === 'number' ? value : null;
}

async function resolveVariableFloat(variable: Variable): Promise<number | null> {
  const col = await figma.variables.getVariableCollectionByIdAsync(variable.variableCollectionId);
  const modeId = col?.defaultModeId;
  if (!modeId) return null;
  return resolveFloat(variable.valuesByMode[modeId]);
}

export interface DimTokens {
  spacing: DimToken[];
  radius: DimToken[];
  stroke: DimToken[];
}

// Classify a FLOAT variable into spacing/radius/stroke by its scopes. ALL_SCOPES
// counts for all (we can't tell), so it's available to every matcher.
function categoriesForScopes(
  scopes: readonly VariableScope[],
): { spacing: boolean; radius: boolean; stroke: boolean } {
  const all = scopes.includes('ALL_SCOPES');
  return {
    spacing: all || scopes.includes('GAP') || scopes.includes('WIDTH_HEIGHT'),
    radius: all || scopes.includes('CORNER_RADIUS'),
    stroke: all || scopes.includes('STROKE_FLOAT'),
  };
}

export async function collectDimensionTokens(boundVariableIds: string[]): Promise<DimTokens> {
  const ids = new Set(boundVariableIds);
  for (const c of await figma.variables.getLocalVariableCollectionsAsync()) {
    for (const id of c.variableIds) ids.add(id);
  }

  const spacing: DimToken[] = [];
  const radius: DimToken[] = [];
  const stroke: DimToken[] = [];
  const seenSpacing = new Set<string>();
  const seenRadius = new Set<string>();
  const seenStroke = new Set<string>();

  for (const id of ids) {
    const variable = await figma.variables.getVariableByIdAsync(id);
    if (!variable || variable.resolvedType !== 'FLOAT') continue;
    const value = await resolveVariableFloat(variable);
    if (value === null) continue;
    const cats = categoriesForScopes(variable.scopes);
    const token: DimToken = { name: variable.name, value, variableId: variable.id };
    if (cats.spacing && !seenSpacing.has(id)) {
      seenSpacing.add(id);
      spacing.push(token);
    }
    if (cats.radius && !seenRadius.has(id)) {
      seenRadius.add(id);
      radius.push(token);
    }
    if (cats.stroke && !seenStroke.has(id)) {
      seenStroke.add(id);
      stroke.push(token);
    }
  }
  return { spacing, radius, stroke };
}

// ---- audit -----------------------------------------------------------------

function nearestToken(value: number, tokens: DimToken[]): { token: DimToken; diff: number } | null {
  let best: DimToken | undefined;
  let bestDiff = Infinity;
  for (const t of tokens) {
    const diff = Math.abs(value - t.value);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = t;
    }
  }
  return best ? { token: best, diff: bestDiff } : null;
}

function auditOne(category: DimCategory, observations: DimObservation[], tokens: DimToken[]): DimAuditResult {
  let bound = 0;
  const unboundByValue = new Map<number, DimObservation[]>();
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
  let off = 0;
  const driftGroups: DimDriftGroup[] = [];
  for (const [value, group] of unboundByValue) {
    const near = nearestToken(value, tokens);
    const exact = near !== null && near.diff <= EXACT_EPSILON;
    const status: DimStatus = exact ? 'detached' : 'off';
    if (status === 'detached') detached += group.length;
    else off += group.length;

    const delta = near ? Math.round((value - near.token.value) * 100) / 100 : undefined;
    driftGroups.push({
      key: `${category}:${status}:${value}`,
      status,
      value,
      instanceCount: group.length,
      refs: group.map((o) => ({ nodeId: o.nodeId, field: o.field })),
      sampleSelectors: [...new Set(group.map((o) => o.selector))].slice(0, MAX_SAMPLE_SELECTORS),
      suggestionName: near?.token.name,
      suggestionValue: near?.token.value,
      suggestionVariableId: exact ? near?.token.variableId : undefined,
      deltaLabel: !exact && delta !== undefined ? `${delta >= 0 ? '+' : ''}${delta}px` : undefined,
    });
  }

  driftGroups.sort(
    (a, b) =>
      (a.status === b.status ? 0 : a.status === 'detached' ? -1 : 1) ||
      b.instanceCount - a.instanceCount ||
      a.value - b.value,
  );

  const total = observations.length;
  return {
    category,
    coherence: total === 0 ? 1 : bound / total,
    totals: { total, bound, detached, off },
    tokenCount: tokens.length,
    driftGroups,
  };
}

export function auditDimensions(
  observations: DimObservation[],
  tokens: DimTokens,
): { spacing: DimAuditResult; radius: DimAuditResult; stroke: DimAuditResult } {
  return {
    spacing: auditOne('spacing', observations.filter((o) => o.category === 'spacing'), tokens.spacing),
    radius: auditOne('radius', observations.filter((o) => o.category === 'radius'), tokens.radius),
    stroke: auditOne('stroke', observations.filter((o) => o.category === 'stroke'), tokens.stroke),
  };
}
