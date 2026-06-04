import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ColorAuditResult, DriftGroup, DriftStatus } from '../figma/audit';
import type { PluginMessage, UIMessage } from '../shared/messaging';

interface ResultState {
  result: ColorAuditResult;
  scope: string;
  nodeCount: number;
  tokenCount: number;
  truncated: boolean;
  warnings: string[];
}

function tone(coherence: number): string {
  if (coherence >= 0.95) return 'good';
  if (coherence >= 0.8) return 'ok';
  if (coherence >= 0.6) return 'warn';
  return 'bad';
}

const STATUS_LABEL: Record<DriftStatus, string> = {
  detached: 'Detached',
  near: 'Near token',
  orphan: 'Off-system',
};

function send(message: UIMessage): void {
  parent.postMessage({ pluginMessage: message }, '*');
}

function groupKey(g: DriftGroup): string {
  return `${g.status} ${g.value}`;
}

function App() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ResultState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // value-key of the group currently being rebound, for a per-row spinner.
  const [binding, setBinding] = useState<string | null>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const msg = event.data?.pluginMessage as PluginMessage | undefined;
      if (!msg) return;

      if (msg.type === 'audit-error') {
        setBusy(false);
        setBinding(null);
        setError(msg.error);
        return;
      }
      if (msg.type === 'audit-result') {
        setBusy(false);
        setBinding(null);
        setError(null);
        setData({
          result: msg.result,
          scope: msg.scope,
          nodeCount: msg.nodeCount,
          tokenCount: msg.tokenCount,
          truncated: msg.truncated,
          warnings: msg.warnings,
        });
        return;
      }
      if (msg.type === 'rebind-done') {
        const note =
          msg.failed > 0
            ? `Bound ${msg.fixed}, ${msg.failed} skipped. Re-auditing…`
            : `Bound ${msg.fixed}. Re-auditing…`;
        setToast(note);
        window.setTimeout(() => setToast(null), 2200);
        send({ type: 'run-audit' }); // refresh so the list reflects the fix
      }
      // locate-done: nothing to render.
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  function run() {
    setBusy(true);
    setError(null);
    send({ type: 'run-audit' });
  }

  function locate(g: DriftGroup) {
    send({ type: 'locate', refs: g.refs });
  }

  function bind(g: DriftGroup) {
    if (!g.suggestionVariableId) return;
    setBinding(groupKey(g));
    send({ type: 'rebind', variableId: g.suggestionVariableId, refs: g.refs });
  }

  const result = data?.result;
  const t = result?.totals;

  return (
    <div className="app">
      <header className="head">
        <h1>Token Drift</h1>
        <p className="sub">Audit colors against this file’s variables — and fix drift in place.</p>
      </header>

      <button className="run" onClick={run} disabled={busy}>
        {busy ? 'Auditing…' : 'Audit selection or page'}
      </button>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {toast && <p className="toast">{toast}</p>}

      {data && result && t && (
        <>
          <section className={`verdict verdict--${tone(result.coherence)}`}>
            <div className="score">{Math.round(result.coherence * 100)}%</div>
            <div className="verdict__meta">
              <div className="verdict__label">{t.bound} of {t.total} paints bound</div>
              <div className="verdict__scope">{data.scope}</div>
            </div>
          </section>

          <p className="context">
            {data.tokenCount} color token{data.tokenCount === 1 ? '' : 's'} · {data.nodeCount} node
            {data.nodeCount === 1 ? '' : 's'} scanned{data.truncated ? ' (truncated)' : ''}
          </p>

          {data.tokenCount === 0 && (
            <p className="note">
              No color variables found (locally or bound on the canvas), so nothing can be bound.
              Open a file whose layers use color variables.
            </p>
          )}

          <div className="totals">
            <Stat label="Bound" value={t.bound} />
            <Stat label="Detached" value={t.detached} />
            <Stat label="Near" value={t.near} />
            <Stat label="Off-system" value={t.orphan} />
          </div>

          <section className="violations">
            <h2>
              Drifting colors <span className="count">{result.driftGroups.length}</span>
            </h2>
            {result.driftGroups.length === 0 ? (
              <p className="empty">Every paint is bound to a token. 🎯</p>
            ) : (
              <ul className="vlist">
                {result.driftGroups.map((g) => {
                  const canBind = !!g.suggestionVariableId && g.status !== 'orphan';
                  const isBinding = binding === groupKey(g);
                  return (
                    <li key={groupKey(g)} className={`violation v--${g.status}`}>
                      <div className="vrow">
                        <span className="swatch" style={{ background: g.value }} aria-hidden />
                        <span className="vvalue">{g.value}</span>
                        <span className="vcount">×{g.instanceCount}</span>
                        <span className={`chip chip--${g.status}`}>{STATUS_LABEL[g.status]}</span>
                      </div>
                      <div className="vmeta">
                        {g.suggestionName ? (
                          <span className="vsuggest">
                            → {g.suggestionName}
                            {g.deltaLabel ? ` (${g.deltaLabel})` : ''}
                          </span>
                        ) : (
                          <span className="vsuggest vsuggest--none">no nearby token</span>
                        )}
                        <span className="vactions">
                          <button className="locate" onClick={() => locate(g)}>
                            Locate
                          </button>
                          {canBind && (
                            <button className="bind" onClick={() => bind(g)} disabled={isBinding}>
                              {isBinding ? 'Binding…' : `Bind ×${g.instanceCount}`}
                            </button>
                          )}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {result.driftGroups.some((g) => g.status === 'detached') && (
              <p className="violations__note">
                “Detached” = the color already matches a token but isn’t linked to its variable.
                Binding it changes nothing visually — it just puts it back under the design system.
              </p>
            )}
          </section>
        </>
      )}

      {!data && !error && (
        <p className="hint">
          Select a frame to audit just that, or run with nothing selected to audit the whole page.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <div className="stat__value">{value}</div>
      <div className="stat__label">{label}</div>
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
