import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { BindableToken, ColorAuditResult, DriftGroup } from '../figma/audit';
import type { DimAuditResult, DimDriftGroup } from '../figma/dimension';
import type { EffectAuditResult, EffectDriftGroup } from '../figma/effect';
import type { ScaleOutlier, ScaleResult, ScaleResults } from '../figma/scale';
import type { TypeAuditResult, TypeDriftGroup } from '../figma/text';
import type { PluginMessage, UIMessage } from '../shared/messaging';

type Mode = 'tokens' | 'consistency';

interface ResultState {
  color: ColorAuditResult;
  typography: TypeAuditResult;
  spacing: DimAuditResult;
  radius: DimAuditResult;
  stroke: DimAuditResult;
  elevation: EffectAuditResult;
  scale: ScaleResults;
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

// Total drift groups + detached (zero-change) groups across token sections.
function countDrift(results: { driftGroups: { status: string }[] }[]): {
  total: number;
  detached: number;
} {
  let total = 0;
  let detached = 0;
  for (const r of results) {
    total += r.driftGroups.length;
    detached += r.driftGroups.filter((g) => g.status === 'detached').length;
  }
  return { total, detached };
}

function App() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ResultState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null); // key of the group being fixed
  const [mode, setMode] = useState<Mode>('tokens');

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
          stroke: msg.stroke,
          elevation: msg.elevation,
          scale: msg.scale,
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
        msg.type === 'bind-dimension-done' ||
        msg.type === 'apply-effect-style-done' ||
        msg.type === 'normalize-dimension-done'
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
      if (msg.type === 'fix-all-done') {
        // The sandbox re-audits itself; just surface the count (audit-result clears `working`).
        setToast(`Fixed ${msg.fixed} detached. Re-auditing…`);
        window.setTimeout(() => setToast(null), 2400);
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

  // Bind a near/off color group to a user-chosen token (from the picker).
  function pickColorToken(g: DriftGroup, variableId: string) {
    setWorking(colorKey(g));
    send({ type: 'rebind', variableId, refs: g.refs });
  }

  // Off-system drifts → user-chosen token/style (from the picker), per category.
  function pickDimension(g: DimDriftGroup, variableId: string) {
    setWorking(g.key);
    send({ type: 'bind-dimension', variableId, refs: g.refs });
  }
  function pickTextStyle(g: TypeDriftGroup, styleId: string) {
    setWorking(g.key);
    send({ type: 'apply-style', styleId, nodeIds: g.nodeIds });
  }
  function pickEffectStyle(g: EffectDriftGroup, styleId: string) {
    setWorking(g.key);
    send({ type: 'apply-effect-style', styleId, nodeIds: g.nodeIds });
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

  function applyEffectStyle(g: EffectDriftGroup) {
    if (!g.styleId) return;
    setWorking(g.key);
    send({ type: 'apply-effect-style', styleId: g.styleId, nodeIds: g.nodeIds });
  }

  function normalize(category: string, o: ScaleOutlier) {
    setWorking(`${category}:${o.value}`);
    send({ type: 'normalize-dimension', value: o.suggest, refs: o.refs });
  }

  function fixAll() {
    setWorking('fixall');
    send({ type: 'fix-all-detached' });
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
      {/* Always-mounted live region so toast updates are announced to screen readers. */}
      <p className="sr-only" role="status" aria-live="polite">
        {toast}
      </p>

      {data && (
        <>
          <p className="context">
            {data.scope} · {data.nodeCount} node{data.nodeCount === 1 ? '' : 's'}
            {data.truncated ? ' (truncated)' : ''}
          </p>

          <div className="modes" role="tablist">
            <button
              role="tab"
              aria-selected={mode === 'tokens'}
              className={mode === 'tokens' ? 'is-active' : ''}
              onClick={() => setMode('tokens')}
            >
              Tokens
            </button>
            <button
              role="tab"
              aria-selected={mode === 'consistency'}
              className={mode === 'consistency' ? 'is-active' : ''}
              onClick={() => setMode('consistency')}
            >
              Consistency
            </button>
          </div>

          {mode === 'tokens' &&
            (() => {
              const { total, detached } = countDrift([
                data.color,
                data.typography,
                data.spacing,
                data.radius,
                data.stroke,
                data.elevation,
              ]);
              return (
                <div className="summary">
                  <span>
                    {total === 0 ? (
                      'No token drift — everything maps to a token.'
                    ) : (
                      <>
                        <strong>{total}</strong> issue{total === 1 ? '' : 's'} to review
                        {detached > 0 && (
                          <>
                            {' · '}
                            <strong>{detached}</strong> zero-change fix{detached === 1 ? '' : 'es'}
                          </>
                        )}
                      </>
                    )}
                  </span>
                  {detached > 0 && (
                    <button className="fixall" disabled={working === 'fixall'} onClick={fixAll}>
                      {working === 'fixall' ? 'Fixing…' : `Fix all ${detached} detached`}
                    </button>
                  )}
                </div>
              );
            })()}

          {mode === 'tokens' && (
            <>
              <ColorSection
                result={data.color}
                tokenCount={data.colorTokenCount}
                working={working}
                onLocate={locate}
                onUse={useColorToken}
                onPick={pickColorToken}
              />
              <TypeSection
                result={data.typography}
                working={working}
                onLocate={locate}
                onUse={useTextStyle}
                onReplaceFont={replaceFont}
                onPick={pickTextStyle}
              />
              <DimSection title="Spacing" result={data.spacing} working={working} onLocate={locate} onUse={bindDimension} onPick={pickDimension} />
              <DimSection title="Radius" result={data.radius} working={working} onLocate={locate} onUse={bindDimension} onPick={pickDimension} />
              <DimSection title="Stroke" result={data.stroke} working={working} onLocate={locate} onUse={bindDimension} onPick={pickDimension} />
              <ElevationSection result={data.elevation} working={working} onLocate={locate} onUse={applyEffectStyle} onPick={pickEffectStyle} />
            </>
          )}

          {mode === 'consistency' && (
            <>
              {(() => {
                const outliers =
                  data.scale.spacing.outliers.length +
                  data.scale.radius.outliers.length +
                  data.scale.stroke.outliers.length;
                return (
                  <p className="summary">
                    {outliers === 0 ? (
                      'No outliers — your scales look consistent.'
                    ) : (
                      <>
                        <strong>{outliers}</strong> outlier{outliers === 1 ? '' : 's'} across spacing, radius &amp; stroke
                      </>
                    )}
                  </p>
                );
              })()}
              <p className="hint">
                Outliers found without tokens — values that look like accidental deviations
                from your de-facto scale. “Set to N” changes the value (a small visual edit).
              </p>
              <ScaleSection title="Spacing" result={data.scale.spacing} working={working} onLocate={locate} onNormalize={normalize} />
              <ScaleSection title="Radius" result={data.scale.radius} working={working} onLocate={locate} onNormalize={normalize} />
              <ScaleSection title="Stroke" result={data.scale.stroke} working={working} onLocate={locate} onNormalize={normalize} />
            </>
          )}
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

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Order tokens by simple RGB closeness to a value — just for the dropdown's
// default + ordering (the precise ΔE classification already happened in the
// sandbox); a rough sort is plenty for a picker.
function sortTokensByCloseness(tokens: BindableToken[], hex: string): BindableToken[] {
  const target = hexToRgb(hex);
  if (!target) return tokens;
  const dist = (t: BindableToken) => {
    const c = hexToRgb(t.value);
    if (!c) return Infinity;
    return (c[0] - target[0]) ** 2 + (c[1] - target[1]) ** 2 + (c[2] - target[2]) ** 2;
  };
  return [...tokens].sort((a, b) => dist(a) - dist(b));
}

// One row in a picker menu. `swatch` (a CSS color) is optional — color tokens
// show a chip, dimension/style tokens just show name + meta.
interface PickOption {
  id: string;
  name: string;
  meta?: string; // hex, "16px", "Inter 14", …
  swatch?: string;
}

// A button + menu for picking which token/style a near/off value should adopt.
// Each option shows an optional chip, a name, and meta; picking a row applies it.
function PickerMenu({
  options,
  label = 'Use token',
  disabled,
  onApply,
}: {
  options: PickOption[]; // best match first
  label?: string;
  disabled: boolean;
  onApply: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true);
    };
    window.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    // Move focus into the menu so keyboard users land on the first option.
    listRef.current?.querySelector('button')?.focus();
    return () => {
      window.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  if (options.length === 0) return null;

  // A plain button menu (no listbox role): every option is a real <button>, so it's
  // fully keyboard-operable via Tab/Enter; Escape closes and returns focus.
  return (
    <span className="tokenmenu" ref={ref}>
      <button
        ref={triggerRef}
        className="tokenmenu__trigger"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {options[0].swatch && (
          <span className="tokenmenu__chip" style={{ background: options[0].swatch }} aria-hidden />
        )}
        <span>{disabled ? 'Applying…' : label}</span>
        <span className="tokenmenu__caret" aria-hidden>▾</span>
      </button>
      {open && (
        <ul className="tokenmenu__list" ref={listRef}>
          {options.map((o) => (
            <li key={o.id}>
              <button
                className="tokenmenu__item"
                onClick={() => {
                  setOpen(false);
                  onApply(o.id);
                }}
              >
                {o.swatch && <span className="tokenmenu__chip" style={{ background: o.swatch }} aria-hidden />}
                <span className="tokenmenu__name">{o.name}</span>
                {o.meta && <span className="tokenmenu__hex">{o.meta}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

function ColorSection({
  result,
  tokenCount,
  working,
  onLocate,
  onUse,
  onPick,
}: {
  result: ColorAuditResult;
  tokenCount: number;
  working: string | null;
  onLocate: (ids: string[]) => void;
  onUse: (g: DriftGroup) => void;
  onPick: (g: DriftGroup, variableId: string) => void;
}) {
  const t = result.totals;
  if (tokenCount === 0) return <CollapsedRow title="Color" note="no color tokens" />;
  if (result.driftGroups.length === 0) return <CollapsedRow title="Color" note={`${t.bound} on token`} good />;
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
            const oneClick = g.status === 'detached' && g.suggestionVariableId;
            const showPicker =
              (g.status === 'near' || g.status === 'orphan') && result.bindableTokens.length > 0;
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
                    {g.status === 'detached'
                      ? 'exact match'
                      : g.suggestionName
                        ? `closest: ${g.suggestionName}${g.deltaLabel ? ` (${g.deltaLabel})` : ''}`
                        : 'no nearby token'}
                  </span>
                  <span className="vactions">
                    <button className="locate" onClick={() => onLocate([...new Set(g.refs.map((r) => r.nodeId))])}>
                      Locate
                    </button>
                    {oneClick && (
                      <button className="bind" onClick={() => onUse(g)} disabled={isWorking}>
                        {isWorking ? 'Applying…' : `Use ${g.suggestionName}`}
                      </button>
                    )}
                    {showPicker && (
                      <PickerMenu
                        options={sortTokensByCloseness(result.bindableTokens, g.value).map((t) => ({
                          id: t.variableId,
                          name: t.name,
                          meta: t.value,
                          swatch: t.value,
                        }))}
                        disabled={isWorking}
                        onApply={(variableId) => onPick(g, variableId)}
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
      <select
        aria-label="Replacement font family"
        value={family}
        onChange={(e) => setFamily(e.target.value)}
        disabled={disabled}
      >
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
  onPick,
}: {
  result: TypeAuditResult;
  working: string | null;
  onLocate: (ids: string[]) => void;
  onUse: (g: TypeDriftGroup) => void;
  onReplaceFont: (g: TypeDriftGroup, family: string) => void;
  onPick: (g: TypeDriftGroup, styleId: string) => void;
}) {
  const t = result.totals;
  if (result.styleTokenCount === 0) return <CollapsedRow title="Typography" note="no text styles" />;
  if (result.driftGroups.length === 0) return <CollapsedRow title="Typography" note={`${t.onToken} on token`} good />;
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
            const canUse = !!g.styleId; // detached / close → one-click apply the matched style
            const showPicker = g.status === 'off' && result.styleTokens.length > 0;
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
                    {showPicker && (
                      <PickerMenu
                        label="Use style"
                        options={result.styleTokens.map((s) => ({
                          id: s.styleId,
                          name: s.name,
                          meta: `${s.family} ${s.fontSize}`,
                        }))}
                        disabled={isWorking}
                        onApply={(styleId) => onPick(g, styleId)}
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
  onPick,
}: {
  title: string;
  result: DimAuditResult;
  working: string | null;
  onLocate: (ids: string[]) => void;
  onUse: (g: DimDriftGroup) => void;
  onPick: (g: DimDriftGroup, variableId: string) => void;
}) {
  const t = result.totals;
  const lower = title.toLowerCase();
  if (result.tokenCount === 0) return <CollapsedRow title={title} note={`no ${lower} tokens`} />;
  if (result.driftGroups.length === 0) return <CollapsedRow title={title} note={`${t.bound} on token`} good />;
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
            const oneClick = g.status === 'detached' && g.suggestionVariableId;
            const showPicker = g.status === 'off' && result.bindableTokens.length > 0;
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
                    {g.status === 'detached'
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
                    {oneClick && (
                      <button className="bind" onClick={() => onUse(g)} disabled={isWorking}>
                        {isWorking ? 'Applying…' : `Use ${g.suggestionName}`}
                      </button>
                    )}
                    {showPicker && (
                      <PickerMenu
                        options={[...result.bindableTokens]
                          .sort((a, b) => Math.abs(a.value - g.value) - Math.abs(b.value - g.value))
                          .map((tk) => ({ id: tk.variableId, name: tk.name, meta: `${tk.value}px` }))}
                        disabled={isWorking}
                        onApply={(variableId) => onPick(g, variableId)}
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

function ElevationSection({
  result,
  working,
  onLocate,
  onUse,
  onPick,
}: {
  result: EffectAuditResult;
  working: string | null;
  onLocate: (ids: string[]) => void;
  onUse: (g: EffectDriftGroup) => void;
  onPick: (g: EffectDriftGroup, styleId: string) => void;
}) {
  const t = result.totals;
  if (result.styleTokenCount === 0) return <CollapsedRow title="Elevation" note="no effect styles" />;
  if (result.driftGroups.length === 0) return <CollapsedRow title="Elevation" note={`${t.onToken} on token`} good />;
  return (
    <section className="section">
      <SectionHead title="Elevation" coherence={result.coherence} drift={result.driftGroups.length} />
      {result.styleTokenCount === 0 ? (
        <p className="note">No effect styles found in this file.</p>
      ) : (
        <div className="totals">
          <Stat label="On token" value={t.onToken} />
          <Stat label="Detached" value={t.detached} />
          <Stat label="Off-system" value={t.off} />
        </div>
      )}
      {result.driftGroups.length === 0 ? (
        <p className="empty">No elevation drift.</p>
      ) : (
        <ul className="vlist">
          {result.driftGroups.map((g) => {
            const oneClick = g.status === 'detached' && g.styleId;
            const showPicker = g.status === 'off' && result.styleTokens.length > 0;
            const isWorking = working === g.key;
            const variant = g.status === 'detached' ? 'detached' : 'orphan';
            return (
              <li key={g.key} className={`violation v--${variant}`}>
                <div className="vrow">
                  <span className="vvalue">{g.label}</span>
                  <span className="vcount">×{g.instanceCount}</span>
                  <span className={`chip chip--${variant}`}>
                    {g.status === 'detached' ? 'Detached' : 'Off-system'}
                  </span>
                </div>
                <div className="vmeta">
                  <span className="vsuggest vsuggest--none">
                    {g.status === 'detached' ? 'exact match — applying changes nothing' : 'no matching effect style'}
                  </span>
                  <span className="vactions">
                    <button className="locate" onClick={() => onLocate(g.nodeIds)}>
                      Locate
                    </button>
                    {oneClick && (
                      <button className="bind" onClick={() => onUse(g)} disabled={isWorking}>
                        {isWorking ? 'Applying…' : `Use ${g.styleName}`}
                      </button>
                    )}
                    {showPicker && (
                      <PickerMenu
                        label="Use style"
                        options={result.styleTokens.map((s) => ({ id: s.styleId, name: s.name }))}
                        disabled={isWorking}
                        onApply={(styleId) => onPick(g, styleId)}
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

function ScaleSection({
  title,
  result,
  working,
  onLocate,
  onNormalize,
}: {
  title: string;
  result: ScaleResult;
  working: string | null;
  onLocate: (ids: string[]) => void;
  onNormalize: (category: string, o: ScaleOutlier) => void;
}) {
  if (result.total === 0) return <CollapsedRow title={title} note="no raw values" />;
  if (result.outliers.length === 0)
    return <CollapsedRow title={title} note={`${result.distinctCount} values · consistent`} good />;
  return (
    <section className="section">
      <div className="shead">
        <h2 className="shead__title">{title}</h2>
        <span className="shead__drift">
          {result.distinctCount} value{result.distinctCount === 1 ? '' : 's'} · {result.outliers.length} outlier
          {result.outliers.length === 1 ? '' : 's'}
        </span>
      </div>
      {result.total === 0 ? (
        <p className="empty">No raw {title.toLowerCase()} values.</p>
      ) : (
        <>
          <div className="scalebar">
            {result.scale.map((s) => (
              <span key={s.value} className="scalechip">
                {s.value}
                <em>×{s.count}</em>
              </span>
            ))}
          </div>
          {result.outliers.length > 0 && (
            <ul className="vlist">
              {result.outliers.map((o) => {
                const isWorking = working === `${result.category}:${o.value}`;
                return (
                  <li key={o.value} className="violation v--orphan">
                    <div className="vrow">
                      <span className="vvalue">{o.value}px</span>
                      <span className="vcount">×{o.count}</span>
                      <span className="chip chip--orphan">Outlier</span>
                    </div>
                    <div className="vmeta">
                      <span className="vsuggest">
                        near {o.suggest}px (×{o.suggestCount})
                      </span>
                      <span className="vactions">
                        <button
                          className="locate"
                          onClick={() => onLocate([...new Set(o.refs.map((r) => r.nodeId))])}
                        >
                          Locate
                        </button>
                        <button
                          className="bind"
                          onClick={() => onNormalize(result.category, o)}
                          disabled={isWorking}
                        >
                          {isWorking ? 'Applying…' : `Set to ${o.suggest}`}
                        </button>
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

// Compact one-liner for a section with nothing to act on (no tokens, or clean).
function CollapsedRow({ title, note, good }: { title: string; note: string; good?: boolean }) {
  return (
    <div className={`crow${good ? ' crow--good' : ''}`}>
      <h2 className="crow__title">{title}</h2>
      <span className="crow__note">
        {good ? '✓ ' : ''}
        {note}
      </span>
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
