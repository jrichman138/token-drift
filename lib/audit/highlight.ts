// Page-side highlight overlay. Draws persistent outline boxes over a set of
// elements, tracking them on scroll/resize, with a small floating "Clear"
// control. Lives here (rather than inline in the content script) so it can be
// unit tested against happy-dom; the content script just instantiates it.

export const OVERLAY_ID = 'token-drift-highlight-overlay';
export const ACCENT = '#1b607f';

export class Highlighter {
  private overlay: HTMLDivElement | null = null;
  private targets: Element[] = [];
  private boxes: HTMLDivElement[] = [];
  private rafPending = false;
  private readonly onScroll = () => this.scheduleReposition();
  private readonly onResize = () => this.scheduleReposition();

  // Whether an overlay is currently mounted (handy for tests / callers).
  get active(): boolean {
    return this.overlay !== null;
  }

  show(elements: Element[], label?: string): void {
    this.clear();
    if (elements.length === 0) return;
    this.targets = elements;

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    for (let i = 0; i < elements.length; i++) {
      const box = document.createElement('div');
      Object.assign(box.style, {
        position: 'fixed',
        boxSizing: 'border-box',
        border: `2px solid ${ACCENT}`,
        borderRadius: '3px',
        background: 'rgba(79, 70, 229, 0.12)',
        boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.6)',
        pointerEvents: 'none',
        transition: 'opacity 120ms ease',
      } satisfies Partial<CSSStyleDeclaration>);
      overlay.appendChild(box);
      this.boxes.push(box);
    }

    overlay.appendChild(this.buildBadge(elements.length, label));
    document.documentElement.appendChild(overlay);
    this.overlay = overlay;

    window.addEventListener('scroll', this.onScroll, true);
    window.addEventListener('resize', this.onResize);

    this.reposition();
    elements[0]?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }

  clear(): void {
    if (!this.overlay) return;
    window.removeEventListener('scroll', this.onScroll, true);
    window.removeEventListener('resize', this.onResize);
    this.overlay.remove();
    this.overlay = null;
    this.targets = [];
    this.boxes = [];
  }

  private buildBadge(count: number, label?: string): HTMLDivElement {
    const badge = document.createElement('div');
    Object.assign(badge.style, {
      position: 'fixed',
      top: '12px',
      right: '12px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '6px 10px',
      borderRadius: '8px',
      background: ACCENT,
      color: '#fff',
      font: '600 12px/1.2 system-ui, sans-serif',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
      pointerEvents: 'auto',
    } satisfies Partial<CSSStyleDeclaration>);

    const text = document.createElement('span');
    const what = label ? `${label} ` : '';
    text.textContent = `${what}· ${count} highlighted`;
    badge.appendChild(text);

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear';
    Object.assign(clearBtn.style, {
      border: '1px solid rgba(255, 255, 255, 0.6)',
      background: 'transparent',
      color: '#fff',
      borderRadius: '5px',
      padding: '2px 8px',
      font: 'inherit',
      cursor: 'pointer',
    } satisfies Partial<CSSStyleDeclaration>);
    clearBtn.addEventListener('click', () => this.clear());
    badge.appendChild(clearBtn);

    return badge;
  }

  private scheduleReposition(): void {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.reposition();
    });
  }

  private reposition(): void {
    for (let i = 0; i < this.targets.length; i++) {
      const rect = this.targets[i].getBoundingClientRect();
      const box = this.boxes[i];
      if (!box) continue;
      const visible = rect.width > 0 || rect.height > 0;
      box.style.opacity = visible ? '1' : '0';
      box.style.left = `${rect.left}px`;
      box.style.top = `${rect.top}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
    }
  }
}
