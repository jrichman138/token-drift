// Reads the design system straight out of the open file — no upload needed.
// v1 spike scope: COLOR variables (across all local collections, resolving
// alias chains to their primitive) plus local paint (color) styles. These map
// into the shared TokenSet's `color` category. Other categories (spacing from
// number variables, type from text styles, etc.) are deferred to the next pass.

import { emptyTokenSet, type TokenSet } from '../core/tokens/types';
import { rgbToHex } from './color';

// Key for mapping a matched Token back to its source Figma variable, so we can
// rebind a paint to it. Matches the dedupe key used in `add()` and is rebuilt
// from a Classification's token via `tokenKey(name, value)`.
export function tokenKey(name: string, value: string | number): string {
  return `${name} ${String(value)}`;
}

export interface CollectedTokens {
  tokens: TokenSet;
  warnings: string[];
  // Distinct color tokens gathered — surfaced in the UI so an empty design
  // system reads as "no tokens found" rather than a misleading 100%.
  colorTokenCount: number;
  // token (name+hex) -> the variable id backing it, for variable-sourced tokens
  // only (paint-style tokens can't be bound as variables). Drives rebinding.
  variableIdByToken: Map<string, string>;
}

// A variable's value for one mode is either a concrete value or an alias to
// another variable. We only special-case the color case here.
type ModeValue = VariableValue;

function isAlias(value: ModeValue): value is VariableAlias {
  return typeof value === 'object' && value !== null && (value as VariableAlias).type === 'VARIABLE_ALIAS';
}

// Resolve a color variable value to concrete RGB, following alias chains across
// collections (semantic → primitive) up to a sane depth.
async function resolveColor(value: ModeValue, depth = 0): Promise<RGB | RGBA | null> {
  if (depth > 8) return null;
  if (isAlias(value)) {
    const ref = await figma.variables.getVariableByIdAsync(value.id);
    if (!ref || ref.resolvedType !== 'COLOR') return null;
    return resolveVariableColor(ref, depth + 1);
  }
  // A concrete color value is an RGB/RGBA object.
  if (typeof value === 'object' && value !== null && 'r' in value) {
    return value as RGB | RGBA;
  }
  return null;
}

// Resolve a color Variable's default-mode value to concrete RGB (alias-aware).
async function resolveVariableColor(variable: Variable, depth = 0): Promise<RGB | RGBA | null> {
  const collection = await figma.variables.getVariableCollectionByIdAsync(
    variable.variableCollectionId,
  );
  const modeId = collection?.defaultModeId;
  if (!modeId) return null;
  return resolveColor(variable.valuesByMode[modeId], depth);
}

// Collect the file's color tokens from three sources, deduped:
//   1) variables bound on the canvas (passed in from extraction) — the only
//      reliable source when the design system comes from a published library,
//      since getLocalVariableCollections() then returns nothing;
//   2) local color variables;
//   3) local color (paint) styles.
export async function collectTokens(boundVariableIds: string[] = []): Promise<CollectedTokens> {
  const tokens = emptyTokenSet();
  const warnings: string[] = [];
  const seen = new Set<string>(); // dedupe by name+value
  const variableIdByToken = new Map<string, string>();

  // `variableId` is set when the token comes from a variable (rebindable);
  // paint-style tokens pass undefined, so they won't offer a bind action.
  const add = (name: string, hex: string, variableId?: string) => {
    const key = tokenKey(name, hex);
    if (variableId && !variableIdByToken.has(key)) variableIdByToken.set(key, variableId);
    if (seen.has(key)) return;
    seen.add(key);
    tokens.color.push({ category: 'color', name, value: hex });
  };

  // 1) Variables actually bound on the canvas (covers library-sourced systems).
  for (const id of boundVariableIds) {
    const variable = await figma.variables.getVariableByIdAsync(id);
    if (!variable || variable.resolvedType !== 'COLOR') continue;
    const resolved = await resolveVariableColor(variable);
    if (resolved) add(variable.name, rgbToHex(resolved), variable.id);
  }

  // 2) Local color variables across every collection (default mode).
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  for (const collection of collections) {
    for (const id of collection.variableIds) {
      const variable = await figma.variables.getVariableByIdAsync(id);
      if (!variable || variable.resolvedType !== 'COLOR') continue;
      const resolved = await resolveVariableColor(variable);
      if (resolved) add(variable.name, rgbToHex(resolved), variable.id);
    }
  }

  // 3) Local paint styles whose first paint is a solid color (not rebindable).
  const paintStyles = await figma.getLocalPaintStylesAsync();
  for (const style of paintStyles) {
    const solid = style.paints.find((p) => p.type === 'SOLID') as SolidPaint | undefined;
    if (solid) add(style.name, rgbToHex(solid.color));
  }

  if (tokens.color.length === 0) {
    warnings.push('No color variables or color styles found (locally or bound on the canvas).');
  }

  return {
    tokens,
    warnings,
    colorTokenCount: tokens.color.length,
    variableIdByToken,
  };
}
