// Plugin sandbox entry point. Runs in Figma's main thread (has the `figma` API,
// no DOM). Handles:
//   run-audit    — collect tokens, extract, audit color + typography, post result
//   locate       — select + zoom to a set of nodes on the canvas
//   rebind       — bind a set of paints to a variable (the color fix)
//   apply-style  — apply a text style to a set of text nodes (the type fix)

import { auditColors, type NodeRef } from '../figma/audit';
import {
  auditDimensions,
  collectDimensionTokens,
  extractDimensions,
  type DimRef,
} from '../figma/dimension';
import { auditEffects, collectEffectStyleTokens, extractEffects } from '../figma/effect';
import { analyzeScales } from '../figma/scale';
import { extractObservations, type PaintProperty } from '../figma/extract';
import { collectTokens } from '../figma/tokens';
import { auditTypography, collectTextStyleTokens, extractText } from '../figma/text';
import type { PluginMessage, UIMessage } from '../shared/messaging';

figma.skipInvisibleInstanceChildren = true;
figma.showUI(__html__, { width: 420, height: 680, themeColors: true });

function post(message: PluginMessage): void {
  figma.ui.postMessage(message);
}

function scopeAndRoots(): { roots: readonly SceneNode[]; scope: string } {
  const selection = figma.currentPage.selection;
  if (selection.length > 0) {
    return {
      roots: selection,
      scope: `Selection (${selection.length} layer${selection.length === 1 ? '' : 's'})`,
    };
  }
  return { roots: figma.currentPage.children, scope: `Page: ${figma.currentPage.name}` };
}

// Run every audit over the given roots and return the results (no posting), so
// both runAudit and fixAllDetached can share it.
async function computeAudit(roots: readonly SceneNode[]) {
  const colorEx = extractObservations(roots);
  const { tokens, warnings, colorTokenCount, variableIdByToken } = await collectTokens(
    colorEx.boundVariableIds,
  );
  const color = auditColors(colorEx.observations, tokens, variableIdByToken);

  const textEx = extractText(roots);
  const textTokens = await collectTextStyleTokens(textEx.referencedStyleIds);
  const typography = auditTypography(textEx.observations, textTokens);

  const dimEx = extractDimensions(roots);
  const dimTokens = await collectDimensionTokens(dimEx.boundVariableIds);
  const { spacing, radius, stroke } = auditDimensions(dimEx.observations, dimTokens);
  const scale = analyzeScales(dimEx.observations); // token-free scale-consistency

  const effEx = extractEffects(roots);
  const effTokens = await collectEffectStyleTokens(effEx.referencedStyleIds);
  const elevation = auditEffects(effEx.observations, effTokens);

  return {
    color,
    typography,
    spacing,
    radius,
    stroke,
    elevation,
    scale,
    colorTokenCount,
    warnings,
    nodeCount: colorEx.nodeCount,
    truncated: colorEx.truncated,
  };
}

async function runAudit(): Promise<void> {
  const { roots, scope } = scopeAndRoots();
  const a = await computeAudit(roots);
  post({
    type: 'audit-result',
    color: a.color,
    typography: a.typography,
    spacing: a.spacing,
    radius: a.radius,
    stroke: a.stroke,
    elevation: a.elevation,
    scale: a.scale,
    scope,
    nodeCount: a.nodeCount,
    colorTokenCount: a.colorTokenCount,
    truncated: a.truncated,
    warnings: a.warnings,
  });
}

async function nodesFromIds(nodeIds: string[]): Promise<SceneNode[]> {
  const nodes: SceneNode[] = [];
  for (const id of [...new Set(nodeIds)]) {
    const node = await figma.getNodeByIdAsync(id);
    if (node && 'type' in node && node.type !== 'PAGE' && node.type !== 'DOCUMENT') {
      nodes.push(node as SceneNode);
    }
  }
  return nodes;
}

async function locate(nodeIds: string[]): Promise<void> {
  const nodes = await nodesFromIds(nodeIds);
  if (nodes.length > 0) {
    figma.currentPage.selection = nodes;
    figma.viewport.scrollAndZoomIntoView(nodes);
  }
  post({ type: 'locate-done', found: nodes.length });
}

// ---- color fix: bind paints to a variable ----------------------------------

function bindPaintInArray(paints: readonly Paint[], index: number, variable: Variable): Paint[] | null {
  const paint = paints[index];
  if (!paint || paint.type !== 'SOLID') return null;
  const next = paints.slice();
  next[index] = figma.variables.setBoundVariableForPaint(paint, 'color', variable);
  return next;
}

type FixCount = { fixed: number; failed: number };

async function rebindCore(variableId: string, refs: NodeRef[]): Promise<FixCount> {
  const variable = await figma.variables.getVariableByIdAsync(variableId);
  if (!variable) return { fixed: 0, failed: refs.length };
  const byNode = new Map<string, NodeRef[]>();
  for (const ref of refs) {
    const list = byNode.get(ref.nodeId);
    if (list) list.push(ref);
    else byNode.set(ref.nodeId, [ref]);
  }

  let fixed = 0;
  let failed = 0;
  for (const [nodeId, nodeRefs] of byNode) {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      failed += nodeRefs.length;
      continue;
    }
    for (const property of ['fill', 'stroke'] as PaintProperty[]) {
      const refsForProp = nodeRefs.filter((r) => r.property === property);
      if (refsForProp.length === 0) continue;
      const key = property === 'fill' ? 'fills' : 'strokes';
      const current = (node as unknown as Record<string, unknown>)[key];
      if (!Array.isArray(current)) {
        failed += refsForProp.length;
        continue;
      }
      let paints = current as Paint[];
      for (const ref of refsForProp) {
        const next = bindPaintInArray(paints, ref.paintIndex, variable);
        if (next) {
          paints = next;
          fixed += 1;
        } else {
          failed += 1;
        }
      }
      (node as unknown as Record<string, unknown>)[key] = paints;
    }
  }
  return { fixed, failed };
}

// ---- type fix: apply a text style ------------------------------------------

async function applyStyleCore(styleId: string, nodeIds: string[]): Promise<FixCount> {
  const style = await figma.getStyleByIdAsync(styleId);
  if (!style || style.type !== 'TEXT') return { fixed: 0, failed: nodeIds.length };
  // Load the style's font so the node can adopt it.
  await figma.loadFontAsync((style as TextStyle).fontName);

  let fixed = 0;
  let failed = 0;
  for (const id of [...new Set(nodeIds)]) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node || node.type !== 'TEXT') {
      failed += 1;
      continue;
    }
    try {
      // Load the node's current fonts before mutating it.
      for (const seg of node.getStyledTextSegments(['fontName'])) {
        await figma.loadFontAsync(seg.fontName);
      }
      await node.setTextStyleIdAsync(styleId);
      fixed += 1;
    } catch {
      failed += 1;
    }
  }
  return { fixed, failed };
}

// ---- type fix: swap only the font family -----------------------------------

async function replaceFont(family: string, nodeIds: string[]): Promise<void> {
  // Which weights/styles does the target family actually ship?
  const available = await figma.listAvailableFontsAsync();
  const stylesForFamily = new Set(
    available.filter((f) => f.fontName.family === family).map((f) => f.fontName.style),
  );
  if (stylesForFamily.size === 0) {
    post({ type: 'replace-font-done', fixed: 0, failed: nodeIds.length, fallbacks: 0 });
    return;
  }
  // Keep the same weight name if the new family has it; else fall back.
  const pickStyle = (desired: string): { style: string; fellBack: boolean } => {
    if (stylesForFamily.has(desired)) return { style: desired, fellBack: false };
    if (stylesForFamily.has('Regular')) return { style: 'Regular', fellBack: true };
    return { style: [...stylesForFamily][0], fellBack: true };
  };

  let fixed = 0;
  let failed = 0;
  let fallbacks = 0;
  for (const id of [...new Set(nodeIds)]) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node || node.type !== 'TEXT') {
      failed += 1;
      continue;
    }
    try {
      const segments = node.getStyledTextSegments(['fontName']);
      // Load the node's current fonts so we can mutate its ranges.
      for (const seg of segments) await figma.loadFontAsync(seg.fontName);
      let nodeFellBack = false;
      for (const seg of segments) {
        const { style, fellBack } = pickStyle(seg.fontName.style);
        const target: FontName = { family, style };
        await figma.loadFontAsync(target);
        node.setRangeFontName(seg.start, seg.end, target); // size/line-height/spacing untouched
        if (fellBack) nodeFellBack = true;
      }
      if (nodeFellBack) fallbacks += 1;
      fixed += 1;
    } catch {
      failed += 1;
    }
  }
  post({ type: 'replace-font-done', fixed, failed, fallbacks });
}

// ---- spacing/radius fix: bind a number property to a variable --------------

async function bindDimensionCore(variableId: string, refs: DimRef[]): Promise<FixCount> {
  const variable = await figma.variables.getVariableByIdAsync(variableId);
  if (!variable) return { fixed: 0, failed: refs.length };
  let fixed = 0;
  let failed = 0;
  for (const ref of refs) {
    const node = await figma.getNodeByIdAsync(ref.nodeId);
    if (!node || !('setBoundVariable' in node)) {
      failed += 1;
      continue;
    }
    try {
      (node as unknown as { setBoundVariable: (field: string, v: Variable) => void }).setBoundVariable(
        ref.field,
        variable,
      );
      fixed += 1;
    } catch {
      failed += 1;
    }
  }
  return { fixed, failed };
}

// ---- elevation fix: apply an effect style ----------------------------------

async function applyEffectStyleCore(styleId: string, nodeIds: string[]): Promise<FixCount> {
  const style = await figma.getStyleByIdAsync(styleId);
  if (!style || style.type !== 'EFFECT') return { fixed: 0, failed: nodeIds.length };
  let fixed = 0;
  let failed = 0;
  for (const id of [...new Set(nodeIds)]) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node || !('setEffectStyleIdAsync' in node)) {
      failed += 1;
      continue;
    }
    try {
      await (node as unknown as { setEffectStyleIdAsync: (id: string) => Promise<void> }).setEffectStyleIdAsync(styleId);
      fixed += 1;
    } catch {
      failed += 1;
    }
  }
  return { fixed, failed };
}

// ---- bulk: apply every zero-change "detached" fix across all categories ----

async function fixAllDetached(): Promise<void> {
  const { roots } = scopeAndRoots();
  const a = await computeAudit(roots);
  let fixed = 0;

  for (const g of a.color.driftGroups) {
    if (g.status === 'detached' && g.suggestionVariableId) {
      fixed += (await rebindCore(g.suggestionVariableId, g.refs)).fixed;
    }
  }
  for (const g of a.typography.driftGroups) {
    if (g.status === 'detached' && g.styleId) {
      fixed += (await applyStyleCore(g.styleId, g.nodeIds)).fixed;
    }
  }
  for (const dim of [a.spacing, a.radius, a.stroke]) {
    for (const g of dim.driftGroups) {
      if (g.status === 'detached' && g.suggestionVariableId) {
        fixed += (await bindDimensionCore(g.suggestionVariableId, g.refs)).fixed;
      }
    }
  }
  for (const g of a.elevation.driftGroups) {
    if (g.status === 'detached' && g.styleId) {
      fixed += (await applyEffectStyleCore(g.styleId, g.nodeIds)).fixed;
    }
  }

  post({ type: 'fix-all-done', fixed });
  await runAudit(); // refresh the report
}

// ---- scale fix: normalize a raw number to a canonical value ----------------

async function normalizeDimension(value: number, refs: DimRef[]): Promise<void> {
  let fixed = 0;
  let failed = 0;
  for (const ref of refs) {
    const node = await figma.getNodeByIdAsync(ref.nodeId);
    if (!node || !(ref.field in node)) {
      failed += 1;
      continue;
    }
    try {
      (node as unknown as Record<string, number>)[ref.field] = value;
      fixed += 1;
    } catch {
      failed += 1;
    }
  }
  post({ type: 'normalize-dimension-done', fixed, failed });
}

figma.ui.onmessage = async (message: UIMessage): Promise<void> => {
  try {
    if (message.type === 'run-audit') await runAudit();
    else if (message.type === 'locate') await locate(message.nodeIds);
    else if (message.type === 'rebind')
      post({ type: 'rebind-done', ...(await rebindCore(message.variableId, message.refs)) });
    else if (message.type === 'apply-style')
      post({ type: 'apply-style-done', ...(await applyStyleCore(message.styleId, message.nodeIds)) });
    else if (message.type === 'replace-font') await replaceFont(message.family, message.nodeIds);
    else if (message.type === 'bind-dimension')
      post({ type: 'bind-dimension-done', ...(await bindDimensionCore(message.variableId, message.refs)) });
    else if (message.type === 'apply-effect-style')
      post({ type: 'apply-effect-style-done', ...(await applyEffectStyleCore(message.styleId, message.nodeIds)) });
    else if (message.type === 'normalize-dimension') await normalizeDimension(message.value, message.refs);
    else if (message.type === 'fix-all-detached') await fixAllDetached();
  } catch (error) {
    post({ type: 'audit-error', error: error instanceof Error ? error.message : String(error) });
  }
};
