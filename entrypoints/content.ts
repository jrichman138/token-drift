import { extractPage } from '@/lib/audit/dom';
import { Highlighter } from '@/lib/audit/highlight';
import { resolveSelectors } from '@/lib/audit/locate';
import {
  type AuditResponse,
  type HighlightRequest,
  type HighlightResponse,
  isAuditRequest,
  isClearHighlightRequest,
  isHighlightRequest,
} from '@/lib/messaging';

// On-demand content script: NOT registered in the manifest (`registration:
// 'runtime'`). The side panel injects it with `chrome.scripting.executeScript`
// against the active tab, which only works after the user invokes the
// extension (activeTab). That keeps the extension off every page until asked,
// avoiding the "read your data on all websites" install warning.
//
// Because the side panel may inject more than once into the same frame (e.g. a
// second audit after a SPA navigation), `main()` is guarded so the listener and
// the Highlighter are only ever created once per page.

declare global {
  interface Window {
    __tokenDriftReady?: boolean;
  }
}

export default defineContentScript({
  // No `matches`: with runtime registration WXT builds the script but omits it
  // from the manifest's `content_scripts`, so it never auto-injects.
  registration: 'runtime',
  main() {
    if (window.__tokenDriftReady) return;
    window.__tokenDriftReady = true;

    const highlighter = new Highlighter();

    function runHighlight(message: HighlightRequest): HighlightResponse {
      try {
        const { found, missing } = resolveSelectors(message.selectors, (selector) =>
          Array.from(document.querySelectorAll(selector)),
        );
        highlighter.show(found, message.label);
        return { ok: true, found: found.length, missing };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    browser.runtime.onMessage.addListener(
      (message): Promise<AuditResponse | HighlightResponse> | undefined => {
        if (isAuditRequest(message)) {
          // A fresh audit invalidates any standing highlights.
          highlighter.clear();
          try {
            const page = extractPage();
            const notices = page.truncated
              ? [
                  `Large page: sampled the first ${page.sampledElements.toLocaleString()} of ` +
                    `${page.elementCount.toLocaleString()} elements. The report covers the top of the page.`,
                ]
              : undefined;
            return Promise.resolve({
              ok: true,
              url: location.href,
              observations: page.observations,
              notices,
            });
          } catch (error) {
            return Promise.resolve({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        if (isHighlightRequest(message)) {
          return Promise.resolve(runHighlight(message));
        }

        if (isClearHighlightRequest(message)) {
          highlighter.clear();
          return Promise.resolve({ ok: true, found: 0, missing: [] });
        }

        return undefined;
      },
    );
  },
});
