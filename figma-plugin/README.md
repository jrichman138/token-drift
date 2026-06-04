# Token Drift — Figma plugin

A Figma plugin that audits the layers in the open file against **the file's own
design system** — its Variables and color Styles — and reports how much of the
canvas is on-system vs. drifting. No token upload: the design system is already
in the file.

This is a **standalone spike** living alongside the Token Drift Chrome extension
(repo root). It deliberately keeps its **own copy** of the pure matching/
aggregation/export core under `src/core/` (copied verbatim from the extension's
`lib/`) so the two products stay isolated. When the extension's core changes,
re-copy the relevant `src/core/` files by hand.

## Scope (v1 spike)

- **Tokens:** color Variables (alias chains resolved to primitives) + local
  color Styles.
- **Audit:** every solid fill/stroke color on the selection (or the whole page
  if nothing is selected), classified match / near / orphan via CIEDE2000 ΔE.
- **Output:** coherence score, totals, off-system color list with the closest
  token, and copy-to-clipboard summary / JSON / Markdown.

Deferred (next passes): spacing from number variables, type from text styles,
radius, effects/shadows, bound-vs-raw detection, and one-click "bind to
variable" remediation.

## Architecture

```
src/
  core/        # COPIED pure logic (matchers, aggregate, export, types) — no Figma/DOM deps
  figma/       # Figma-specific: file Variables/Styles -> TokenSet, nodes -> Observations
  main/code.ts # plugin sandbox: collect tokens, extract, aggregate, post to UI
  ui/ui.tsx    # React report iframe
  shared/      # typed postMessage protocol between sandbox and UI
```

The whole audit runs in the sandbox (`code.ts`); the UI just renders the
`AuditResult` it receives.

## Develop

```bash
npm install
npm run build      # one-shot -> dist/code.js + dist/ui.html
npm run watch      # rebuild on change
npm run compile    # tsc --noEmit typecheck
```

## Load in Figma (desktop app)

1. `npm run build`.
2. Figma desktop → **Plugins → Development → Import plugin from manifest…**
3. Select `figma-plugin/manifest.json`.
4. Open a file with color variables, then **Plugins → Development → Token Drift**.
5. Select a frame (or nothing, to audit the page) and click **Audit**.

After code changes: `npm run build` (or keep `npm run watch` running), then
re-run the plugin from the Plugins menu.
