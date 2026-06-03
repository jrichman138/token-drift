import { useEffect, useRef, useState } from 'react';
import { type AuditResult, aggregate } from '@/lib/audit/aggregate';
import { AUDIT_REQUEST, type AuditResponse, CLEAR_HIGHLIGHT } from '@/lib/messaging';
import { fetchRepoTokens } from '@/lib/tokens/fetch-tokens';
import { parseJsonTokens } from '@/lib/tokens/parse-json';
import { parseMarkdownTokens } from '@/lib/tokens/parse-markdown';
import { type TokenFileFormat, inferFormatFromUrl, sniffFormat } from '@/lib/tokens/repo-url';
import type { ParseResult } from '@/lib/tokens/types';
import { Report } from './Report';
import './App.css';

type InputMode = 'paste' | 'upload' | 'repo';

interface UploadedFile {
  name: string;
  text: string;
}

interface AuditState {
  result: AuditResult;
  warnings: string[];
  notices: string[];
  url: string;
  // The tab this audit ran against. The side panel is window-global, so we use
  // this to discard the report when the user switches to (or navigates) a
  // different tab — otherwise stale results bleed across pages.
  tabId: number;
}

function parseText(text: string, format: TokenFileFormat): ParseResult {
  return format === 'json' ? parseJsonTokens(text) : parseMarkdownTokens(text);
}

async function loadTokens(
  mode: InputMode,
  pasted: string,
  upload: UploadedFile | null,
  repoUrl: string,
): Promise<ParseResult> {
  if (mode === 'repo') {
    if (!repoUrl.trim()) throw new Error('Enter a repository file URL.');
    return fetchRepoTokens(repoUrl.trim());
  }
  if (mode === 'upload') {
    if (!upload) throw new Error('Choose a .json or .md token file.');
    const format = inferFormatFromUrl(upload.name) ?? sniffFormat(upload.text);
    return parseText(upload.text, format);
  }
  if (!pasted.trim()) throw new Error('Paste a token file to audit against.');
  return parseText(pasted, sniffFormat(pasted));
}

async function requestObservations(): Promise<{ response: AuditResponse; tabId: number | null }> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { response: { ok: false, error: 'No active tab to audit.' }, tabId: null };
  const tabId = tab.id;

  // On-demand injection: the content script is not in the manifest, so we push
  // it into the active tab here. This needs the activeTab grant, which we get
  // because the side panel was opened from the toolbar icon. Re-injection is
  // safe — the script guards itself with `window.__tokenDriftReady`.
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: ['/content-scripts/content.js'],
    });
  } catch (e) {
    console.error('Token Drift: executeScript injection failed', e);
    return {
      response: {
        ok: false,
        error:
          'Can’t audit this page. Open the page you want to check, click the Token Drift ' +
          'toolbar icon there, then run again. (Chrome system pages and the Web Store are off-limits.)',
      },
      tabId,
    };
  }

  try {
    return {
      response: (await browser.tabs.sendMessage(tabId, AUDIT_REQUEST)) as AuditResponse,
      tabId,
    };
  } catch {
    return {
      response: { ok: false, error: 'Could not reach the page. Reload the tab, then try again.' },
      tabId,
    };
  }
}

function App() {
  const [mode, setMode] = useState<InputMode>('upload');
  const [pasted, setPasted] = useState('');
  const [upload, setUpload] = useState<UploadedFile | null>(null);
  const [repoUrl, setRepoUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditState | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Mirrors the audited tab id for the tab listeners below (kept in a ref so the
  // listeners can read the latest value without re-subscribing on every audit).
  const auditedTabIdRef = useRef<number | null>(null);

  // A report describes one specific page, but the side panel is shared across
  // every tab in the window. Discard the report when the user switches to a
  // different tab, or when the audited tab navigates — so results never linger
  // on a page they didn't come from. Best-effort clear any on-page highlights too.
  useEffect(() => {
    function discard() {
      const stale = auditedTabIdRef.current;
      auditedTabIdRef.current = null;
      setAudit(null);
      setError(null);
      setCollapsed(false);
      if (stale != null && stale >= 0) {
        void browser.tabs.sendMessage(stale, CLEAR_HIGHLIGHT).catch(() => {});
      }
    }

    function onActivated(info: { tabId: number }) {
      if (auditedTabIdRef.current != null && info.tabId !== auditedTabIdRef.current) {
        discard();
      }
    }

    function onUpdated(
      tabId: number,
      changeInfo: { url?: string; status?: string },
    ) {
      // The audited tab reloaded or navigated — its sampled styles are gone.
      if (
        tabId === auditedTabIdRef.current &&
        (changeInfo.url != null || changeInfo.status === 'loading')
      ) {
        discard();
      }
    }

    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);
    return () => {
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  // After a run the input collapses to just its tabs; clicking a tab re-opens it.
  function selectMode(next: InputMode) {
    setMode(next);
    setCollapsed(false);
  }

  async function ingestFile(file: File) {
    setError(null);
    try {
      setUpload({ name: file.name, text: await file.text() });
    } catch {
      setUpload(null);
      setError('Could not read that file.');
    }
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      setUpload(null);
      return;
    }
    await ingestFile(file);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void ingestFile(file);
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const parsed = await loadTokens(mode, pasted, upload, repoUrl);
      const { response: page, tabId } = await requestObservations();
      if (!page.ok) {
        setError(page.error);
        return;
      }
      auditedTabIdRef.current = tabId;
      setAudit({
        result: aggregate(page.observations, parsed.tokens),
        warnings: parsed.warnings,
        notices: page.notices ?? [],
        url: page.url,
        tabId: tabId ?? -1,
      });
      setCollapsed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app">
      <header className="app__header">
        <h1>Token Drift</h1>
        <p className="app__subtitle">
          Check how closely this page follows your design system tokens, matches,
          near-misses, and drift.
        </p>
      </header>

      <section className={`input${collapsed ? ' is-collapsed' : ''}`}>
        <div className="input__tabs" role="tablist" aria-label="Token source">
          <button
            role="tab"
            id="tab-upload"
            aria-selected={mode === 'upload'}
            aria-controls="token-input-panel"
            className={mode === 'upload' ? 'is-active' : ''}
            onClick={() => selectMode('upload')}
          >
            Upload
          </button>
          <button
            role="tab"
            id="tab-repo"
            aria-selected={mode === 'repo'}
            aria-controls="token-input-panel"
            className={mode === 'repo' ? 'is-active' : ''}
            onClick={() => selectMode('repo')}
          >
            Repo URL
          </button>
          <button
            role="tab"
            id="tab-paste"
            aria-selected={mode === 'paste'}
            aria-controls="token-input-panel"
            className={mode === 'paste' ? 'is-active' : ''}
            onClick={() => selectMode('paste')}
          >
            Paste
          </button>
        </div>

        {!collapsed && (
          <div
            className="input__panel"
            role="tabpanel"
            id="token-input-panel"
            aria-labelledby={`tab-${mode}`}
          >
            {mode === 'upload' && (
              <div
                className={`dropzone${dragging ? ' is-dragging' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  aria-label="Upload token file"
                  accept=".json,.md,.markdown,application/json,text/markdown"
                  onChange={onFileChange}
                  hidden
                />
                {upload ? (
                  <p className="dropzone__file">
                    {upload.name}{' '}
                    <button
                      type="button"
                      className="dropzone__browse"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      change
                    </button>
                  </p>
                ) : (
                  <p className="dropzone__hint">
                    Drag &amp; drop a token file, or{' '}
                    <button
                      type="button"
                      className="dropzone__browse"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      browse
                    </button>
                  </p>
                )}
                <p className="dropzone__meta">.json or .md</p>
              </div>
            )}

            {mode === 'repo' && (
              <>
                <input
                  className="input__url"
                  type="url"
                  aria-label="Repository file URL"
                  placeholder="https://github.com/org/repo/blob/main/tokens.json"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                />
                <p className="input__hint">
                  Public repositories only in v1 — no authentication. GitHub and GitLab
                  blob links are rewritten to raw automatically.
                </p>
              </>
            )}

            {mode === 'paste' && (
              <textarea
                className="input__textarea"
                aria-label="Token file contents"
                placeholder="Paste a JSON or Markdown token file…"
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                spellCheck={false}
              />
            )}

            <button className="input__run" onClick={run} disabled={busy}>
              {busy ? 'Auditing…' : 'Audit this page'}
            </button>
          </div>
        )}
        {error && (
          <p className="input__error" role="alert">
            {error}
          </p>
        )}
      </section>

      {audit && (
        <Report
          result={audit.result}
          warnings={audit.warnings}
          notices={audit.notices}
          url={audit.url}
        />
      )}

      <footer className="app__privacy">
        Runs only on the tab you’re auditing, only when you click. Your tokens and the page’s
        styles are analyzed on your device and never leave the browser.
      </footer>
    </main>
  );
}

export default App;
