export default defineBackground(() => {
  // Clicking the toolbar icon opens the side panel (Chrome).
  browser.sidePanel
    ?.setPanelBehavior?.({ openPanelOnActionClick: true })
    .catch((error: unknown) => console.error('sidePanel setup failed', error));
});
