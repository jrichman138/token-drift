import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Token Drift',
    description:
      'Audit the current page against a designer-provided token system and see matches, violations, and drift.',
    // On-demand model: `activeTab` + `scripting` let us inject the content
    // script into the tab the user is auditing, only after they click the
    // toolbar icon — no broad "read data on all websites" host access, and no
    // `tabs` permission (we read the audited URL from the page itself, and
    // tabs.query still returns the active tab id without it).
    permissions: ['sidePanel', 'activeTab', 'scripting'],
    // Only for fetching design tokens from a pasted repo URL, not page access.
    host_permissions: ['https://raw.githubusercontent.com/*', 'https://gitlab.com/*'],
    action: {},
  },
});
