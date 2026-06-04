// Plugin sandbox entry point. Runs in Figma's main thread (has the `figma` API,
// no DOM). Handles three messages from the UI:
//   run-audit — collect tokens, extract, binding-aware audit, post result
//   locate    — select + zoom to a set of paints' nodes on the canvas
//   rebind    — bind a set of paints to a variable (the in-place fix)

import { auditColors, type NodeRef } from '../figma/audit';
import { extractObservations } from '../figma/extract';
import { collectTokens } from '../figma/tokens';
import type { PaintProperty } from '../figma/extract';
import type { PluginMessage, UIMessage } from '../shared/messaging';

figma.skipInvisibleInstanceChildren = true;
figma.showUI(__html__, { width: 400, height: 660, themeColors: true });

function post(message: PluginMessage): void {
  figma.ui.postMessage(message);
}

async function runAudit(): Promise<void> {
  const selection = figma.currentPage.selection;
  const roots: readonly SceneNode[] =
    selection.length > 0 ? selection : figma.currentPage.children;
  const scope =
    selection.length > 0
      ? `Selection (${selection.length} layer${selection.length === 1 ? '' : 's'})`
      : `Page: ${figma.currentPage.name}`;

  const { observations, nodeCount, truncated, boundVariableIds } = extractObservations(roots);
  const { tokens, warnings, colorTokenCount, variableIdByToken } =
    await collectTokens(boundVariableIds);
  const result = auditColors(observations, tokens, variableIdByToken);

  post({
    type: 'audit-result',
    result,
    scope,
    nodeCount,
    tokenCount: colorTokenCount,
    truncated,
    warnings,
  });
}

// Resolve the unique nodes behind a set of refs (skipping any that vanished).
async function nodesFromRefs(refs: NodeRef[]): Promise<SceneNode[]> {
  const ids = [...new Set(refs.map((r) => r.nodeId))];
  const nodes: SceneNode[] = [];
  for (const id of ids) {
    const node = await figma.getNodeByIdAsync(id);
    if (node && 'type' in node && node.type !== 'PAGE' && node.type !== 'DOCUMENT') {
      nodes.push(node as SceneNode);
    }
  }
  return nodes;
}

async function locate(refs: NodeRef[]): Promise<void> {
  const nodes = await nodesFromRefs(refs);
  if (nodes.length > 0) {
    figma.currentPage.selection = nodes;
    figma.viewport.scrollAndZoomIntoView(nodes);
  }
  post({ type: 'locate-done', found: nodes.length });
}

// Replace the paint at `index` in a paints array with a variable-bound copy.
// Returns a NEW array (Figma paint arrays are read-only), or null if not applicable.
function bindPaintInArray(
  paints: readonly Paint[],
  index: number,
  variable: Variable,
): Paint[] | null {
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

  // Group refs by node so we mutate each node's fills/strokes array once.
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

figma.ui.onmessage = async (message: UIMessage): Promise<void> => {
  try {
    if (message.type === 'run-audit') await runAudit();
    else if (message.type === 'locate') await locate(message.refs);
    else if (message.type === 'rebind') await rebind(message.variableId, message.refs);
  } catch (error) {
    post({ type: 'audit-error', error: error instanceof Error ? error.message : String(error) });
  }
};
