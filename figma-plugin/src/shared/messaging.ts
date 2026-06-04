// Typed postMessage protocol between the plugin sandbox (main/code.ts) and the
// UI iframe (ui/ui.tsx).

import type { ColorAuditResult, NodeRef } from '../figma/audit';
import type { DimAuditResult, DimRef } from '../figma/dimension';
import type { EffectAuditResult } from '../figma/effect';
import type { TypeAuditResult } from '../figma/text';

// UI -> sandbox.
export type UIMessage =
  | { type: 'run-audit' }
  | { type: 'locate'; nodeIds: string[] } // select + zoom to these nodes
  | { type: 'rebind'; variableId: string; refs: NodeRef[] } // color: bind paints to a variable
  | { type: 'apply-style'; styleId: string; nodeIds: string[] } // type: apply a text style
  | { type: 'replace-font'; family: string; nodeIds: string[] } // type: swap only the font family
  | { type: 'bind-dimension'; variableId: string; refs: DimRef[] } // spacing/radius: bind to a variable
  | { type: 'apply-effect-style'; styleId: string; nodeIds: string[] }; // elevation: apply an effect style

// sandbox -> UI.
export type PluginMessage =
  | {
      type: 'audit-result';
      color: ColorAuditResult;
      typography: TypeAuditResult;
      spacing: DimAuditResult;
      radius: DimAuditResult;
      stroke: DimAuditResult;
      elevation: EffectAuditResult;
      scope: string; // "Selection (3 layers)" or "Page: Home"
      nodeCount: number;
      colorTokenCount: number;
      truncated: boolean;
      warnings: string[];
    }
  | { type: 'audit-error'; error: string }
  | { type: 'locate-done'; found: number }
  | { type: 'rebind-done'; fixed: number; failed: number }
  | { type: 'apply-style-done'; fixed: number; failed: number }
  // `fallbacks` = nodes where the original weight didn't exist in the new family
  // and we substituted the closest available one.
  | { type: 'replace-font-done'; fixed: number; failed: number; fallbacks: number }
  | { type: 'bind-dimension-done'; fixed: number; failed: number }
  | { type: 'apply-effect-style-done'; fixed: number; failed: number };
