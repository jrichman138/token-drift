export default defineBackground(() => {
  // Clicking the toolbar icon opens the side panel AND grants `activeTab` for the
  // current tab. We open the panel from an explicit onClicked handler.
  //
  // We must NOT use setPanelBehavior({ openPanelOnActionClick: true }): in that
  // mode Chrome consumes the click to open the panel WITHOUT firing onClicked, so
  // no activeTab grant is issued and the on-demand executeScript injection fails
  // on every page. That setting also PERSISTS across extension reloads, so simply
  // not calling it isn't enough — we explicitly reset it to false here so a stale
  // `true` from a previous build can't keep swallowing the onClicked gesture.
  browser.sidePanel
    ?.setPanelBehavior?.({ openPanelOnActionClick: false })
    .catch((error: unknown) => console.error('sidePanel setup failed', error));

  browser.action.onClicked.addListener((tab) => {
    if (tab.windowId != null) {
      void browser.sidePanel?.open?.({ windowId: tab.windowId });
    }
  });
});
