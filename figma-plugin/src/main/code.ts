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

async function runAudit(): Promise<void> {
  const { roots, scope } = scopeAndRoots();

  // Color.
  const colorEx = extractObservations(roots);
  const { tokens, warnings, colorTokenCount, variableIdByToken } = await collectTokens(
    colorEx.boundVariableIds,
  );
  const color = auditColors(colorEx.observations, tokens, variableIdByToken);

  // Typography.
  const textEx = extractText(roots);
  const textTokens = await collectTextStyleTokens(textEx.referencedStyleIds);
  const typography = auditTypography(textEx.observations, textTokens);

  // Spacing & radius.
  const dimEx = extractDimensions(roots);
  const dimTokens = await collectDimensionTokens(dimEx.boundVariableIds);
  const { spacing, radius, stroke } = auditDimensions(dimEx.observations, dimTokens);

  // Elevation (effects).
  const effEx = extractEffects(roots);
  const effTokens = await collectEffectStyleTokens(effEx.referencedStyleIds);
  const elevation = auditEffects(effEx.observations, effTokens);

  post({
    type: 'audit-result',
    color,
    typography,
    spacing,
    radius,
    stroke,
    elevation,
    scope,
    nodeCount: colorEx.nodeCount,
    colorTokenCount,
    truncated: colorEx.truncated,
    warnings,
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

async function rebind(variableId: string, refs: NodeRef[]): Promise<void> {
  const variable = await figma.variables.getVariableByIdAsync(variableId);
  if (!variable) {
    post({ type: 'rebind-done', fixed: 0, failed: refs.length });
    return;
  }
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
  post({ type: 'rebind-done', fixed, failed });
}

// ---- type fix: apply a text style ------------------------------------------

async function applyStyle(styleId: string, nodeIds: string[]): Promise<void> {
  const style = await figma.getStyleByIdAsync(styleId);
  if (!style || style.type !== 'TEXT') {
    post({ type: 'apply-style-done', fixed: 0, failed: nodeIds.length });
    return;
  }
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
  post({ type: 'apply-style-done', fixed, failed });
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

async function bindDimension(variableId: string, refs: DimRef[]): Promise<void> {
  const variable = await figma.variables.getVariableByIdAsync(variableId);
  if (!variable) {
    post({ type: 'bind-dimension-done', fixed: 0, failed: refs.length });
    return;
  }
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
  post({ type: 'bind-dimension-done', fixed, failed });
}

// ---- elevation fix: apply an effect style ----------------------------------

async function applyEffectStyle(styleId: string, nodeIds: string[]): Promise<void> {
  const style = await figma.getStyleByIdAsync(styleId);
  if (!style || style.type !== 'EFFECT') {
    post({ type: 'apply-effect-style-done', fixed: 0, failed: nodeIds.length });
    return;
  }
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
  post({ type: 'apply-effect-style-done', fixed, failed });
}

figma.ui.onmessage = async (message: UIMessage): Promise<void> => {
  try {
    if (message.type === 'run-audit') await runAudit();
    else if (message.type === 'locate') await locate(message.nodeIds);
    else if (message.type === 'rebind') await rebind(message.variableId, message.refs);
    else if (message.type === 'apply-style') await applyStyle(message.styleId, message.nodeIds);
    else if (message.type === 'replace-font') await replaceFont(message.family, message.nodeIds);
    else if (message.type === 'bind-dimension') await bindDimension(message.variableId, message.refs);
    else if (message.type === 'apply-effect-style') await applyEffectStyle(message.styleId, message.nodeIds);
  } catch (error) {
    post({ type: 'audit-error', error: error instanceof Error ? error.message : String(error) });
  }
};
