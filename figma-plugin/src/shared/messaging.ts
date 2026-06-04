// Typed postMessage protocol between the plugin sandbox (main/code.ts) and the
// UI iframe (ui/ui.tsx).

import type { ColorAuditResult, NodeRef } from '../figma/audit';
import type { TypeAuditResult } from '../figma/text';

// UI -> sandbox.
export type UIMessage =
  | { type: 'run-audit' }
  | { type: 'locate'; nodeIds: string[] } // select + zoom to these nodes
  | { type: 'rebind'; variableId: string; refs: NodeRef[] } // color: bind paints to a variable
  | { type: 'apply-style'; styleId: string; nodeIds: string[] } // type: apply a text style
  | { type: 'replace-font'; family: string; nodeIds: string[] }; // type: swap only the font family

// sandbox -> UI.
export type PluginMessage =
  | {
      type: 'audit-result';
      color: ColorAuditResult;
      typography: TypeAuditResult;
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
  | { type: 'replace-font-done'; fixed: number; failed: number; fallbacks: number };
