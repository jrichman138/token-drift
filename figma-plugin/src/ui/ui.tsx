import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ColorAuditResult, DriftGroup } from '../figma/audit';
import type { DimAuditResult, DimDriftGroup } from '../figma/dimension';
import type { TypeAuditResult, TypeDriftGroup } from '../figma/text';
import type { PluginMessage, UIMessage } from '../shared/messaging';

interface ResultState {
  color: ColorAuditResult;
  typography: TypeAuditResult;
  spacing: DimAuditResult;
  radius: DimAuditResult;
  scope: string;
  nodeCount: number;
  colorTokenCount: number;
  truncated: boolean;
  warnings: string[];
}

function tone(coherence: number): string {
  if (coherence >= 0.95) return 'good';
  if (coherence >= 0.8) return 'ok';
  if (coherence >= 0.6) return 'warn';
  return 'bad';
}

const COLOR_STATUS_LABEL: Record<DriftGroup['status'], string> = {
  detached: 'Detached',
  near: 'Near token',
  orphan: 'Off-system',
};
const TYPE_STATUS_LABEL: Record<TypeDriftGroup['status'], string> = {
  detached: 'Detached',
  close: 'Close',
  off: 'No style',
  mixed: 'Mixed',
};

const TYPE_STATUS_HINT: Record<TypeDriftGroup['status'], string> = {
  detached: 'exact match — applying changes nothing',
  close: 'snaps line-height / letter-spacing',
  off: 'no matching text style',
  mixed: 'multiple fonts in one layer',
};

function send(message: UIMessage): void {
  parent.postMessage({ pluginMessage: message }, '*');
}

function colorKey(g: DriftGroup): string {
  return `c:${g.status}:${g.value}`;
}

function App() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ResultState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null); // key of the group being fixed

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const msg = event.data?.pluginMessage as PluginMessage | undefined;
      if (!msg) return;

      if (msg.type === 'audit-error') {
        setBusy(false);
        setWorking(null);
        setError(msg.error);
        return;
      }
      if (msg.type === 'audit-result') {
        setBusy(false);
        setWorking(null);
        setError(null);
        setData({
          color: msg.color,
          typography: msg.typography,
          spacing: msg.spacing,
          radius: msg.radius,
          scope: msg.scope,
          nodeCount: msg.nodeCount,
          colorTokenCount: msg.colorTokenCount,
          truncated: msg.truncated,
          warnings: msg.warnings,
        });
        return;
      }
      if (
        msg.type === 'rebind-done' ||
        msg.type === 'apply-style-done' ||
        msg.type === 'replace-font-done' ||
        msg.type === 'bind-dimension-done'
      ) {
        const fb =
          msg.type === 'replace-font-done' && msg.fallbacks > 0
            ? `, ${msg.fallbacks} weight-substituted`
            : '';
        const note =
          msg.failed > 0
            ? `${msg.fixed} fixed${fb}, ${msg.failed} skipped. Re-auditing…`
            : `${msg.fixed} fixed${fb}. Re-auditing…`;
        setToast(note);
        window.setTimeout(() => setToast(null), 2400);
        send({ type: 'run-audit' });
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  function run() {
    setBusy(true);
    setError(null);
    send({ type: 'run-audit' });
  }

  function locate(nodeIds: string[]) {
    send({ type: 'locate', nodeIds });
  }

  function useColorToken(g: DriftGroup) {
    if (!g.suggestionVariableId) return;
    setWorking(colorKey(g));
    send({ type: 'rebind', variableId: g.suggestionVariableId, refs: g.refs });
  }

  function useTextStyle(g: TypeDriftGroup) {
    if (!g.styleId) return;
    setWorking(g.key);
    send({ type: 'apply-style', styleId: g.styleId, nodeIds: g.nodeIds });
  }

  function replaceFont(g: TypeDriftGroup, family: string) {
    setWorking(g.key);
    send({ type: 'replace-font', family, nodeIds: g.nodeIds });
  }

  function bindDimension(g: DimDriftGroup) {
    if (!g.suggestionVariableId) return;
    setWorking(g.key);
    send({ type: 'bind-dimension', variableId: g.suggestionVariableId, refs: g.refs });
  }

  return (
    <div className="app">
      <header className="head">
        <h1>Token Drift</h1>
        <p className="sub">Audit color &amp; type against this file’s tokens — and fix drift in place.</p>
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

      {data && (
        <>
          <p className="context">
            {data.scope} · {data.nodeCount} node{data.nodeCount === 1 ? '' : 's'}
            {data.truncated ? ' (truncated)' : ''}
          </p>

          <ColorSection
            result={data.color}
            tokenCount={data.colorTokenCount}
            working={working}
            onLocate={locate}
            onUse={useColorToken}
          />

          <TypeSection
            result={data.typography}
            working={working}
            onLocate={locate}
            onUse={useTextStyle}
            onReplaceFont={replaceFont}
          />

          <DimSection
            title="Spacing"
            result={data.spacing}
            working={working}
            onLocate={locate}
            onUse={bindDimension}
          />

          <DimSection
            title="Radius"
            result={data.radius}
            working={working}
            onLocate={locate}
            onUse={bindDimension}
          />
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

function SectionHead({ title, coherence, drift }: { title: string; coherence: number; drift: number }) {
  return (
    <div className={`shead shead--${tone(coherence)}`}>
      <span className="shead__title">{title}</span>
      <span className="shead__score">{Math.round(coherence * 100)}%</span>
      <span className="shead__drift">{drift} to fix</span>
    </div>
  );
}

function ColorSection({
  result,
  tokenCount,
  working,
  onLocate,
  onUse,
}: {
  result: ColorAuditResult;
  tokenCount: number;
  working: string | null;
  onLocate: (ids: string[]) => void;
  onUse: (g: DriftGroup) => void;
}) {
  const t = result.totals;
  return (
    <section className="section">
      <SectionHead title="Color" coherence={result.coherence} drift={result.driftGroups.length} />
      {tokenCount === 0 ? (
        <p className="note">No color variables found (locally or bound on the canvas).</p>
      ) : (
        <div className="totals">
          <Stat label="On token" value={t.bound} />
          <Stat label="Detached" value={t.detached} />
          <Stat label="Near" value={t.near} />
          <Stat label="Off-system" value={t.orphan} />
        </div>
      )}
      {result.driftGroups.length === 0 ? (
        <p className="empty">No color drift.</p>
      ) : (
        <ul className="vlist">
          {result.driftGroups.map((g) => {
            const canUse = !!g.suggestionVariableId && g.status !== 'orphan';
            const isWorking = working === colorKey(g);
            return (
              <li key={colorKey(g)} className={`violation v--${g.status}`}>
                <div className="vrow">
                  <span className="swatch" style={{ background: g.value }} aria-hidden />
                  <span className="vvalue">{g.value}</span>
                  <span className="vcount">×{g.instanceCount}</span>
                  <span className={`chip chip--${g.status}`}>{COLOR_STATUS_LABEL[g.status]}</span>
                </div>
                <div className="vmeta">
                  <span className={`vsuggest${g.suggestionName ? '' : ' vsuggest--none'}`}>
                    {canUse
                      ? g.deltaLabel ?? 'exact match'
                      : g.suggestionName
                        ? `closest: ${g.suggestionName}${g.deltaLabel ? ` (${g.deltaLabel})` : ''}`
                        : 'no nearby token'}
                  </span>
                  <span className="vactions">
                    <button className="locate" onClick={() => onLocate([...new Set(g.refs.map((r) => r.nodeId))])}>
                      Locate
                    </button>
                    {canUse && (
                      <button className="bind" onClick={() => onUse(g)} disabled={isWorking}>
                        {isWorking ? 'Applying…' : `Use ${g.suggestionName}`}
                      </button>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function FontSwap({
  families,
  disabled,
  onApply,
}: {
  families: string[];
  disabled: boolean;
  onApply: (family: string) => void;
}) {
  const [family, setFamily] = useState(families[0]);
  if (families.length === 1) {
    return (
      <button className="bind" disabled={disabled} onClick={() => onApply(families[0])}>
        {disabled ? 'Applying…' : `Use ${families[0]}`}
      </button>
    );
  }
  return (
    <span className="fontswap">
      <select value={family} onChange={(e) => setFamily(e.target.value)} disabled={disabled}>
        {families.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
      <button className="bind" disabled={disabled} onClick={() => onApply(family)}>
        {disabled ? '…' : 'Use'}
      </button>
    </span>
  );
}

function TypeSection({
  result,
  working,
  onLocate,
  onUse,
  onReplaceFont,
}: {
  result: TypeAuditResult;
  working: string | null;
  onLocate: (ids: string[]) => void;
  onUse: (g: TypeDriftGroup) => void;
  onReplaceFont: (g: TypeDriftGroup, family: string) => void;
}) {
  const t = result.totals;
  return (
    <section className="section">
      <SectionHead title="Typography" coherence={result.coherence} drift={result.driftGroups.length} />
      {result.styleTokenCount === 0 ? (
        <p className="note">No text styles found in this file.</p>
      ) : (
        <div className="totals">
          <Stat label="On token" value={t.onToken} />
          <Stat label="Detached" value={t.detached} />
          <Stat label="Close" value={t.close} />
          <Stat label="No style" value={t.off} />
        </div>
      )}
      {result.driftGroups.length === 0 ? (
        <p className="empty">No type drift.</p>
      ) : (
        <ul className="vlist">
          {result.driftGroups.map((g) => {
            const canUse = !!g.styleId;
            const isWorking = working === g.key;
            return (
              <li key={g.key} className={`violation v--${g.status}`}>
                <div className="vrow">
                  <span className="vvalue">{g.label}</span>
                  <span className="vcount">×{g.instanceCount}</span>
                  <span className={`chip chip--${g.status}`}>{TYPE_STATUS_LABEL[g.status]}</span>
                </div>
                <div className="vmeta">
                  <span className="vsuggest vsuggest--none">{TYPE_STATUS_HINT[g.status]}</span>
                  <span className="vactions">
                    <button className="locate" onClick={() => onLocate(g.nodeIds)}>
                      Locate
                    </button>
                    {canUse && (
                      <button className="bind" onClick={() => onUse(g)} disabled={isWorking}>
                        {isWorking ? 'Applying…' : `Use ${g.styleName}`}
                      </button>
                    )}
                    {g.offFont && result.systemFamilies.length > 0 && (
                      <FontSwap
                        families={result.systemFamilies}
                        disabled={isWorking}
                        onApply={(family) => onReplaceFont(g, family)}
                      />
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function DimSection({
  title,
  result,
  working,
  onLocate,
  onUse,
}: {
  title: string;
  result: DimAuditResult;
  working: string | null;
  onLocate: (ids: string[]) => void;
  onUse: (g: DimDriftGroup) => void;
}) {
  const t = result.totals;
  const lower = title.toLowerCase();
  return (
    <section className="section">
      <SectionHead title={title} coherence={result.coherence} drift={result.driftGroups.length} />
      {result.tokenCount === 0 ? (
        <p className="note">No {lower} variables found (locally or bound on the canvas).</p>
      ) : (
        <div className="totals">
          <Stat label="On token" value={t.bound} />
          <Stat label="Detached" value={t.detached} />
          <Stat label="Off-system" value={t.off} />
        </div>
      )}
      {result.driftGroups.length === 0 ? (
        <p className="empty">No {lower} drift.</p>
      ) : (
        <ul className="vlist">
          {result.driftGroups.map((g) => {
            const canUse = !!g.suggestionVariableId; // detached only
            const isWorking = working === g.key;
            const variant = g.status === 'detached' ? 'detached' : 'orphan';
            return (
              <li key={g.key} className={`violation v--${variant}`}>
                <div className="vrow">
                  <span className="vvalue">{g.value}px</span>
                  <span className="vcount">×{g.instanceCount}</span>
                  <span className={`chip chip--${variant}`}>
                    {g.status === 'detached' ? 'Detached' : 'Off-system'}
                  </span>
                </div>
                <div className="vmeta">
                  <span className={`vsuggest${g.suggestionName ? '' : ' vsuggest--none'}`}>
                    {canUse
                      ? 'exact match'
                      : g.suggestionName
                        ? `closest: ${g.suggestionName} (${g.suggestionValue}px${g.deltaLabel ? `, ${g.deltaLabel}` : ''})`
                        : 'no nearby token'}
                  </span>
                  <span className="vactions">
                    <button
                      className="locate"
                      onClick={() => onLocate([...new Set(g.refs.map((r) => r.nodeId))])}
                    >
                      Locate
                    </button>
                    {canUse && (
                      <button className="bind" onClick={() => onUse(g)} disabled={isWorking}>
                        {isWorking ? 'Applying…' : `Use ${g.suggestionName}`}
                      </button>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
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
