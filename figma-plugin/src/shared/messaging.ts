// Typed postMessage protocol between the plugin sandbox (main/code.ts) and the
// UI iframe (ui/ui.tsx).

import type { ColorAuditResult, NodeRef } from '../figma/audit';

// UI -> sandbox.
export type UIMessage =
  | { type: 'run-audit' }
  | { type: 'locate'; refs: NodeRef[] } // select + zoom to these nodes on canvas
  | { type: 'rebind'; variableId: string; refs: NodeRef[] }; // bind these paints to a variable

// sandbox -> UI.
export type PluginMessage =
  | {
      type: 'audit-result';
      result: ColorAuditResult;
      scope: string; // "Selection (3 layers)" or "Page: Home"
      nodeCount: number;
      tokenCount: number;
      truncated: boolean;
      warnings: string[];
    }
  | { type: 'audit-error'; error: string }
  | { type: 'locate-done'; found: number }
  | { type: 'rebind-done'; fixed: number; failed: number };
