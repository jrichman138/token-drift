// Walks canvas nodes and emits one ColorObservation per solid fill/stroke.
// Unlike the core's display-only Observation, each carries the exact node id +
// paint index + bound-variable state, so the report can locate the layer on the
// canvas and rebind the paint in place. v1 covers color (fills + strokes).

import { rgbToHex } from './color';

// Safety cap so a pathologically large file can't hang the plugin.
const MAX_NODES = 50_000;

export type PaintProperty = 'fill' | 'stroke';

export interface ColorObservation {
  property: PaintProperty;
  value: string; // hex
  selector: string; // node name, for display
  nodeId: string;
  paintIndex: number; // index within the node's fills/strokes array
  boundVariableId: string | null; // the variable this paint is bound to, if any
}

export interface ExtractResult {
  observations: ColorObservation[];
  // Variable IDs bound to any sampled paint — the reliable token source for
  // library-sourced design systems (see tokens.ts).
  boundVariableIds: string[];
  nodeCount: number;
  truncated: boolean;
}

export function extractObservations(roots: readonly SceneNode[]): ExtractResult {
  const observations: ColorObservation[] = [];
  const boundVariableIds = new Set<string>();
  let nodeCount = 0;
  let truncated = false;

  const visit = (node: SceneNode): void => {
    if (nodeCount >= MAX_NODES) {
      truncated = true;
      return;
    }
    nodeCount += 1;
    readNode(node, observations, boundVariableIds);
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

// The variable ID bound to a paint's color, if any.
function boundColorId(paint: Paint): string | null {
  const bound = (paint as { boundVariables?: { color?: VariableAlias } }).boundVariables?.color;
  return bound?.id ?? null;
}

function readPaints(
  paints: readonly Paint[],
  property: PaintProperty,
  nodeId: string,
  selector: string,
  out: ColorObservation[],
  boundIds: Set<string>,
): void {
  paints.forEach((paint, paintIndex) => {
    if (paint.type !== 'SOLID' || paint.visible === false) return;
    const boundVariableId = boundColorId(paint);
    if (boundVariableId) boundIds.add(boundVariableId);
    out.push({
      property,
      value: rgbToHex(paint.color),
      selector,
      nodeId,
      paintIndex,
      boundVariableId,
    });
  });
}

function readNode(node: SceneNode, out: ColorObservation[], boundIds: Set<string>): void {
  const selector = node.name || node.type;

  if ('fills' in node && node.fills !== figma.mixed) {
    readPaints(node.fills as readonly Paint[], 'fill', node.id, selector, out, boundIds);
  }
  if ('strokes' in node) {
    readPaints(node.strokes as readonly Paint[], 'stroke', node.id, selector, out, boundIds);
  }
}
