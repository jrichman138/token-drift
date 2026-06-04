// Builds the two artifacts a Figma plugin needs:
//   dist/code.js  — the sandbox bundle (manifest `main`)
//   dist/ui.html  — a single self-contained HTML file with the UI JS inlined
//                   (manifest `ui`; Figma requires one file, no external refs)
//
// Run: `node build.mjs` (one-shot) or `node build.mjs --watch`.

import { mkdirSync, writeFileSync } from 'node:fs';
import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
mkdirSync('dist', { recursive: true });

const shared = {
  bundle: true,
  target: 'es2017',
  format: 'iife',
  minify: true,
  // React reads process.env.NODE_ENV at runtime; the Figma iframe has no
  // `process`, so we must define it (this also selects React's production build).
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
};

// --- UI HTML template (styles live here; Figma theme vars + fallbacks) --------
function htmlTemplate(js) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  :root {
    --bg: var(--figma-color-bg, #ffffff);
    --bg-secondary: var(--figma-color-bg-secondary, #f5f5f7);
    --text: var(--figma-color-text, #1a1a1a);
    --text-secondary: var(--figma-color-text-secondary, #6b7280);
    --border: var(--figma-color-border, #e6e6e6);
    --accent: var(--figma-color-bg-brand, #1b607f);
    --accent-text: var(--figma-color-text-onbrand, #ffffff);
    --good: #1f9d55; --ok: #7ba843; --warn: #d99a2b; --bad: #d1495b;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: Inter, -apple-system, system-ui, sans-serif;
    font-size: 12px; color: var(--text); background: var(--bg);
  }
  .app { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .head h1 { margin: 0; font-size: 14px; font-weight: 600; }
  .sub, .hint, .context { margin: 4px 0 0; color: var(--text-secondary); line-height: 1.4; }
  .hint { margin-top: 0; }
  .run {
    appearance: none; border: 0; border-radius: 6px; padding: 10px 14px;
    background: var(--accent); color: var(--accent-text); font-weight: 600;
    font-size: 12px; cursor: pointer;
  }
  .run:disabled { opacity: 0.6; cursor: default; }
  .error {
    margin: 0; padding: 8px 10px; border-radius: 6px; line-height: 1.4;
    background: rgba(209, 73, 91, 0.12); color: var(--bad);
  }
  .verdict {
    display: flex; align-items: center; gap: 12px; padding: 14px;
    border-radius: 8px; background: var(--bg-secondary);
    border-left: 4px solid var(--border);
  }
  .verdict--good { border-left-color: var(--good); }
  .verdict--ok { border-left-color: var(--ok); }
  .verdict--warn { border-left-color: var(--warn); }
  .verdict--bad { border-left-color: var(--bad); }
  .score { font-size: 30px; font-weight: 700; line-height: 1; }
  .verdict--good .score { color: var(--good); }
  .verdict--ok .score { color: var(--ok); }
  .verdict--warn .score { color: var(--warn); }
  .verdict--bad .score { color: var(--bad); }
  .verdict__label { font-weight: 600; }
  .verdict__scope { color: var(--text-secondary); margin-top: 2px; }
  .context { margin: 0; }
  .note {
    margin: 0; padding: 8px 10px; border-radius: 6px; line-height: 1.4;
    background: rgba(217, 154, 43, 0.12); color: var(--warn);
  }
  .warnings { margin: 0; padding-left: 16px; color: var(--text-secondary); }
  .totals { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .stat {
    background: var(--bg-secondary); border-radius: 6px; padding: 8px;
    text-align: center;
  }
  .stat__value { font-size: 16px; font-weight: 600; }
  .stat__label { color: var(--text-secondary); margin-top: 2px; }
  .violations h2 { margin: 0 0 8px; font-size: 12px; font-weight: 600; }
  .violations .count {
    display: inline-block; min-width: 18px; padding: 1px 6px; margin-left: 4px;
    border-radius: 999px; background: var(--bg-secondary); text-align: center;
  }
  .empty { margin: 0; color: var(--text-secondary); }
  .vlist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .violation {
    display: flex; flex-direction: column; gap: 6px; padding: 8px;
    border-radius: 6px; background: var(--bg-secondary);
    border-left: 3px solid var(--border);
  }
  .v--detached { border-left-color: var(--warn); }
  .v--near { border-left-color: var(--ok); }
  .v--orphan { border-left-color: var(--bad); }
  .vrow { display: flex; align-items: center; gap: 8px; }
  .swatch { width: 16px; height: 16px; border-radius: 4px; border: 1px solid var(--border); flex: 0 0 auto; }
  .vvalue { font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  .vcount { color: var(--text-secondary); }
  .chip {
    margin-left: auto; font-size: 10px; font-weight: 600; padding: 2px 7px;
    border-radius: 999px; text-transform: uppercase; letter-spacing: 0.03em;
  }
  .chip--detached { background: rgba(217, 154, 43, 0.16); color: var(--warn); }
  .chip--near { background: rgba(123, 168, 67, 0.16); color: var(--ok); }
  .chip--orphan { background: rgba(209, 73, 91, 0.16); color: var(--bad); }
  .vmeta { display: flex; align-items: center; gap: 8px; }
  .vsuggest { color: var(--text-secondary); font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  .vsuggest--none { font-style: italic; font-family: inherit; }
  .vactions { display: flex; gap: 6px; margin-left: auto; }
  .vactions button {
    appearance: none; border: 1px solid var(--border); border-radius: 6px;
    padding: 5px 10px; cursor: pointer; font-size: 11px; font-weight: 600;
    background: var(--bg); color: var(--text);
  }
  .vactions button:hover { background: var(--bg); border-color: var(--accent); }
  .vactions .bind { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
  .vactions .bind:disabled { opacity: 0.6; cursor: default; }
  .violations__note { margin: 8px 0 0; color: var(--text-secondary); line-height: 1.4; font-size: 11px; }
  .toast {
    margin: 0; padding: 8px 10px; border-radius: 6px; line-height: 1.4;
    background: rgba(27, 96, 127, 0.12); color: var(--accent);
  }
</style>
</head>
<body>
<div id="root"></div>
<script>${js}</script>
</body>
</html>`;
}

// Plugin that writes dist/ui.html from the in-memory UI bundle on every build.
const htmlPlugin = {
  name: 'inline-html',
  setup(build) {
    build.onEnd((result) => {
      const out = result.outputFiles?.find((f) => f.path.endsWith('.js'));
      if (out) writeFileSync('dist/ui.html', htmlTemplate(out.text));
    });
  },
};

const codeCtx = await esbuild.context({
  ...shared,
  entryPoints: ['src/main/code.ts'],
  outfile: 'dist/code.js',
});

const uiCtx = await esbuild.context({
  ...shared,
  entryPoints: ['src/ui/ui.tsx'],
  outdir: 'dist',
  write: false, // the plugin inlines the JS into ui.html instead
  jsx: 'automatic',
  plugins: [htmlPlugin],
});

if (watch) {
  await codeCtx.watch();
  await uiCtx.watch();
  console.log('Token Drift (Figma) — watching for changes…');
} else {
  await codeCtx.rebuild();
  await uiCtx.rebuild();
  await codeCtx.dispose();
  await uiCtx.dispose();
  console.log('Built dist/code.js and dist/ui.html');
}
